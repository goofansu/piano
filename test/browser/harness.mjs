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

/** Pi history for one session, in Pi's JSONL session format. An item `{ compaction: { summary } }`
 * among the messages becomes a compaction entry that keeps the message before it, and an item
 * `{ custom: { customType, data } }` an extension's custom entry. */
function history(sessions, { sessionId, cwd, messages }) {
  const timestamp = new Date().toISOString();
  let parentId = null;
  const entries = [
    { type: "session", version: 3, id: sessionId, cwd, timestamp },
    ...messages.map((message, i) => {
      const entry = message.custom
        ? { type: "custom", id: `x${i}`, parentId, timestamp, ...message.custom }
        : message.compaction
          ? {
              type: "compaction",
              id: `c${i}`,
              parentId,
              timestamp,
              summary: message.compaction.summary,
              firstKeptEntryId: parentId,
              tokensBefore: message.compaction.tokensBefore ?? 100_000,
            }
          : { type: "message", id: `m${i}`, parentId, timestamp, message };
      parentId = entry.id;
      return entry;
    }),
  ];
  writeFileSync(
    join(sessions, `${sessionId}.jsonl`),
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
}

/** One machine's state. A peer may share a throwaway checkout, never its database or Pi dirs. */
async function fixture(root, setup) {
  const sessions = join(root, "sessions");
  for (const dir of ["sessions", "agent", "home", "config", "cache", "state", "data"])
    mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, "config/worktrunk.toml"), "");
  const database = join(root, "piano.db");
  seedRegistry(
    database,
    await setup({
      root,
      repository: (folder) => repository(root, folder),
      history: (session) => history(sessions, session),
    }),
  );
  const audit = join(root, "audit.jsonl");
  const received = () =>
    existsSync(audit)
      ? readFileSync(audit, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
      : [];
  return { root, sessions, database, audit, received };
}

/**
 * `setup({ root, repository, history })` returns the main machine's registry seed.
 * `options.peers = [{ id, name, setup, backendEnv? }]` adds independent headless peers, seeded
 * with the same helpers. `remote` remains the one-peer shorthand. Only main gets PIANO_PEER_CONFIG.
 * `journey(page)` drives the browser; a thrown error fails the run after capturing the page.
 */
export async function run(name, setup, journey, options = {}) {
  const evidence = resolve(process.argv[2] ?? join(ROOT, ".scratch/browser", name));
  mkdirSync(evidence, { recursive: true });
  const root = mkdtempSync(join(tmpdir(), `piano-${name}-`));
  const local = await fixture(root, setup);
  const peers = [];
  for (const [index, spec] of (
    options.peers ?? (options.remote ? [options.remote] : [])
  ).entries()) {
    const machine = await fixture(join(root, `peer-${index}`), spec.setup);
    const port = await freePort();
    peers.push({
      machine,
      port,
      backendEnv: spec.backendEnv,
      config: {
        id: spec.id,
        name: spec.name ?? spec.id,
        endpoint: `http://127.0.0.1:${port}`,
        origin: `http://127.0.0.1:${port}`,
      },
    });
  }
  const [backendPort, webPort] = [await freePort(), await freePort()];
  const web = `http://127.0.0.1:${webPort}`;
  const peerConfig = join(root, "peers.json");
  if (peers.length)
    writeFileSync(peerConfig, JSON.stringify({ peers: peers.map((peer) => peer.config) }));
  // Do not inherit a live backend's socket, peers, integration paths or Worktrunk overrides.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(PIANO_|WORKTRUNK_)/.test(key)),
  );
  const environment = (machine) => ({
    ...inherited,
    HOME: join(machine.root, "home"),
    XDG_CONFIG_HOME: join(machine.root, "config"),
    XDG_CONFIG_DIRS: join(machine.root, "config"),
    XDG_CACHE_HOME: join(machine.root, "cache"),
    XDG_STATE_HOME: join(machine.root, "state"),
    XDG_DATA_HOME: join(machine.root, "data"),
    WORKTRUNK_CONFIG_PATH: join(machine.root, "config/worktrunk.toml"),
    WORKTRUNK_SYSTEM_CONFIG_PATH: join(machine.root, "config/worktrunk.toml"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    PIANO_TEST_AUDIT: machine.audit,
    PI_OFFLINE: "1",
    PI_CODING_AGENT_DIR: join(machine.root, "agent"),
    PI_CODING_AGENT_SESSION_DIR: machine.sessions,
  });
  const env = environment(local);
  let log = "";
  const logs = {};
  const relaunch = new WeakMap();
  const start = (label, args, options) => {
    const child = spawn(process.execPath, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    const record = (data) => {
      log += `[${label}] ${data}`;
      logs[label] = (logs[label] ?? "") + data;
    };
    child.stdout.on("data", record);
    child.stderr.on("data", record);
    relaunch.set(child, () => start(label, args, options));
    return child;
  };
  const backend = (label, machine, port, extra) =>
    start(label, [join(ROOT, "server/main.ts")], {
      cwd: ROOT,
      env: {
        ...environment(machine),
        HOST: "127.0.0.1",
        PORT: String(port),
        PIANO_ALLOWED_ORIGINS: `${web},http://localhost:${webPort},http://127.0.0.1:${port}`,
        PIANO_DB_PATH: machine.database,
        PIANO_PI_CLI: join(ROOT, "test/browser/fake-pi.mjs"),
        PIANO_PI_ARGS: "",
        ...extra,
      },
    });
  const children = [
    backend("backend", local, backendPort, {
      ...options.backendEnv,
      ...(peers.length ? { PIANO_PEER_CONFIG: peerConfig, NODE_ENV: "test" } : {}),
    }),
    start(
      "web",
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
  for (const peer of peers) {
    peer.child = backend(`${peer.config.id}-backend`, peer.machine, peer.port, peer.backendEnv);
    children.push(peer.child);
  }
  const peerViews = Object.fromEntries(
    peers.map((peer) => [
      peer.config.id,
      {
        ...peer.config,
        received: peer.machine.received,
        prompts: () =>
          peer.machine
            .received()
            .filter((r) => r.command === "prompt")
            .map((r) => r.text),
        /** Stop only this fixture's recorded backend to observe a single-machine outage. */
        stop: async () => {
          if (peer.child.exitCode !== null || peer.child.signalCode !== null) return;
          const exited = new Promise((done) => peer.child.once("exit", done));
          peer.child.kill("SIGTERM");
          await exited;
        },
      },
    ]),
  );

  const browser = `piano-${name}-${process.pid}`;
  const ab = async (...args) => {
    const result = await new Promise((done, fail) => {
      const child = spawn("agent-browser", ["--session", browser, ...args], {
        env: {
          ...process.env,
          AGENT_BROWSER_DEFAULT_TIMEOUT: "15000",
          ...(options.browserArgs ? { AGENT_BROWSER_ARGS: options.browserArgs } : {}),
        },
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
  let mod;
  const page = {
    ab,
    evidence,
    peers: peerViews,
    remote: peers.length ? peerViews[peers[0].config.id] : undefined,
    /** Restart only this harness's recorded backend; retain its isolated database and Pi history. */
    restartBackend: async ({ signal = "SIGTERM", beforeRestart = async () => {} } = {}) => {
      const previous = children[0];
      const exited =
        previous.exitCode !== null || previous.signalCode !== null
          ? Promise.resolve()
          : new Promise((done) => previous.once("exit", done));
      previous.kill(signal);
      await exited;
      await beforeRestart();
      children[0] = relaunch.get(previous)();
      for (let attempt = 0; ; attempt++) {
        try {
          if ((await fetch(`http://127.0.0.1:${backendPort}/api/folders`)).ok) break;
        } catch {}
        assert.ok(attempt < 300, `scratch Piano did not restart:\n${log}`);
        await delay(100);
      }
    },
    open: (path) => ab("open", `${web}${path}`),
    evaluate: async (js) => {
      const result = await ab("eval", js);
      // A no-return script prints the non-JSON literal undefined.
      return result === "undefined" ? undefined : JSON.parse(result);
    },
    /** Click the control a user would: by its role and accessible name. */
    click: (role, label) => ab("find", "role", role, "click", "--name", label, "--exact"),
    /** Open a picker, pick one option, and wait until the picker has closed. */
    choose: async (picker, option) => {
      await ab("find", "role", "combobox", "click", "--name", picker, "--exact");
      await ab("wait", "--text", option);
      await ab("find", "role", "option", "click", "--name", option, "--exact");
      await ab("wait", "--fn", "!document.querySelector('[data-radix-popper-content-wrapper]')");
    },
    /** Press a key; a leading `Mod+` is the platform's primary modifier, as `web/src/lib/keys.ts` reads it. */
    press: async (key) => {
      if (key.startsWith("Mod+")) {
        mod ??= JSON.parse(
          await ab("eval", `/Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control"`),
        );
        key = `${mod}${key.slice(3)}`;
      }
      return ab("press", key);
    },
    see: (text) => ab("wait", "--text", text),
    until: (js) => ab("wait", "--fn", js),
    capture: (step) => ab("screenshot", join(evidence, `${step}.png`)),
    /** Keep a page CDP session attached for the whole observation (emulation resets on detach). */
    cdp: async (observe) => {
      const socket = new WebSocket(await ab("get", "cdp-url"));
      let id = 0;
      const call = (method, params = {}, sessionId) =>
        new Promise((resolve, reject) => {
          const requestId = ++id;
          const timer = setTimeout(() => {
            socket.removeEventListener("message", receive);
            reject(new Error(`CDP ${method} timed out`));
          }, 10000);
          const receive = ({ data }) => {
            const message = JSON.parse(data);
            if (message.id !== requestId) return;
            clearTimeout(timer);
            socket.removeEventListener("message", receive);
            if (message.error) reject(new Error(JSON.stringify(message.error)));
            else resolve(message.result);
          };
          socket.addEventListener("message", receive);
          socket.send(JSON.stringify({ id: requestId, method, params, sessionId }));
        });
      try {
        await new Promise((resolve, reject) => {
          socket.addEventListener("open", resolve, { once: true });
          socket.addEventListener("error", reject, { once: true });
        });
        const { targetInfos } = await call("Target.getTargets");
        const target = targetInfos.find((t) => t.type === "page" && t.url.startsWith(`${web}/`));
        assert.ok(target, "the scratch page has a CDP target");
        const { sessionId } = await call("Target.attachToTarget", {
          targetId: target.targetId,
          flatten: true,
        });
        // Optional event observation is scoped to this page and ends when the CDP socket closes.
        const onEvent = (listener) =>
          socket.addEventListener("message", ({ data }) => {
            const event = JSON.parse(data);
            if (event.sessionId === sessionId && event.method) listener(event);
          });
        return await observe((method, params) => call(method, params, sessionId), onEvent);
      } finally {
        socket.close();
      }
    },
    /** Count actual browser layouts across an interaction, without a machine-speed threshold. */
    layouts: (interaction) =>
      page.cdp(async (call) => {
        await call("Performance.enable");
        const count = async () => {
          const { metrics } = await call("Performance.getMetrics");
          return metrics.find((m) => m.name === "LayoutCount").value;
        };
        const before = await count();
        await interaction();
        return (await count()) - before;
      }),
    /** What the fake Pis received, in order: `{ command, text?, args?, sessionId }`. */
    received: local.received,
  };
  page.prompts = () =>
    page
      .received()
      .filter((r) => r.command === "prompt")
      .map((r) => r.text);

  const started = Date.now();
  const provenance = {
    name,
    revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    dirty: execFileSync("git", ["status", "--short"], { cwd: ROOT, encoding: "utf8" }).trim(),
    node: process.version,
    platform: process.platform,
    web,
    backend: `http://127.0.0.1:${backendPort}`,
    peers: peers.map((peer) => peer.config),
    pids: children.map((child) => child.pid),
    startedAt: new Date(started).toISOString(),
    outcome: "failed",
  };
  try {
    for (let attempt = 0; ; attempt++) {
      for (const child of children)
        assert.equal(child.exitCode, null, `scratch process exited:\n${log}`);
      try {
        if (
          (await fetch(`http://127.0.0.1:${backendPort}/api/folders`)).ok &&
          (
            await Promise.all(
              peers.map(async (peer) => (await fetch(`${peer.config.endpoint}/api/folders`)).ok),
            )
          ).every(Boolean) &&
          (await fetch(web)).ok
        )
          break;
      } catch {}
      assert.ok(attempt < 300, `scratch Piano did not start:\n${log}`);
      await delay(100);
    }
    await ab("set", "viewport", "1280", "900");
    await journey(page);
    provenance.outcome = "passed";
    console.log(
      `PASS ${name} (${((Date.now() - started) / 1000).toFixed(1)}s), evidence in ${evidence}`,
    );
  } catch (error) {
    try {
      await page.capture("failure");
    } catch {}
    provenance.error = String(error.stack ?? error);
    throw error;
  } finally {
    try {
      await ab("close");
    } catch {}
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((done) => child.once("exit", done));
        child.kill("SIGTERM");
        await exited;
      }
    writeFileSync(join(evidence, "process.log"), log);
    for (const [label, content] of Object.entries(logs))
      writeFileSync(join(evidence, `${label}.log`), content);
    for (const [label, machine] of [
      ["local", local],
      ...peers.map((peer) => [peer.config.id, peer.machine]),
    ])
      if (machine)
        writeFileSync(
          join(evidence, `${label}-audit.jsonl`),
          machine
            .received()
            .map((entry) => JSON.stringify(entry))
            .join("\n") + "\n",
        );
    writeFileSync(
      join(evidence, "run.json"),
      JSON.stringify({ ...provenance, finishedAt: new Date().toISOString() }, null, 2),
    );
    rmSync(root, { recursive: true, force: true });
  }
}
