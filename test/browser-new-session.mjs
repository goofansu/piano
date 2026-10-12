// INV-01/02/03/05: a first message is visible before Pi is ready, without replay or duplicate history.
// node test/browser-new-session.mjs [evidence-directory]; fake Pi, no paid calls.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { registryEnv } from "./fixtures/registry.ts";

const evidence = resolve(process.argv[2] ?? ".scratch/new-session-browser");
const backendPort = process.env.PIANO_TEST_BACKEND_PORT ?? "7171";
const webPort = process.env.PIANO_TEST_WEB_PORT ?? "7172";
for (const port of [backendPort, webPort])
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(Number(port), "127.0.0.1", () => server.close(resolve));
  });
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "piano-new-session-"));
for (const dir of ["repo", "agent", "sessions", "home", "config"]) mkdirSync(join(root, dir));
const repo = join(root, "repo"),
  release = join(root, "release"),
  audit = join(root, "audit.jsonl");
const env = {
  ...process.env,
  HOME: join(root, "home"),
  XDG_CONFIG_HOME: join(root, "config"),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
execFileSync("git", ["init", "-q", "-b", "main", repo], { env });
writeFileSync(
  join(root, "registry.json"),
  JSON.stringify({ folders: [repo], worktrees: [], sessions: [] }),
);
const pixel = join(root, "pixel.png");
writeFileSync(
  pixel,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const fake = join(root, "fake.mjs");
writeFileSync(
  fake,
  `import {appendFileSync,existsSync,readFileSync} from 'node:fs';
const auditEvent=(event,extra={})=>appendFileSync(${JSON.stringify(audit)},JSON.stringify({event,pid:process.pid,...extra})+'\\n');
if(process.argv.includes('--session-id')) {
  auditEvent('startup-held');
  while(!existsSync(${JSON.stringify(release)})) await new Promise(r=>setTimeout(r,20));
  if(readFileSync(${JSON.stringify(release)},'utf8')==='fail') {auditEvent('startup-failed');process.exit(7);}
}
` +
    readFileSync(resolve("test/fake-pi.mjs"), "utf8").replace(
      "function handle(cmd) {",
      "function handle(cmd) { auditEvent('command',{command:cmd.type,text:cmd.message});",
    ),
);
const backend = spawn(process.execPath, ["server/main.ts"], {
  env: {
    ...env,
    HOST: "127.0.0.1",
    PORT: backendPort,
    PIANO_ALLOWED_ORIGINS: `http://127.0.0.1:${webPort},http://localhost:${webPort}`,
    ...registryEnv(join(root, "registry.json")),
    PIANO_PI_CLI: fake,
    PIANO_PI_ARGS: "",
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"),
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
    webPort,
    "--strictPort",
  ],
  {
    cwd: resolve(process.env.PIANO_TEST_WEB_ROOT ?? "web"),
    env: { ...env, PIANO_DEV_BACKEND: `http://127.0.0.1:${backendPort}` },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let processLog = "";
for (const proc of [backend, frontend]) {
  proc.stdout.on("data", (d) => (processLog += d));
  proc.stderr.on("data", (d) => (processLog += d));
}
const session = `new-session-${process.pid}`,
  commands = [],
  observations = [];
async function ab(...args) {
  const result = await new Promise((resolve, reject) => {
    const proc = spawn("npx", ["agent-browser", "--session", session, ...args], {
      env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "15000" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => proc.kill("SIGTERM"), 25000);
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("exit", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
  commands.push({ args, ...result });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
const evaluate = async (js) => JSON.parse(await ab("eval", js));
const records = () =>
  existsSync(audit) ? readFileSync(audit, "utf8").trim().split("\n").map(JSON.parse) : [];
const promptCount = (text) =>
  records().filter((r) => r.command === "prompt" && r.text === text).length;
const userCount = (text) =>
  evaluate(
    `[...document.querySelectorAll('[data-slot="transcript"] article')].filter(a=>a.textContent.includes('You said')&&a.textContent.includes(${JSON.stringify(text)})).length`,
  );
async function capture(name) {
  writeFileSync(join(evidence, `${name}.txt`), await ab("snapshot"));
  await ab("screenshot", join(evidence, `${name}.png`));
}
async function firstMessage(text, image = false) {
  await ab("fill", '[aria-label="First message"]', text);
  if (image) {
    await ab("upload", 'input[type="file"]', pixel);
    await ab(
      "wait",
      "--fn",
      `document.querySelectorAll('[aria-label="Attachments"] [data-state="done"]').length === 1`,
    );
  }
  await ab("wait", "--fn", `!document.querySelector('[aria-label="Send"]').disabled`);
  await ab("focus", '[aria-label="First message"]');
  await ab("press", "Enter");
  await ab("wait", "--fn", `!!document.querySelector('[aria-label="Message"]')`);
}
let outcome = "fail";
try {
  writeFileSync(
    join(evidence, "revision.txt"),
    execFileSync("git", ["rev-parse", "HEAD"]).toString() +
      execFileSync("git", ["status", "--short"]).toString(),
  );
  for (let n = 0; n < 150; n++) {
    assert.equal(backend.exitCode, null);
    assert.equal(frontend.exitCode, null);
    try {
      if (
        (await fetch(`http://127.0.0.1:${backendPort}/api/folders`)).ok &&
        (await fetch(`http://127.0.0.1:${webPort}`)).ok
      )
        break;
    } catch {}
    if (n === 149) throw new Error("Scratch startup deadline");
    await delay(100);
  }
  await ab("open", `http://127.0.0.1:${webPort}/new`);
  // Observe the existing socket without an init-script dependency. Record envelope metadata only.
  await evaluate(
    `(() => {window.observedFrames=[];const original=WebSocket.prototype.send;WebSocket.prototype.send=function(raw){if(!this.observed){this.observed=true;this.addEventListener('message',e=>{const m=JSON.parse(e.data);observedFrames.push({direction:'in',tag:m._tag,event:m.event?._tag});});}const m=JSON.parse(raw);observedFrames.push({direction:'out',tag:m._tag});return original.call(this,raw);};return true;})()`,
  );
  await firstMessage("EARLY_FIRST_MESSAGE", true);
  await capture("startup-held-desktop");
  assert.equal(
    await userCount("EARLY_FIRST_MESSAGE"),
    1,
    "Submitted text is visible before Pi readiness",
  );
  assert.equal(
    await evaluate(`observedFrames.filter(m=>m.direction==='in'&&m.tag==='selected').length`),
    0,
    "No selected response received",
  );
  assert.equal(promptCount("EARLY_FIRST_MESSAGE"), 0, "Pi has not received the prompt yet");
  assert.equal(
    await evaluate(`document.querySelector('main header [role="status"]').textContent`),
    "Starting",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('main header [role="status"]').classList.contains('sr-only')`,
    ),
    true,
    "Starting remains screen-reader-only",
  );
  assert.equal(
    await evaluate(`document.querySelector('[aria-label="Last input"]') === null`),
    true,
    "No visible startup sentence above the composer",
  );
  assert.equal(
    await evaluate(
      `document.querySelectorAll('[data-slot="transcript"] .keys[data-playing="true"]').length`,
    ),
    1,
    "Animated Piano keys occupy the reply area during startup",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[data-slot="transcript"] .keys').getAnimations({subtree:true}).filter(a=>a.animationName==='key-press'&&a.playState==='running').length`,
    ),
    3,
    "All three keys are actually animating",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[data-slot="transcript"] .keys').getBoundingClientRect().top > document.querySelector('[data-slot="submitted-input"]').getBoundingClientRect().bottom`,
    ),
    true,
    "Startup indicator follows the submitted message",
  );
  assert.equal(
    await evaluate(`document.querySelectorAll('img[alt="Attachment preview"]').length`),
    1,
    "Submitted image appears before readiness",
  );
  assert.equal(
    await evaluate(`document.querySelector('[aria-label="Send"]').disabled`),
    true,
    "No second send before readiness",
  );
  await ab("set", "viewport", "390", "844");
  await capture("startup-held-mobile");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  observations.push(
    "Text and image visible on session page before any selected response or prompt RPC, desktop/mobile",
  );
  await evaluate(
    `(() => {window.startingTranscript=document.querySelector('[data-slot="transcript"]');return true;})()`,
  );
  writeFileSync(release, "ready");
  await ab("wait", "--text", "echo: EARLY_FIRST_MESSAGE");
  assert.equal(
    await userCount("EARLY_FIRST_MESSAGE"),
    1,
    "Authoritative user message replaces local preview",
  );
  assert.equal(
    await evaluate(`startingTranscript === document.querySelector('[data-slot="transcript"]')`),
    true,
    "Readiness handoff keeps the mounted transcript without restarting its fade",
  );
  assert.equal(promptCount("EARLY_FIRST_MESSAGE"), 1);
  await ab(
    "wait",
    "--fn",
    `document.querySelectorAll('[data-slot="transcript"] .keys[data-playing="true"]').length === 0`,
  );
  await capture("first-response");
  await ab("reload");
  await ab("wait", "--text", "echo: EARLY_FIRST_MESSAGE");
  assert.equal(promptCount("EARLY_FIRST_MESSAGE"), 1, "Reload never resends first prompt");
  assert.equal(await userCount("EARLY_FIRST_MESSAGE"), 1);
  observations.push("Canonical message appears once; reload preserves history without resending");
  await ab("set", "viewport", "1280", "900");
  await ab("find", "role", "button", "click", "--name", "New session", "--exact");
  await firstMessage("/handled");
  await ab("wait", "--text", "Command handled.");
  assert.equal(
    await evaluate(`document.querySelectorAll('[data-slot="transcript"] article[id]').length`),
    0,
    "Handled slash command does not become invented history",
  );
  await capture("handled-command");
  observations.push("Handled command settles without inventing a canonical transcript entry");
  await ab("fill", '[aria-label="Message"]', "reject input");
  await ab("press", "Enter");
  await ab("wait", "--text", "Message rejected.");
  assert.equal(
    await evaluate(`document.querySelectorAll('[data-slot="submitted-input"]').length`),
    0,
    "Newer input outcome cannot be attributed to the first command",
  );
  assert.equal(promptCount("reject input"), 1);
  await capture("newer-input-rejected");
  observations.push("A newer rejected input supersedes the original local receipt");
  rmSync(release);
  await ab("find", "role", "button", "click", "--name", "New session", "--exact");
  await firstMessage("RECOVER_FIRST_MESSAGE");
  assert.equal(await userCount("RECOVER_FIRST_MESSAGE"), 1);
  writeFileSync(release, "fail");
  await ab(
    "wait",
    "--fn",
    `document.querySelector('main')?.innerText.includes('Could not start') || document.querySelector('main')?.innerText.includes('could not start') || document.querySelector('main')?.innerText.includes('Unable to start') || document.querySelector('main')?.innerText.includes('Delivery uncertain')`,
  );
  assert.equal(promptCount("RECOVER_FIRST_MESSAGE"), 0);
  assert.equal(
    await userCount("RECOVER_FIRST_MESSAGE"),
    1,
    "Failed creation retains submitted text",
  );
  assert.equal(
    await evaluate(
      `document.querySelectorAll('[data-slot="transcript"] .keys[data-playing="true"]').length`,
    ),
    0,
    "Startup animation stops on failure",
  );
  await capture("startup-failed");
  observations.push("Startup failure retains submitted text and explains failure without replay");
  outcome = "pass";
  console.log(
    "PASS: immediate text/image before readiness, authoritative reconciliation, no reload replay, handled command, startup failure",
  );
} catch (error) {
  try {
    await capture("failure");
    writeFileSync(join(evidence, "browser-errors.txt"), await ab("errors"));
  } catch {}
  throw error;
} finally {
  try {
    await ab("close");
  } catch {}
  for (const proc of [backend, frontend])
    if (proc.exitCode === null) {
      const stopped = new Promise((resolve) => proc.once("exit", resolve));
      proc.kill("SIGTERM");
      await stopped;
    }
  writeFileSync(join(evidence, "commands.json"), JSON.stringify(commands, null, 2));
  writeFileSync(
    join(evidence, "observations.json"),
    JSON.stringify({ outcome, observations, paidModelCalls: 0 }, null, 2),
  );
  writeFileSync(join(evidence, "process.log"), processLog);
  writeFileSync(join(evidence, "audit.jsonl"), existsSync(audit) ? readFileSync(audit) : "");
  rmSync(root, { recursive: true, force: true });
}
