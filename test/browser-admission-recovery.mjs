// Real scratch WebSocket/UI overload journey. Fake Pi only; no model calls.
// node test/browser-admission-recovery.mjs <evidence-directory>
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { registryEnv } from "./fixtures/registry.ts";

const evidence = resolve(process.argv[2] ?? "/tmp/piano-inbound-evidence");
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "piano-inbound-"));
const repo = join(root, "repo"),
  sessions = join(root, "sessions");
for (const dir of [repo, sessions, join(root, "agent")]) mkdirSync(dir);
execFileSync("git", ["init", "-q", repo]);
const timestamp = new Date().toISOString(),
  id = "inbound";
writeFileSync(
  join(sessions, `${id}.jsonl`),
  JSON.stringify({ type: "session", version: 3, id, cwd: repo, timestamp }) + "\n",
);
writeFileSync(
  join(root, "registry.json"),
  JSON.stringify({
    folders: [repo],
    worktrees: [],
    sessions: [
      {
        cwd: repo,
        sessionId: "other",
        title: "Other session",
        createdAt: timestamp,
        updatedAt: timestamp,
        archived: false,
      },
      {
        cwd: repo,
        sessionId: id,
        title: "Inbound capacity",
        createdAt: timestamp,
        updatedAt: timestamp,
        archived: false,
      },
    ],
  }),
);
writeFileSync(
  join(sessions, "other.jsonl"),
  JSON.stringify({ type: "session", version: 3, id: "other", cwd: repo, timestamp }) + "\n",
);
const fake = join(root, "fake.mjs");
writeFileSync(
  fake,
  readFileSync("test/fake-pi.mjs", "utf8").replace(
    'const sessionId = args[args.indexOf("--session-id") + 1] || "nosession";',
    `const sessionId = args.includes("--session") ? ${JSON.stringify(id)} : args[args.indexOf("--session-id") + 1] || "nosession";`,
  ),
);
const backendUrl = "http://127.0.0.1:7171",
  frontendUrl = "http://127.0.0.1:7172";
const backend = spawn(process.execPath, ["server/main.ts"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: "7171",
    PIANO_ALLOWED_ORIGINS: frontendUrl,
    ...registryEnv(join(root, "registry.json")),
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_CODING_AGENT_SESSION_DIR: sessions,
    PIANO_PI_CLI: fake,
    PIANO_PI_ARGS: "",
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
    env: { ...process.env, PIANO_DEV_BACKEND: backendUrl },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
for (const p of [backend, frontend]) {
  p.stdout.on("data", (d) => (logs += d));
  p.stderr.on("data", (d) => (logs += d));
}
const init = join(root, "observe.js");
writeFileSync(
  init,
  `window.sent=[];window.received=[];window.controlCount=0;const Native=WebSocket;
window.WebSocket=class extends Native {constructor(...args){super(...args);if(this.url.endsWith('/ws')){window.controlCount++;window.control=this;this.addEventListener('message',e=>window.received.push(JSON.parse(e.data)));}} send(text){if(this.url.endsWith('/ws'))window.sent.push(JSON.parse(text));super.send(text);}};`,
);
const browser = `inbound-${process.pid}`,
  commands = [];
async function ab(...args) {
  const result = await new Promise((res, rej) => {
    const p = spawn("npx", ["agent-browser", "--session", browser, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", rej);
    p.on("exit", (status) => res({ status, stdout, stderr }));
  });
  commands.push({ args, ...result });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
const evaluate = async (code) => JSON.parse(await ab("eval", code));
try {
  for (let n = 0; ; n++) {
    assert.equal(backend.exitCode, null, logs);
    assert.equal(frontend.exitCode, null, logs);
    try {
      if ((await fetch(`${backendUrl}/api/folders`)).ok && (await fetch(frontendUrl)).ok) break;
    } catch {}
    assert.ok(n < 150, logs);
    await delay(100);
  }
  await ab("--init-script", init, "open", `${frontendUrl}/s/${id}`);
  await ab("wait", "--fn", `!!document.querySelector('textarea[aria-label="Message"]')`);
  // First input starts the saved session through the normal composer.
  await ab("fill", 'textarea[aria-label="Message"]', "capacity hold");
  await ab("press", "Enter");
  await ab("wait", "--text", "Release capacity");
  await ab(
    "wait",
    "--fn",
    `received.some(m=>m._tag==='session' && m.event._tag==='notice' && m.event.message==='Capacity held: 1')`,
  );
  const connections = await evaluate("controlCount"); // Development StrictMode may already have reopened once.
  // Use the same browser connection and selection, not a second test-only client.
  await evaluate(
    `(() => { const selectionId = sent.findLast(m=>m._tag==='act').selectionId; for(let n=0;n<7;n++) control.send(JSON.stringify({_tag:'act',selectionId,action:{_tag:'prompt',text:'capacity hold'}})); return true; })()`,
  );
  await ab(
    "wait",
    "--fn",
    `received.some(m=>m._tag==='session' && m.event._tag==='notice' && m.event.message==='Capacity held: 8')`,
  );
  await evaluate(
    `(() => { window.oldSelection = sent.findLast(m=>m._tag==='act').selectionId; history.pushState(null, '', '/s/other'); dispatchEvent(new PopStateEvent('popstate')); return true; })()`,
  );
  await ab("wait", "--text", "Unable to open session.");
  assert.equal(
    await evaluate(`sent.filter(m=>m._tag==='select' && m.sessionId==='other').length`),
    1,
  );
  await ab("screenshot", join(evidence, "selection-rejected.png"));
  await evaluate(
    `control.send(JSON.stringify({_tag:'act',selectionId:oldSelection,action:{_tag:'abort'}})); true`,
  );
  await ab(
    "wait",
    "--fn",
    `received.some(m=>m._tag==='session' && m.event._tag==='notice' && m.event.message==='Capacity dialog answered')`,
  );
  await ab("find", "role", "button", "click", "--name", "Retry", "--exact");
  await ab("wait", "--fn", `received.some(m=>m._tag==='selected' && m.sessionId==='other')`);
  assert.equal(
    await evaluate(`sent.filter(m=>m._tag==='select' && m.sessionId==='other').length`),
    2,
  );
  assert.equal(
    await evaluate(
      `new Set(sent.filter(m=>m._tag==='select' && m.sessionId==='other').map(m=>m.selectionId)).size`,
    ),
    2,
  );
  assert.equal(await evaluate("controlCount"), connections);
  await ab("screenshot", join(evidence, "selection-recovered.png"));
  assert.equal(await ab("errors"), "");
  console.log(
    "PASS: admission rejection ends loading visibly; explicit Retry selects with fresh correlation and succeeds.",
  );
} finally {
  await ab("snapshot")
    .then((value) => writeFileSync(join(evidence, "final.txt"), value))
    .catch(() => {});
  await evaluate("({sent, received})")
    .then((value) => writeFileSync(join(evidence, "wire.json"), JSON.stringify(value, null, 2)))
    .catch(() => {});
  await ab("close").catch(() => {});
  for (const p of [backend, frontend])
    if (p.exitCode === null) {
      const stopped = new Promise((res) => p.once("exit", res));
      p.kill("SIGTERM");
      await stopped;
    }
  writeFileSync(join(evidence, "commands.json"), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, "processes.log"), logs);
  rmSync(root, { recursive: true, force: true });
}
