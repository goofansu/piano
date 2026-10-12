// INV-01/06: the header follows external Git checkouts without reloading or opening Changes.
// node test/browser-session-branch.mjs <evidence-directory>
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { registryEnv } from "./fixtures/registry.ts";

const evidence = resolve(process.argv[2] ?? "/tmp/piano-session-branch-evidence");
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "piano-session-branch-"));
const repo = join(root, "repo"),
  sessions = join(root, "sessions");
mkdirSync(repo);
mkdirSync(sessions);
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
git("init", "-q", "-b", "main");
git(
  "-c",
  "user.name=Test",
  "-c",
  "user.email=test@example.invalid",
  "commit",
  "--allow-empty",
  "-qm",
  "Initial",
);
const timestamp = new Date().toISOString();
writeFileSync(
  join(sessions, "branch.jsonl"),
  [
    { type: "session", version: 3, id: "branch", cwd: repo, timestamp },
    {
      type: "message",
      id: "m0",
      parentId: null,
      timestamp,
      message: { role: "user", content: "Branch verification", timestamp: 0 },
    },
  ]
    .map(JSON.stringify)
    .join("\n") + "\n",
);
writeFileSync(
  join(root, "registry.json"),
  JSON.stringify({
    folders: [repo],
    worktrees: [],
    sessions: [
      {
        cwd: repo,
        sessionId: "branch",
        title: "Branch verification",
        createdAt: timestamp,
        updatedAt: timestamp,
        archived: false,
      },
    ],
  }),
);
async function freePort() {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
const backendUrl = `http://127.0.0.1:${await freePort()}`;
const frontendPort = String(await freePort());
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const backend = spawn(process.execPath, ["server/main.ts"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: new URL(backendUrl).port,
    PIANO_ALLOWED_ORIGINS: frontendUrl,
    ...registryEnv(join(root, "registry.json")),
    PIANO_PI_CLI: resolve("test/fake-pi.mjs"),
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
    frontendPort,
    "--strictPort",
  ],
  {
    cwd: resolve("web"),
    env: { ...process.env, PIANO_DEV_BACKEND: backendUrl },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let processLog = "";
for (const p of [backend, frontend]) {
  p.stdout.on("data", (d) => (processLog += d));
  p.stderr.on("data", (d) => (processLog += d));
}
const commands = [];
async function ab(...args) {
  const result = await new Promise((resolveResult, reject) => {
    const p = spawn("npx", ["agent-browser", "--session", `branch-${process.pid}`, ...args]);
    let stdout = "",
      stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("exit", (status) => resolveResult({ status, stdout, stderr }));
  });
  commands.push({ args, ...result });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
const header = () => ab("eval", "document.querySelector('header').textContent");
try {
  for (let n = 0; ; n++) {
    try {
      if ((await fetch(`${backendUrl}/api/folders`)).ok && (await fetch(frontendUrl)).ok) break;
    } catch {}
    if (n === 100) throw new Error("Startup deadline");
    await delay(100);
  }
  await ab("set", "viewport", "1280", "900");
  await ab("open", `${frontendUrl}/s/branch`);
  await ab(
    "wait",
    "--fn",
    "document.querySelector('header')?.textContent.includes('Git branch: main')",
  );
  git("checkout", "-qb", "agent-feature");
  await delay(6500);
  assert.match(
    await header(),
    /Git branch: agent-feature/,
    "header must observe checkout without reload",
  );
  assert.doesNotMatch(
    await header(),
    /Worktree: main/,
    "root checkout must not masquerade as the main branch",
  );
  await ab("screenshot", join(evidence, "branch.png"));
  git("checkout", "-q", "--detach");
  await delay(6500);
  assert.doesNotMatch(await header(), /Git branch:/, "detached HEAD must clear the old branch");
  git("checkout", "-q", "main");
  await ab("eval", "window.dispatchEvent(new Event('focus')); true");
  await ab(
    "wait",
    "--fn",
    "document.querySelector('header')?.textContent.includes('Git branch: main')",
  );
  console.log("PASS: checkout, detached HEAD, focus refresh");
} finally {
  await ab("close").catch(() => {});
  writeFileSync(join(evidence, "commands.json"), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, "processes.log"), processLog);
  backend.kill();
  frontend.kill();
  await Promise.all(
    [backend, frontend].map((p) =>
      p.exitCode !== null ? undefined : new Promise((r) => p.once("exit", r)),
    ),
  );
  rmSync(root, { recursive: true, force: true });
}
