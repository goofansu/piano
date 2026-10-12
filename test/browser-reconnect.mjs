// INV-02/05: reconnect must refresh in place, not clear/remount the conversation.
// Fake Pi; scratch registry/session files. PIANO_TEST_PORT overrides the 7171/7172 pair.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { registryEnv } from "./fixtures/registry.ts";

const evidence = resolve(process.argv[2] ?? "/tmp/piano-reconnect-evidence/browser");
mkdirSync(evidence, { recursive: true });
const port = Number(process.env.PIANO_TEST_PORT ?? 7171),
  appUrl = `http://127.0.0.1:${port + 1}`;
const root = mkdtempSync(join(tmpdir(), "piano-reconnect-")),
  repo = join(root, "repo"),
  sessions = join(root, "sessions");
for (const path of [repo, sessions, join(root, "agent")]) mkdirSync(path);
execFileSync("git", ["init", "--quiet", repo]);
const id = "reconnect-example",
  timestamp = new Date().toISOString();
const entries = [{ type: "session", version: 3, id, cwd: repo, timestamp }];
for (let n = 0; n < 60; n++)
  entries.push({
    type: "message",
    id: `m${n}`,
    parentId: n ? `m${n - 1}` : null,
    timestamp,
    message: {
      role: "user",
      content: `Saved message ${n}: read this conversation without losing your position.`,
      timestamp: n,
    },
  });
writeFileSync(join(sessions, `${id}.jsonl`), entries.map(JSON.stringify).join("\n") + "\n");
writeFileSync(
  join(root, "registry.json"),
  JSON.stringify({
    folders: [repo],
    worktrees: [],
    sessions: [
      {
        cwd: repo,
        sessionId: id,
        title: "Reconnect example",
        createdAt: timestamp,
        updatedAt: timestamp,
        archived: false,
      },
    ],
  }),
);
const backend = spawn(process.execPath, ["server/main.ts"], {
  env: {
    ...process.env,
    HOME: root,
    HOST: "127.0.0.1",
    PORT: String(port),
    PIANO_ALLOWED_ORIGINS: appUrl,
    ...registryEnv(join(root, "registry.json")),
    PIANO_PI_CLI: resolve("test/fake-host-pi.mjs"),
    PIANO_PI_ARGS: "",
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_CODING_AGENT_SESSION_DIR: sessions,
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
    String(port + 1),
    "--strictPort",
  ],
  {
    cwd: resolve("web"),
    env: { ...process.env, PIANO_DEV_BACKEND: `http://127.0.0.1:${port}` },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let processLog = "";
for (const p of [backend, frontend]) {
  p.stdout.on("data", (d) => (processLog += d));
  p.stderr.on("data", (d) => (processLog += d));
}
const init = join(root, "observe.js");
// Delay only the control socket's inbound frames, never Vite's HMR socket. This
// makes the snapshot wait observable without changing the real reconnect path.
writeFileSync(
  init,
  `window.pageToken=crypto.randomUUID();window.controlConnections=0;window.held=[];window.sent=[];window.controlCloses=[];
const Native=WebSocket;
window.WebSocket=class extends Native {
 constructor(...args){super(...args);if(this.url.endsWith('/ws')){window.control=this;window.controlConnections++;this.addEventListener('close',e=>controlCloses.push({code:e.code,reason:e.reason}));}}
 set onmessage(handler){super.onmessage=e=>{if(this.url.endsWith('/ws')&&window.holdFrames){held.push(()=>handler(e));return;}handler(e);};}
 send(data){if(this.url.endsWith('/ws')){window.sent.push(JSON.parse(data));if(window.dropOutbound)return;}return super.send(data);}
};`,
);
const session = `reconnect-${process.pid}`,
  commands = [];
async function ab(...args) {
  const result = await new Promise((resolve, reject) => {
    const p = spawn("npx", ["agent-browser", "--session", session, ...args], {
      env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "15000" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => p.kill("SIGTERM"), 25000);
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("exit", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
  commands.push({ args, ...result });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
const evaluate = async (js) => JSON.parse(await ab("eval", js));
const observe = `({pageToken,timeOrigin:performance.timeOrigin,path:location.pathname,
 loading:[...document.querySelectorAll('main div')].some(e=>e.textContent==='Loading'),
 sameTranscript:window.originalTranscript?.isConnected??false,
 scrollTop:document.querySelector('main .h-full.overflow-y-auto')?.scrollTop??null,
 draft:document.querySelector('textarea[aria-label="Message"]')?.value,
 disabled:document.querySelector('textarea[aria-label="Message"]')?.disabled,
 messagesPresent:document.querySelector('main')?.textContent.includes('Saved message 0'),
 partialPresent:document.querySelector('main')?.textContent.includes('Partial reconnect-example'),
 prompts:sent.filter(m=>['prompt','steer'].includes(m.action?._tag)||m._tag==='create_session').length})`;
async function capture(name) {
  writeFileSync(join(evidence, `${name}.txt`), await ab("snapshot"));
  await ab("screenshot", join(evidence, `${name}.png`));
}
try {
  for (let n = 0; n < 100; n++) {
    assert.equal(backend.exitCode, null);
    assert.equal(frontend.exitCode, null);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/folders`)).ok && (await fetch(appUrl)).ok)
        break;
    } catch {}
    if (n === 99) throw new Error("Scratch startup deadline");
    await delay(100);
  }
  await ab("--init-script", init, "open", `${appUrl}/s/${id}`);
  await ab("wait", "--text", "Saved message 59");
  await ab("set", "viewport", "390", "844");
  // A responsive browser must consume a live burst without rendering the whole
  // application synchronously for every frame and overflowing server delivery.
  const burstConnections = await evaluate("controlConnections");
  await ab("fill", 'textarea[aria-label="Message"]', "/burst");
  await ab("click", 'button[aria-label="Send"]');
  await ab(
    "wait",
    "--fn",
    "controlCloses.some(c=>c.code===1013)||document.body.innerText.includes('burst complete')",
  );
  await capture("live-burst");
  const burst = await evaluate(`({connections:controlConnections,closes:controlCloses,
    warning:document.body.innerText.includes('Connection fell behind'),
    complete:document.body.innerText.includes('burst complete'),
    finalStatus:document.body.innerText.includes('burst 600')})`);
  writeFileSync(join(evidence, "burst.json"), JSON.stringify(burst, null, 2));
  assert.equal(burst.warning, false, "a responsive browser must not warn that it fell behind");
  assert.equal(
    burst.closes.some((c) => c.code === 1013),
    false,
    "live delivery must not overflow",
  );
  assert.equal(burst.connections, burstConnections, "the burst needs no reconnect");
  assert.equal(burst.complete, true, "the final live notice is delivered");
  assert.equal(burst.finalStatus, true, "the latest streamed state is rendered");
  await ab("fill", 'textarea[aria-label="Message"]', "/partial");
  await ab("click", 'button[aria-label="Send"]');
  await ab("wait", "--text", "Partial reconnect-example");
  await ab("fill", 'textarea[aria-label="Message"]', "unsent draft");
  await evaluate(
    `window.originalTranscript=document.querySelector('main .h-full.overflow-y-auto');originalTranscript.scrollTop=150;originalTranscript.dispatchEvent(new Event('scroll'));true`,
  );
  const before = await evaluate(observe);
  assert.equal(before.scrollTop, 150);
  assert.equal(before.prompts, 2);
  // Keep incoming frames working while the outgoing path silently fails.
  await evaluate("window.dropOutbound=true;true");
  await ab(
    "wait",
    "--fn",
    `document.querySelector('textarea[aria-label="Message"]')?.disabled===true`,
  );
  await ab("wait", "--text", "Reconnecting");
  const halfOpen = await evaluate(observe);
  await capture("half-open");
  assert.equal(halfOpen.draft, before.draft);
  assert.equal(halfOpen.prompts, before.prompts, "health checks never replay input");
  await evaluate("window.dropOutbound=false;true");
  await ab(
    "wait",
    "--fn",
    `document.querySelector('textarea[aria-label="Message"]')?.disabled===false`,
  );
  await evaluate("window.holdFrames=true;control.close();true");
  await ab("wait", "--fn", "controlConnections>=2&&control.readyState===1&&held.length>0");
  const during = await evaluate(observe);
  await capture("awaiting-snapshot");
  await evaluate("window.holdFrames=false;held.splice(0).forEach(deliver=>deliver());true");
  await ab(
    "wait",
    "--fn",
    `document.querySelector('textarea[aria-label="Message"]')?.disabled===false`,
  );
  const after = await evaluate(observe);
  await capture("reattached");
  writeFileSync(
    join(evidence, "observations.json"),
    JSON.stringify({ before, halfOpen, during, after }, null, 2),
  );
  for (const [phase, observed] of [
    ["during", during],
    ["after", after],
  ]) {
    assert.equal(observed.pageToken, before.pageToken, `${phase}: no document reload`);
    assert.equal(observed.timeOrigin, before.timeOrigin);
    assert.equal(observed.path, before.path);
    assert.equal(observed.prompts, before.prompts, `${phase}: never replay prompts`);
    assert.equal(observed.loading, false, `${phase}: no Loading flash`);
    assert.equal(observed.sameTranscript, true, `${phase}: keep the transcript mounted`);
    assert.equal(observed.messagesPresent, true);
    assert.equal(observed.partialPresent, true);
    assert.equal(observed.draft, before.draft);
    assert.equal(observed.scrollTop, before.scrollTop, `${phase}: keep reading position`);
  }
  assert.equal(during.disabled, true, "wait for attachment before enabling actions");
  assert.equal(after.disabled, false);
  console.log(
    "PASS: a live burst reaches its final state and notice without overflow or reconnect; half-open outgoing connections show Reconnecting and disable actions; recovery keeps the conversation, partial reply, draft and scroll position; actions wait for the snapshot; no prompt replay",
  );
} finally {
  try {
    await ab("close");
  } catch {}
  for (const p of [backend, frontend])
    if (p.exitCode === null) {
      const done = new Promise((resolve) => p.once("exit", resolve));
      p.kill("SIGTERM");
      await done;
    }
  writeFileSync(join(evidence, "commands.json"), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, "process.log"), processLog);
  rmSync(root, { recursive: true, force: true });
}
