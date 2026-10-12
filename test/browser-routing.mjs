// URL/rendering regression against separate scratch backend/Vite processes.
// Run: node test/browser-routing.mjs /tmp/piano-routing-evidence
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { registryEnv } from "./fixtures/registry.ts";

const evidence = resolve(process.argv[2] ?? "/tmp/piano-routing-evidence");
mkdirSync(evidence, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "piano-routing-"));
const repo = join(scratch, "repo");
mkdirSync(repo);
spawnSync("git", ["init", repo]);
writeFileSync(
  join(scratch, "registry.json"),
  JSON.stringify({ folders: [repo], worktrees: [], sessions: [] }),
);
const backend = spawn(process.execPath, ["server/main.ts"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: "7171",
    PIANO_ALLOWED_ORIGINS: "http://127.0.0.1:7172,http://localhost:7172",
    ...registryEnv(join(scratch, "registry.json")),
    PIANO_PI_CLI: resolve("test/fake-pi.mjs"),
    PI_CODING_AGENT_DIR: join(scratch, "agent"),
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
let serverLog = "";
for (const process of [backend, frontend]) {
  process.stdout.on("data", (d) => (serverLog += d));
  process.stderr.on("data", (d) => (serverLog += d));
}
const session = `routing-${process.pid}`;
const commands = [];
function ab(...args) {
  const result = spawnSync("npx", ["agent-browser", "--session", session, ...args], {
    encoding: "utf8",
    timeout: 45000,
  });
  commands.push({ args, status: result.status, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
const evaluate = (js) => JSON.parse(ab("eval", js));
const observe = join(scratch, "observe.js");
// Hold only the external registry message so the initial route is observable, without sleeps.
writeFileSync(
  observe,
  `window.registryReady = !location.pathname.startsWith('/s/');
window.registryMessages = []; window.newPageRenders = 0;
window.releaseRegistry = () => {window.registryReady=true; window.registryMessages.splice(0).forEach(deliver=>deliver());};
const NativeWebSocket = WebSocket;
window.WebSocket = class extends NativeWebSocket {
  set onmessage(handler) { super.onmessage = event => {
    if(JSON.parse(event.data)._tag==='registry' && !window.registryReady) {
      window.registryMessages.push(()=>{if(this.readyState===1)handler(event);});
    } else handler(event);
  }; }
};
new MutationObserver(()=>{
  if(location.pathname.startsWith('/s/') && document.querySelector('[aria-label="First message"]'))window.newPageRenders++;
}).observe(document,{childList:true,subtree:true});`,
);
try {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch("http://127.0.0.1:7172/new")).ok) break;
    } catch {}
    assert.ok(attempt < 49, "Scratch development server did not start");
    await delay(100);
  }
  ab("--init-script", observe, "open", "http://127.0.0.1:7172/new");
  ab("set", "viewport", "390", "844");
  ab(
    "wait",
    "--fn",
    `document.querySelector('[aria-label="Directory"]')?.textContent.includes('repo')`,
  );
  ab("fill", '[aria-label="First message"]', "route fixture");
  ab("click", '[aria-label="Send"]');
  ab("wait", "--text", "echo: route fixture");
  const url = ab("get", "url");
  for (const mode of ["reload", "direct"]) {
    if (mode === "reload") ab("reload");
    else ab("open", url);
    ab("wait", "--fn", "window.registryMessages.length > 0 && !!document.querySelector('main')");
    const loading = evaluate(
      `({path:location.pathname, newPageRenders, newComposer:!!document.querySelector('[aria-label="First message"]'), main:document.querySelector('main').innerText})`,
    );
    writeFileSync(join(evidence, `${mode}-loading.json`), JSON.stringify(loading, null, 2));
    ab("screenshot", join(evidence, `${mode}-loading.png`));
    assert.equal(loading.path, new URL(url).pathname);
    assert.equal(
      loading.newComposer,
      false,
      "Session URL rendered the NewSession composer before the registry arrived",
    );
    assert.equal(loading.newPageRenders, 0, "NewSession flashed on the session URL");
    evaluate("releaseRegistry(); true");
    ab("wait", "--text", "echo: route fixture");
    assert.equal(ab("get", "url"), url);
  }
  ab("open", "http://127.0.0.1:7172/s/missing-session");
  ab("wait", "--fn", "window.registryMessages.length > 0 && !!document.querySelector('main')");
  evaluate("releaseRegistry(); true");
  ab("wait", "--text", "Session not found");
  assert.equal(new URL(ab("get", "url")).pathname, "/s/missing-session");
  assert.equal(evaluate("newPageRenders"), 0);
  ab("screenshot", join(evidence, "missing-session.png"));
  ab("open", "http://127.0.0.1:7172/new");
  ab("wait", '[aria-label="First message"]');
  console.log(
    "PASS: reload/direct session URLs never render NewSession; missing sessions retain their URL; /new renders its composer.",
  );
} finally {
  try {
    ab("close");
  } catch {}
  for (const process of [backend, frontend]) process.kill("SIGTERM");
  await Promise.all(
    [backend, frontend].map((process) =>
      process.exitCode !== null || process.signalCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => process.once("exit", resolve)),
    ),
  );
  writeFileSync(join(evidence, "commands.json"), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, "server.log"), serverLog);
  rmSync(scratch, { recursive: true, force: true });
}
