/**
 * Fan-out and status through the interface a shell orchestrator uses: `scripts/dispatch-session.ts`
 * against a running `server/main.ts`, with the fake Pi and the installed Worktrunk on a throwaway
 * repository. A start with `--worktree` must place its session in a new worktree or create
 * nothing; `status` and `list` must answer from what Piano holds, before and after a restart.
 */
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import pianoSessions from "../extensions/piano-sessions/index.ts";
import type { SessionStatus, StartToolResult } from "../shared/dispatch.ts";

const script = fileURLToPath(new URL("../scripts/dispatch-session.ts", import.meta.url));

const freePort = async () => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  return address.port;
};

test("a shell fans out into fresh worktrees and reads each child's status, across a restart", {
  timeout: 120_000,
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-fan-out-")));
  const git = (dir: string, ...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "-b", "main");
  git(
    repo,
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@example.invalid",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  );
  const worktrees = () =>
    git(repo, "worktree", "list", "--porcelain")
      .split("\n")
      .filter((line) => line.startsWith("worktree "));
  const plain = join(root, "plain");
  mkdirSync(plain);

  // The installed Worktrunk, isolated from the user's configuration and approvals.
  const config = join(root, "config");
  mkdirSync(join(config, "worktrunk"), { recursive: true });
  writeFileSync(join(config, "worktrunk", "config.toml"), "");
  const wtPath = execFileSync("which", ["wt"], { encoding: "utf8" }).trim();
  const wt = join(root, "wt");
  const isolated = {
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_STATE_HOME: join(root, "state"),
    WORKTRUNK_CONFIG_PATH: join(config, "worktrunk", "config.toml"),
  };
  mkdirSync(isolated.HOME);
  writeFileSync(
    wt,
    `#!${process.execPath}\nimport {spawnSync} from 'node:child_process';const r=spawnSync(${JSON.stringify(wtPath)},process.argv.slice(2),{stdio:'inherit',env:{...process.env,...${JSON.stringify(isolated)}}});process.exit(r.status??1);\n`,
    { mode: 0o755 },
  );

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    PIANO_DB_PATH: join(root, "registry.db"),
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"),
    PIANO_ALLOWED_ORIGINS: base,
    PIANO_PI_CLI: fileURLToPath(new URL("fake-pi.mjs", import.meta.url)),
    PIANO_WT_CLI: wt,
    PIANO_SESSION_WS_URL: `ws://127.0.0.1:${port}/ws`,
    PIANO_SESSION_ORIGIN: base,
  };

  let logs = "";
  const startPiano = async () => {
    const child = spawn(process.execPath, ["server/main.ts"], {
      cwd: new URL("..", import.meta.url),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      logs += chunk;
    });
    child.stderr.on("data", (chunk) => {
      logs += chunk;
    });
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        if ((await fetch(`${base}/api/folders`)).ok) return child;
      } catch {
        /* startup */
      }
      assert.ok(Date.now() < deadline && child.exitCode === null, logs);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const stopPiano = async (child: ReturnType<typeof spawn>) => {
    if (child.exitCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(force);
  };
  const dispatch = (...args: string[]) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile(
        process.execPath,
        [script, ...args],
        { env, timeout: 40_000 },
        (error, stdout, stderr) =>
          resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
      );
    });
  const brief = (name: string, text: string) => {
    const file = join(root, `${name}.txt`);
    writeFileSync(file, text);
    return file;
  };
  const start = async (name: string, text: string, cwd: string, ...options: string[]) => {
    const result = await dispatch(brief(name, text), cwd, ...options);
    assert.equal(result.code, 0, `${result.stderr}\n${logs}`);
    return JSON.parse(result.stdout) as StartToolResult;
  };
  const status = async (sessionId: string) => {
    const result = await dispatch("status", sessionId);
    assert.equal(result.code, 0, `${result.stderr}\n${logs}`);
    return JSON.parse(result.stdout) as SessionStatus;
  };
  /** One read answers at once; an orchestrator that wants a later answer reads again. */
  const statusUntil = async (sessionId: string, disposition: SessionStatus["disposition"]) => {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const read = await status(sessionId);
      if (read.disposition === disposition) return read;
      assert.ok(Date.now() < deadline, `still ${read.disposition}: ${JSON.stringify(read)}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  let piano = await startPiano();
  try {
    // Three children, each on its own new branch, all from the main checkout's repository.
    const echo = await start("a", "fix the parser", repo, "--worktree", "task-a");
    assert.equal(echo.creation, "created", JSON.stringify(echo));
    assert.ok(echo.handle && echo.worktree);
    assert.equal(echo.worktree.branch, "task-a");
    assert.equal(echo.cwd, echo.worktree.path, "the session is placed in the created worktree");
    assert.notEqual(echo.cwd, repo, "never the parent's checkout");
    assert.equal(git(echo.cwd, "branch", "--show-current"), "task-a");
    assert.equal(echo.link, `${base}/s/${echo.handle.sessionId}`);
    // From inside a linked worktree, the next worktree still belongs to the main checkout's folder.
    const asks = await start("b", "ask for a value", echo.cwd, "--worktree", "task-b");
    assert.equal(asks.worktree?.branch, "task-b");
    assert.equal(git(asks.cwd, "branch", "--show-current"), "task-b");
    const crash = await start("c", "crash now", repo, "--worktree", "task-c");
    assert.equal(crash.worktree?.branch, "task-c");

    const folders = (await (await fetch(`${base}/api/folders`)).json()) as {
      folders: { path: string; worktrees: { path: string; branch: string | null }[] }[];
    };
    assert.deepEqual(
      folders.folders.map((f) => f.path),
      [repo],
      "the worktrees join the repository's folder; none becomes a folder of its own",
    );
    const listed = new Map(folders.folders[0]!.worktrees.map((w) => [w.path, w.branch]));
    for (const child of [echo, asks, crash])
      assert.equal(listed.get(child.cwd), child.worktree?.branch);

    // Failures create no session, and nothing falls back to the checkout it was asked from.
    const before = worktrees();
    for (const [cwd, branch, detail] of [
      [repo, "task-a", /^Branch task-a already exists\. Enter a new branch name\.$/],
      [plain, "task-d", /not a Git checkout/],
    ] as const) {
      const refused = await start("refused", "should not start", cwd, "--worktree", branch);
      assert.equal(refused.creation, "refused", JSON.stringify(refused));
      assert.equal(refused.submission, "not_sent");
      assert.equal(refused.handle, null);
      assert.equal(refused.worktree, null);
      assert.match(refused.detail ?? "", detail);
    }
    assert.deepEqual(worktrees(), before);
    // A repository hook nobody approved refuses a start that asks to run hooks.
    mkdirSync(join(repo, ".config"));
    writeFileSync(join(repo, ".config", "wt.toml"), 'pre-start = "touch hook-ran"\n');
    git(repo, "add", ".config");
    git(
      repo,
      "-c",
      "user.name=T",
      "-c",
      "user.email=t@example.invalid",
      "commit",
      "-q",
      "-m",
      "hook",
    );
    const unapproved = await start(
      "hook",
      "should not start",
      repo,
      "--worktree",
      "task-h",
      "--hooks",
    );
    assert.equal(unapproved.creation, "refused", JSON.stringify(unapproved));
    assert.match(unapproved.detail ?? "", /approv/i);
    assert.equal(git(repo, "branch", "--list", "task-h"), "", "no branch was created");
    assert.deepEqual(worktrees(), before);

    // Status by ID, from a process that did not start the session.
    const settled = await statusUntil(echo.handle.sessionId, "settled");
    assert.equal(settled.lastAnswer, "echo: fix the parser");
    assert.deepEqual(settled.changes, { branch: "task-a", files: 0, pullRequest: null });
    assert.equal(settled.cwd, echo.cwd);
    assert.equal(settled.link, echo.link);
    assert.equal(settled.needs, null);
    assert.equal(settled.projectId, null);
    assert.ok(settled.since && !Number.isNaN(Date.parse(settled.since)));

    const waiting = await statusUntil(asks.handle!.sessionId, "needs_input");
    assert.deepEqual(waiting.needs, { title: "Enter a value", kind: "input", link: asks.link });
    assert.equal(waiting.lastAnswer, null);

    await statusUntil(crash.handle!.sessionId, "exited");

    // A file the child wrote counts as one of its own changes, and only its own.
    writeFileSync(join(echo.cwd, "parser.ts"), "export {};\n");
    assert.equal((await status(echo.handle.sessionId)).changes?.files, 1);
    assert.equal((await status(asks.handle!.sessionId)).changes?.files, 0);

    const unknown = await dispatch("status", "no-such-session");
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /lists no session no-such-session/);

    // A project's sessions, one JSON object per line.
    const socket = new WebSocket(env.PIANO_SESSION_WS_URL, {
      headers: { Origin: base },
    } as unknown as string[]);
    await once(socket, "open");
    for (const child of [echo, asks])
      socket.send(
        JSON.stringify({
          _tag: "save_project",
          project: { id: "fan-out", name: "Fan-out" },
          assign: { cwd: child.cwd, sessionId: child.handle!.sessionId },
        }),
      );
    const deadline = Date.now() + 10_000;
    let lines: SessionStatus[] = [];
    while (lines.length < 2) {
      assert.ok(Date.now() < deadline, "project membership never arrived");
      const listedProject = await dispatch("list", "--project", "fan-out");
      assert.equal(listedProject.code, 0, listedProject.stderr);
      lines = listedProject.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    }
    socket.close();
    assert.deepEqual(
      new Map(lines.map((s) => [s.sessionId, [s.disposition, s.projectId]])),
      new Map([
        [echo.handle.sessionId, ["settled", "fan-out"]],
        [asks.handle!.sessionId, ["needs_input", "fan-out"]],
      ]),
    );
    assert.equal((await dispatch("list", "--project", "missing")).code, 2);

    // The same from inside a Piano session: the extension's registered tools, launched as Piano
    // launches Pi, called the way Pi calls them.
    const tools = new Map<
      string,
      { execute: (...args: unknown[]) => Promise<{ details: unknown }> }
    >();
    const launch = { ...process.env };
    Object.assign(process.env, {
      PIANO_SESSION_WS_URL: env.PIANO_SESSION_WS_URL,
      PIANO_SESSION_ORIGIN: env.PIANO_SESSION_ORIGIN,
    });
    try {
      pianoSessions({
        registerFlag: () => {},
        getFlag: () => undefined,
        on: () => {},
        registerTool: (tool: { name: string }) => tools.set(tool.name, tool as never),
      } as unknown as ExtensionAPI);
    } finally {
      process.env = launch;
    }
    const parent = {
      cwd: echo.cwd,
      sessionManager: { getSessionId: () => echo.handle!.sessionId },
    };
    const fanned = (
      await tools
        .get("piano_start_session")!
        .execute(
          "call-1",
          { prompt: "write the changelog", worktree: { branch: "task-e" } },
          undefined,
          undefined,
          parent,
        )
    ).details as StartToolResult;
    assert.equal(fanned.creation, "created", JSON.stringify(fanned));
    assert.equal(fanned.worktree?.branch, "task-e");
    assert.equal(git(fanned.cwd, "branch", "--show-current"), "task-e");
    const read = (
      await tools
        .get("piano_session_status")!
        .execute("call-2", { sessionId: asks.handle!.sessionId }, undefined, undefined, parent)
    ).details as SessionStatus;
    assert.deepEqual(
      [read.disposition, read.needs?.title, read.link],
      ["needs_input", "Enter a value", asks.link],
    );
    await assert.rejects(
      tools
        .get("piano_session_status")!
        .execute("call-3", { sessionId: "nobody" }, undefined, undefined, parent),
      /lists no session nobody/,
    );

    // After a restart the live facts are gone: the same shape, never a guess.
    await stopPiano(piano);
    piano = await startPiano();
    for (const child of [echo, asks, crash]) {
      const after = await status(child.handle!.sessionId);
      assert.deepEqual(Object.keys(after).sort(), Object.keys(settled).sort());
      // The fake Pi keeps no history file, so nothing proves an ending.
      assert.equal(after.disposition, "unknown", JSON.stringify(after));
      assert.equal(after.changes?.branch, child.worktree?.branch);
    }
  } finally {
    await stopPiano(piano);
    rmSync(root, { recursive: true, force: true });
  }
});
