// Runs one critical-path journey against a scratch Piano: its own folders, registry, Pi history
// and fake Pi (no model calls), a backend and the Vite UI on free ports, and an agent-browser session.
// The real registry, Pi config and ports 8000/8001 are never touched.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { seedRegistry } from "../fixtures/registry.ts";

const ROOT = resolve(import.meta.dirname, "../..");

async function freePort() {
  const server = createServer();
  await new Promise((done, fail) => server.once("error", fail).listen(0, "127.0.0.1", done));
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

/** A committed Git repository in the scratch root. */
function repository(root, name) {
  const path = join(root, name);
  const git = (...args) =>
    execFileSync("git", ["-C", path, ...args], {
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    });
  mkdirSync(path);
  git("init", "-q", "-b", "main");
  writeFileSync(join(path, "README.md"), `# ${name}\n`);
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "init");
  return path;
}

/** Pi history for one session, in Pi's JSONL session format. */
function history(sessions, { sessionId, cwd, messages }) {
  const timestamp = new Date().toISOString();
  let parentId = null;
  const entries = [
    { type: "session", version: 3, id: sessionId, cwd, timestamp },
    ...messages.map((message, i) => {
      const entry = { type: "message", id: `m${i}`, parentId, timestamp, message };
      parentId = entry.id;
      return entry;
    }),
  ];
  writeFileSync(
    join(sessions, `${sessionId}.jsonl`),
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
}

/**
 * `setup({ repository, history })` creates folders and Pi history and returns the registry seed.
 * `journey(page)` drives the browser; a thrown error fails the run after capturing the page.
 */
export async function run(name, setup, journey) {
  const evidence = resolve(process.argv[2] ?? join(ROOT, ".scratch/browser", name));
  mkdirSync(evidence, { recursive: true });
  const root = mkdtempSync(join(tmpdir(), `piano-${name}-`));
  const sessions = join(root, "sessions");
  const audit = join(root, "audit.jsonl");
  for (const dir of [sessions, join(root, "agent"), join(root, "home")]) mkdirSync(dir);
  const database = join(root, "piano.db");
  seedRegistry(
    database,
    await setup({
      repository: (folder) => repository(root, folder),
      history: (session) => history(sessions, session),
    }),
  );

  const [backendPort, webPort] = [await freePort(), await freePort()];
  const web = `http://127.0.0.1:${webPort}`;
  const env = {
    ...process.env,
    HOME: join(root, "home"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    PIANO_TEST_AUDIT: audit,
  };
  let log = "";
  const start = (args, options) => {
    const child = spawn(process.execPath, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    return child;
  };
  const children = [
    start([join(ROOT, "server/main.ts")], {
      cwd: ROOT,
      env: {
        ...env,
        HOST: "127.0.0.1",
        PORT: String(backendPort),
        PIANO_ALLOWED_ORIGINS: `${web},http://localhost:${webPort}`,
        PIANO_DB_PATH: database,
        PIANO_PI_CLI: join(ROOT, "test/browser/fake-pi.mjs"),
        PIANO_PI_ARGS: "",
        PI_CODING_AGENT_DIR: join(root, "agent"),
        PI_CODING_AGENT_SESSION_DIR: sessions,
      },
    }),
    start(
      [
        join(ROOT, "node_modules/vite/bin/vite.js"),
        "--host",
        "127.0.0.1",
        "--port",
        String(webPort),
        "--strictPort",
      ],
      {
        cwd: join(ROOT, "web"),
        env: { ...env, PIANO_DEV_BACKEND: `http://127.0.0.1:${backendPort}` },
      },
    ),
  ];

  const browser = `piano-${name}-${process.pid}`;
  const ab = async (...args) => {
    const result = await new Promise((done, fail) => {
      const child = spawn("npx", ["agent-browser", "--session", browser, ...args], {
        env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "15000" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      const timer = setTimeout(() => child.kill("SIGTERM"), 30000);
      child.on("error", fail);
      child.on("exit", (status) => {
        clearTimeout(timer);
        done({ status, stdout, stderr });
      });
    });
    assert.equal(
      result.status,
      0,
      `agent-browser ${args.join(" ")}: ${result.stderr || result.stdout}`,
    );
    return result.stdout.trim();
  };
  const page = {
    ab,
    open: (path) => ab("open", `${web}${path}`),
    evaluate: async (js) => JSON.parse(await ab("eval", js)),
    /** Click the control a user would: by its role and accessible name. */
    click: (role, label) => ab("find", "role", role, "click", "--name", label, "--exact"),
    /** Open a picker, pick one option, and wait until the picker has closed. */
    choose: async (picker, option) => {
      await ab("find", "role", "combobox", "click", "--name", picker, "--exact");
      await ab("find", "role", "option", "click", "--name", option, "--exact");
      await ab("wait", "--fn", "!document.querySelector('[data-radix-popper-content-wrapper]')");
    },
    see: (text) => ab("wait", "--text", text),
    until: (js) => ab("wait", "--fn", js),
    capture: (step) => ab("screenshot", join(evidence, `${step}.png`)),
    /** What the fake Pis received, in order: `{ command, text?, args?, sessionId }`. */
    received: () =>
      existsSync(audit)
        ? readFileSync(audit, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
        : [],
  };
  page.prompts = () =>
    page
      .received()
      .filter((r) => r.command === "prompt")
      .map((r) => r.text);

  const started = Date.now();
  try {
    for (let attempt = 0; ; attempt++) {
      for (const child of children)
        assert.equal(child.exitCode, null, `scratch process exited:\n${log}`);
      try {
        if (
          (await fetch(`http://127.0.0.1:${backendPort}/api/folders`)).ok &&
          (await fetch(web)).ok
        )
          break;
      } catch {}
      assert.ok(attempt < 300, `scratch Piano did not start:\n${log}`);
      await delay(100);
    }
    await ab("set", "viewport", "1280", "900");
    await journey(page);
    console.log(
      `PASS ${name} (${((Date.now() - started) / 1000).toFixed(1)}s), evidence in ${evidence}`,
    );
  } catch (error) {
    try {
      await page.capture("failure");
    } catch {}
    writeFileSync(join(evidence, "process.log"), log);
    throw error;
  } finally {
    try {
      await ab("close");
    } catch {}
    for (const child of children)
      if (child.exitCode === null) {
        const exited = new Promise((done) => child.once("exit", done));
        child.kill("SIGTERM");
        await exited;
      }
    rmSync(root, { recursive: true, force: true });
  }
}
