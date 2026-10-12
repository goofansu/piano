// Scratch-only Subagents usage journey over saved history; no paid model calls.
// node test/browser-subagent-usage.mjs <evidence-dir> [real-session.jsonl | --live]
// Without a session file it saves the two-Run shape of a real pi-subagent session: one Run
// delivered by Notification, wait and agent_result, the other only by its Notification.
// --live withholds that Notification and delivers it through test/fake-delegation-pi.mjs.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { registryEnv } from "./fixtures/registry.ts";

const evidence = resolve(process.argv[2] ?? "/tmp/piano-subagent-usage-evidence");
const live = process.argv[3] === "--live";
const realSession = live ? undefined : process.argv[3];
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "piano-subagent-usage-"));
const cwd = join(root, "project"),
  sessionDir = join(root, "sessions");
mkdirSync(cwd);
mkdirSync(sessionDir);
assert.equal(spawnSync("git", ["init", "--quiet", cwd]).status, 0);

let sessionId;
if (realSession) {
  const lines = readFileSync(realSession, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  lines[0].cwd = cwd;
  sessionId = lines[0].id;
  writeFileSync(
    join(sessionDir, `${lines[0].timestamp.replace(/[:.]/g, "-")}_${sessionId}.jsonl`),
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
  );
} else {
  const saved = SessionManager.create(cwd, sessionDir);
  const usageOf = (cost) => ({
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  });
  const call = (id, name, args) =>
    saved.appendMessage({
      role: "assistant",
      api: "openai-completions",
      provider: "openai",
      model: "gpt-6.1-sol",
      content: [{ type: "toolCall", id, name, arguments: args }],
      usage: usageOf(0.001),
      stopReason: "toolUse",
      timestamp: 1,
    });
  const done = (id, name, text, details) =>
    saved.appendMessage({
      role: "toolResult",
      toolCallId: id,
      toolName: name,
      content: [{ type: "text", text }],
      details,
      isError: false,
      timestamp: 2,
    });
  const probe = { input: 3518, output: 6, cacheRead: 0, cacheWrite: 0, cost: 0.007096 };
  const claude = { input: 10, output: 106, cacheRead: 0, cacheWrite: 20786, cost: 0.042112 };
  const run1 = {
    runId: "run-qbdd-1",
    agent: "usage-probe-pi",
    status: "completed",
    usage: probe,
    model: "openai/gpt-6.1-sol",
  };
  saved.appendMessage({ role: "user", content: "Start two probes", timestamp: 0 });
  call("s1", "agent_start", {
    agent: "usage-probe-pi",
    description: "waited probe",
    prompt: "Reply with exactly: OK",
  });
  done("s1", "agent_start", "Started", {
    kind: "start",
    rowPhrase: "Started",
    tone: "toolTitle",
    agent: "usage-probe-pi",
    subagentId: "subagent-qbdd-1",
    runId: "run-qbdd-1",
  });
  call("s2", "agent_start", {
    agent: "usage-probe-claude",
    description: "unwaited probe",
    prompt: "Reply with exactly: OK",
  });
  done("s2", "agent_start", "Started", {
    kind: "start",
    rowPhrase: "Started",
    tone: "toolTitle",
    agent: "usage-probe-claude",
    subagentId: "subagent-qbdd-2",
    runId: "run-qbdd-2",
  });
  call("w", "agent_wait", { ids: ["run-qbdd-1"] });
  done("w", "agent_wait", "OK", {
    kind: "collection",
    scope: "named",
    runs: [run1],
    stillRunning: 0,
    unknown: 0,
    unavailable: 0,
    noActiveRuns: false,
  });
  call("r", "agent_result", { id: "run-qbdd-1" });
  done("r", "agent_result", "OK", {
    kind: "result",
    rowPhrase: "2 characters",
    tone: "toolOutput",
    outcome: "available",
    run: run1,
  });
  saved.appendCustomMessageEntry("subagent-notification", "OK", true, {
    runId: "run-qbdd-1",
    subagentId: "subagent-qbdd-1",
    agent: "usage-probe-pi",
    label: "waited probe",
    status: "completed",
    durationMillis: 2407,
    usage: probe,
    model: "openai/gpt-6.1-sol",
  });
  if (!live)
    saved.appendCustomMessageEntry("subagent-notification", "OK", true, {
      runId: "run-qbdd-2",
      subagentId: "subagent-qbdd-2",
      agent: "usage-probe-claude",
      label: "unwaited probe",
      status: "completed",
      durationMillis: 4461,
      usage: claude,
      model: "claude-haiku-4-5-20251001",
    });
  saved.appendMessage({
    role: "assistant",
    api: "openai-completions",
    provider: "openai",
    model: "gpt-6.1-sol",
    content: [{ type: "text", text: "Both probes finished." }],
    usage: usageOf(0.002),
    stopReason: "stop",
    timestamp: 3,
  });
  sessionId = saved.getSessionId();
}
const registry = join(root, "registry.json");
const now = new Date().toISOString();
writeFileSync(
  registry,
  JSON.stringify({
    folders: [cwd],
    worktrees: [],
    sessions: [{ cwd, sessionId, title: "Subagent usage", createdAt: now, updatedAt: now }],
  }),
);
const server = spawn(process.execPath, ["server/main.ts"], {
  env: {
    ...process.env,
    HOME: root,
    HOST: "127.0.0.1",
    PORT: "7171",
    ...registryEnv(registry),
    PI_CODING_AGENT_SESSION_DIR: sessionDir,
    ...(live ? { PIANO_PI_CLI: resolve("test/fake-delegation-pi.mjs"), PIANO_PI_ARGS: "" } : {}),
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
for (const child of [server, frontend]) {
  child.stdout.on("data", (d) => (processLog += d));
  child.stderr.on("data", (d) => (processLog += d));
}
const browserSession = `subagent-usage-${process.pid}`,
  commands = [];
async function ab(...args) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn("npx", ["agent-browser", "--session", browserSession, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("exit", (status) => resolve({ status, stdout, stderr }));
  });
  commands.push({ args, ...result });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
const evaluate = async (js) => JSON.parse(await ab("eval", js));
const table = (label) =>
  evaluate(
    `[...document.querySelectorAll('[aria-label="${label}"] tr')].map(row => [...row.children].map(cell => [...cell.childNodes].map(node => node.textContent).filter(Boolean)).flat())`,
  );
try {
  for (let i = 0; i < 100; i++) {
    assert.equal(server.exitCode, null);
    assert.equal(frontend.exitCode, null);
    try {
      if ((await fetch("http://127.0.0.1:7172")).ok) break;
    } catch {}
    if (i === 99) throw new Error("Scratch UI startup timed out");
    await delay(100);
  }
  await ab("open", `http://127.0.0.1:7172/s/${sessionId}`);
  const observed = {};
  if (live) {
    await ab("set", "viewport", "1280", "900");
    await ab("click", '[aria-label="Context usage"]');
    await ab("wait", "--text", "All subagents");
    observed.beforeLive = await table("Subagent usage by profile");
    assert.deepEqual(observed.beforeLive.slice(1, 3), [
      ["usage-probe-pi", "gpt-6.1-sol", "3,524", "$0.0071"],
      ["All subagents", "3,524", "$0.0071"],
    ]);
    await ab("press", "Escape");
    await ab("fill", "textarea", "/usage-live");
    await ab("press", "Enter");
    await ab("click", '[aria-label="Context usage"]');
    await ab("wait", "--text", "usage-probe-claude");
    observed.live = await table("Subagent usage by profile");
    await ab("press", "Escape");
    await ab("reload");
    await ab("wait", '[aria-label="Context usage"]');
  }
  for (const [width, height] of [
    [390, 844],
    [1280, 900],
  ]) {
    await ab("set", "viewport", String(width), String(height));
    await ab("click", '[aria-label="Context usage"]');
    await ab("wait", "--text", "All subagents");
    await ab("scrollintoview", '[aria-label="Subagent usage by profile"]');
    const subagents = await table("Subagent usage by profile");
    assert.deepEqual(subagents, [
      ["Subagents", "Tokens", "Cost"],
      ["usage-probe-pi", "gpt-6.1-sol", "3,524", "$0.0071"],
      ["usage-probe-claude", "claude-haiku-4-5-20251001", "20,902", "$0.0421"],
      ["All subagents", "24,426", "$0.0492"],
    ]);
    const usage = await table("Token and cost breakdown");
    assert.equal(
      await evaluate("document.documentElement.scrollWidth > innerWidth"),
      false,
      "no page overflow",
    );
    observed[width] = { subagents, usage };
    await ab("screenshot", join(evidence, `subagent-usage-${width}.png`));
    await ab("press", "Escape");
  }
  // Spend lives in the popover only; the Run's result card details carry no usage line.
  const notice = '[data-slot="subagent-result-card"][data-run-id="run-qbdd-2"]';
  await ab("scrollintoview", notice);
  await ab("click", `${notice} button`);
  await ab("wait", `${notice} [data-state="open"]`);
  observed.disclosure = await evaluate(
    `document.querySelector(${JSON.stringify(notice)}).innerText`,
  );
  assert.doesNotMatch(observed.disclosure, /Usage|tokens/);
  writeFileSync(join(evidence, "observed.json"), JSON.stringify(observed, null, 2));
  console.log(JSON.stringify(observed[1280], null, 2));
  console.log(
    `PASS: ${live ? "live-delivered then reloaded" : "reopened"} ${realSession ? "real" : "fixture"} session shows usage-probe-pi 3,524 / $0.0071 once despite three deliveries, usage-probe-claude 20,902 / $0.0421, All subagents 24,426 / $0.0492, on mobile and desktop. Zero model calls.`,
  );
} finally {
  await ab("close").catch(() => {});
  for (const child of [frontend, server]) {
    child.kill("SIGTERM");
    await new Promise((resolve) =>
      child.exitCode !== null ? resolve() : child.once("exit", resolve),
    );
  }
  writeFileSync(join(evidence, "commands.json"), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, "processes.log"), processLog);
  rmSync(root, { recursive: true, force: true });
}
