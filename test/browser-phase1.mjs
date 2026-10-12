// Phase 1 browser gate. Separate scratch processes/registry/repo, fake Pi, no model credits.
// Run: node test/browser-phase1.mjs /tmp/piano-phase1-evidence/browser
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { registryEnv } from "./fixtures/registry.ts";

const evidence = resolve(process.argv[2] ?? "/tmp/piano-phase1-evidence/browser");
mkdirSync(evidence, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "piano-phase1-"));
const cwd = join(scratch, "project");
mkdirSync(cwd);
assert.equal(spawnSync("git", ["init", cwd]).status, 0);
// Hold an active turn without a modal so the browser can submit busy input.
const fake = join(scratch, "fake.mjs");
writeFileSync(
  fake,
  readFileSync("test/fake-pi.mjs", "utf8").replace(
    'out({ type: "extension_ui_request", id: "live1", method: "input", title: "Running after response" });',
    "// Browser gate: active work without a blocking modal.",
  ),
);
const registry = join(scratch, "registry.json");
writeFileSync(registry, JSON.stringify({ folders: [cwd], worktrees: [], sessions: [] }));
const server = spawn(process.execPath, ["server/main.ts"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: "7171",
    PIANO_ALLOWED_ORIGINS: "http://127.0.0.1:7172,http://localhost:7172",
    ...registryEnv(registry),
    PIANO_PI_CLI: fake,
    PIANO_PI_ARGS: "",
    PI_CODING_AGENT_DIR: join(scratch, "agent"),
    PI_CODING_AGENT_SESSION_DIR: join(scratch, "sessions"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const frontend = spawn(
  process.execPath,
  [
    resolve("node_modules/vite/bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    "7172",
    "--strictPort",
  ],
  {
    cwd: resolve("web"),
    env: { ...process.env, PIANO_DEV_BACKEND: "http://127.0.0.1:7171" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let processLog = "";
for (const proc of [server, frontend]) {
  proc.stdout.on("data", (d) => (processLog += d));
  proc.stderr.on("data", (d) => (processLog += d));
}
const init = join(scratch, "observe.js");
writeFileSync(
  init,
  `window.sent=[]; const NativeWebSocket=WebSocket;
window.WebSocket=class extends NativeWebSocket { send(data) { if(this.url.endsWith('/ws')) sent.push(JSON.parse(data)); return super.send(data); } };`,
);
const session = `phase1-${process.pid}`;
const commands = [];
const observations = [];
function ab(...args) {
  const result = spawnSync("npx", ["agent-browser", "--session", session, ...args], {
    encoding: "utf8",
    timeout: 55000,
    env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "40000" },
  });
  commands.push({ args, status: result.status, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.status, 0, `agent-browser ${args[0]}: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
const evaluate = (js) => JSON.parse(ab("eval", js));
const header = () => evaluate(`document.querySelector('main header [role="status"]').textContent`);
const lastInput = () =>
  evaluate(`document.querySelector('[aria-label="Last input"]')?.textContent ?? null`);
function send(text) {
  // Existing bottom-right toast placement can cover the composer action; hovering pauses expiry.
  ab("mouse", "move", "10", "10");
  ab("wait", "--fn", `!document.querySelector('[data-sonner-toast][data-visible="true"]')`);
  ab("fill", '[aria-label="Message"]', text);
  ab("press", "Enter");
}
function capture(name) {
  observations.push({ name, header: header(), lastInput: lastInput() });
  writeFileSync(join(evidence, `${name}.txt`), ab("snapshot"));
  ab("screenshot", join(evidence, `${name}.png`));
}
try {
  for (let i = 0; i < 100; i++) {
    assert.equal(server.exitCode, null, "scratch backend exited");
    assert.equal(frontend.exitCode, null, "scratch frontend exited");
    try {
      if ((await fetch("http://127.0.0.1:7172")).ok) break;
    } catch {}
    if (i === 99) throw new Error("scratch UI did not start");
    await delay(100);
  }
  ab("--init-script", init, "open", "http://127.0.0.1:7172/new");
  ab("fill", '[aria-label="First message"]', "handled input");
  ab("click", '[aria-label="Send"]');
  ab("wait", "--text", "Command handled.");
  assert.equal(header(), "Ready");
  assert.equal(
    evaluate(`document.querySelectorAll('[data-slot="transcript"] article[id]').length`),
    0,
    "handled input is not finalized history",
  );
  assert.equal(evaluate(`document.querySelector('[aria-label="Message"]').disabled`), false);
  capture("handled");

  send("immediate completion");
  ab("wait", "--text", "echo: immediate completion");
  assert.equal(header(), "Ready");
  assert.equal(lastInput(), null, "completed turns need no redundant input receipt");
  capture("immediate");

  send("ask me");
  ab("wait", "--text", "Enter a value");
  assert.equal(header(), "Waiting for input");
  capture("waiting");
  ab("fill", "#pi-dialog-form input", "42");
  ab("click", 'button[form="pi-dialog-form"]');
  ab("wait", "--text", "you said 42");
  assert.equal(header(), "Ready");

  send("live context");
  ab("wait", '[aria-label="Stop"]');
  ab("click", '[aria-label="Delivery: steer"]');
  ab("find", "role", "menuitemradio", "click", "--name", "follow-up Alt Enter");
  send("expand queue");
  ab("wait", "--text", "Queued messages (1)");
  assert.equal(lastInput(), null, "the queue itself shows pending input");
  assert.equal(
    evaluate(
      `document.querySelector('[aria-label="Queued messages"] li').lastElementChild.textContent`,
    ),
    "expanded follow-up",
  );
  assert.equal(
    evaluate(
      `[...document.querySelectorAll('article')].some(e=>e.textContent.includes('expanded follow-up'))`,
    ),
    false,
  );
  capture("queued");
  ab("reload");
  ab("wait", "--text", "Queued messages (1)");
  assert.equal(lastInput(), null);
  capture("queued-reload");

  send("/handled");
  ab("wait", "--text", "Command handled.");
  assert.equal(header(), "Working", "handled does not settle independent work");
  assert.equal(evaluate(`document.querySelector('[aria-label^="Model:"]').title`), "fake/beta");
  capture("busy-command");
  send("/retry");
  ab("wait", "--text", "Retrying");
  assert.equal(header(), "Retrying");
  assert.equal(evaluate(`!!document.querySelector('[aria-label="Stop"]')`), true);
  capture("retry-after-agent-end");
  send("/compact");
  ab("wait", "--text", "Compacting · Retrying");
  assert.equal(header(), "Compacting · Retrying");
  assert.equal(
    evaluate(`document.querySelector('[aria-label="Message"]').disabled`),
    false,
    "compaction leaves the composer usable",
  );
  send("ordinary input during compaction");
  ab("wait", "--text", "Message rejected.");
  assert.match(lastInput(), /Cannot prompt during compaction/);
  assert.equal(header(), "Compacting · Retrying");
  capture("rejected-during-compaction");
  send("/recover");
  ab("wait", "--text", "echo: expanded follow-up");
  assert.equal(header(), "Ready");

  send("withhold acknowledgement");
  ab("wait", "--text", "Submitting —");
  assert.equal(
    evaluate(
      `sent.filter(m=>['prompt','steer'].includes(m.action?._tag)&&m.action.text==='withhold acknowledgement').length`,
    ),
    1,
  );
  capture("awaiting-ack");
  ab("reload"); // disconnect while the acknowledgement is pending, not after the timeout
  ab("wait", "--text", "Delivery uncertain —");
  assert.equal(header(), "Working");
  assert.match(lastInput(), /will not resend automatically/);
  assert.equal(evaluate(`sent.filter(m=>['prompt','steer'].includes(m.action?._tag)).length`), 0);
  capture("uncertain");
  ab("reload");
  ab("wait", "--text", "Delivery uncertain —");
  assert.equal(
    evaluate(`sent.filter(m=>['prompt','steer'].includes(m.action?._tag)).length`),
    0,
    "reload never resubmits",
  );
  capture("uncertain-reload");
  send("/release-ack");
  ab("wait", "--text", "Command handled.");
  assert.equal(header(), "Working", "old acceptance cannot settle or reactivate work");
  capture("late-ack");
  send("/recover");
  ab("wait", "--fn", `document.querySelector('main header [role="status"]').textContent==='Ready'`);
  send("crash now");
  ab("wait", "--text", "Pi stopped:");
  assert.equal(header(), "Exited");
  capture("exited");
  ab("errors");
  writeFileSync(
    join(evidence, "result.json"),
    JSON.stringify({ outcome: "pass", observations }, null, 2),
  );
  console.log(
    "PASS: handled/usable composer, immediate completion, waiting, queued/reload, busy command, retry+compaction, rejection, uncertain/no replay, late acknowledgement, exit",
  );
} catch (error) {
  writeFileSync(
    join(evidence, "result.json"),
    JSON.stringify({ outcome: "fail", error: String(error), observations }, null, 2),
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  try {
    ab("close");
  } catch {}
  for (const proc of [server, frontend]) if (proc.exitCode === null) proc.kill("SIGTERM");
  await Promise.all(
    [server, frontend].map((proc) =>
      proc.exitCode !== null ? Promise.resolve() : new Promise((r) => proc.once("exit", r)),
    ),
  );
  writeFileSync(join(evidence, "browser-commands.json"), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, "server.log"), processLog);
  rmSync(scratch, { recursive: true, force: true });
}
