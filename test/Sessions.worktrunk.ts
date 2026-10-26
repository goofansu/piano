import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Fiber, Layer, Queue, type Scope } from "effect";
import { makeClientSessions } from "../server/ClientSessions.ts";
import { PiCli } from "../server/PiCli.ts";
import { PiSessionsLive } from "../server/PiSessions.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionHosts, SessionHostsLive } from "../server/SessionHosts.ts";
import { WorktrunkCommand } from "../server/Worktrees.ts";
import type { ServerMessage } from "../shared/wire.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-client-sessions-")));
const cwd = join(root, "checkout");
mkdirSync(cwd);
mkdirSync(join(root, "sessions"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
after(() => rmSync(root, { recursive: true, force: true }));

let databases = 0;
const run = <A, E>(
  effect: Effect.Effect<A, E, SessionHosts | Registry | Scope.Scope>,
  path = join(root, `registry-${++databases}.db`),
  pi: { readonly cli: string; readonly extraArgs: ReadonlyArray<string> } = {
    cli: new URL("./fake-pi.mjs", import.meta.url).pathname,
    extraArgs: [],
  },
) => {
  const layer = SessionHostsLive({ idleMs: 0 }).pipe(
    Layer.provide(PiSessionsLive),
    Layer.provideMerge(RegistryLive),
    Layer.provide(NodeServices.layer),
  );
  return Effect.runPromise(
    effect.pipe(
      Effect.scoped,
      Effect.provide(layer),
      Effect.provideService(PiCli, { node: process.execPath, ...pi }),
      Effect.provideService(RegistryDatabasePath, path),
      Effect.timeout("10 seconds"),
    ),
  );
};

/** A client whose messages are recorded in order and can be awaited. */
const client = Effect.gen(function* () {
  const sent: ServerMessage[] = [];
  const queue = yield* Queue.unbounded<ServerMessage>();
  const sessions = yield* makeClientSessions({
    send: (m) =>
      Effect.sync(() => sent.push(m)).pipe(Effect.andThen(Queue.offer(queue, m)), Effect.asVoid),
    overflow: (e) => Effect.die(e),
  });
  const next = (pred: (m: ServerMessage) => boolean) =>
    Effect.gen(function* () {
      for (;;) {
        const m = yield* Queue.take(queue);
        if (pred(m)) return m;
      }
    });
  return { sessions, sent, next };
});
const started = (id?: string) =>
  Effect.gen(function* () {
    const sessionId = id ?? crypto.randomUUID();
    yield* (yield* Registry).addSession(cwd, sessionId);
    return yield* (yield* SessionHosts).open({ cwd, sessionId });
  });
/** An action whose result (an empty restored queue) reaches only its requester. */
const restoreQueue = { _tag: "restore_queue" } as const;
const resultFor = (sent: ServerMessage[]) =>
  sent
    .filter((m) => m._tag === "action_result")
    .map((m) => m._tag === "action_result" && m.sessionId);

test("INV-05: selecting another session while a worktree is still being created shows it at once", {
  timeout: 30_000,
}, async () => {
  const git = (dir: string, ...args: string[]) => {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  const repo = join(root, "creating-repo");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "-b", "main");
  git(
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "baseline",
  );
  // The installed Worktrunk, isolated from the user's configuration, held at `switch` until the
  // test releases it (or 20 seconds pass, so a failing run cannot leave it waiting).
  const config = join(root, "creating-wt", "config", "worktrunk");
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "config.toml"), "");
  const isolated = {
    HOME: join(root, "creating-wt", "home"),
    XDG_CONFIG_HOME: join(root, "creating-wt", "config"),
    XDG_CACHE_HOME: join(root, "creating-wt", "cache"),
    XDG_STATE_HOME: join(root, "creating-wt", "state"),
    WORKTRUNK_CONFIG_PATH: join(config, "config.toml"),
  };
  mkdirSync(isolated.HOME);
  const real = spawnSync("which", ["wt"], { encoding: "utf8" }).stdout.trim();
  const waiting = join(root, "creating-wt", "waiting");
  const release = join(root, "creating-wt", "release");
  const wt = join(root, "creating-wt", "wt");
  writeFileSync(
    wt,
    `#!${process.execPath}\nimport {spawnSync} from 'node:child_process';import {existsSync,writeFileSync} from 'node:fs';
const a=process.argv.slice(2);
if(a.includes('switch')){writeFileSync(${JSON.stringify(waiting)},'');for(let n=0;n<1000&&!existsSync(${JSON.stringify(release)});n++)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}
const r=spawnSync(${JSON.stringify(real)},a,{stdio:'inherit',env:{...process.env,...${JSON.stringify(isolated)}}});process.exit(r.status??1);\n`,
    { mode: 0o755 },
  );
  await run(
    Effect.gen(function* () {
      const b = yield* started();
      const { sessions, sent, next } = yield* client;
      const creating = yield* (yield* sessions.create({
        selectionId: "creating",
        cwd: repo,
        options: {},
        worktree: { branch: "held" },
      })).pipe(Effect.forkChild);
      for (let n = 0; !existsSync(waiting); n++) {
        if (n > 250) return yield* Effect.die(new Error("Worktrunk never started"));
        yield* Effect.sleep("20 millis");
      }
      yield* yield* sessions.select({ cwd, sessionId: b.spec.sessionId, selectionId: "B" });
      const selected = yield* next((m) => m._tag === "selected");
      assert.ok(selected._tag === "selected");
      assert.deepEqual([selected.selectionId, selected.sessionId], ["B", b.spec.sessionId]);
      assert.equal(existsSync(release), false, "B was shown while Worktrunk was still held");
      writeFileSync(release, "");
      yield* Fiber.join(creating);
      // The finished creation is registered but not shown, and B stays the attached selection.
      assert.ok((yield* (yield* Registry).get).sessions.some((s) => s.cwd !== cwd));
      assert.deepEqual(
        sent.filter((m) => "selectionId" in m && m.selectionId === "creating"),
        [],
      );
      yield* sessions.act("B", restoreQueue);
      assert.deepEqual(resultFor(sent), [b.spec.sessionId]);
    }).pipe(
      Effect.ensuring(Effect.sync(() => writeFileSync(release, ""))),
      Effect.provideService(WorktrunkCommand, wt),
    ),
  );
});

test("INV-02/06: a requester that leaves while Worktrunk runs cannot interrupt creation into a half-made checkout", {
  timeout: 30_000,
}, async () => {
  const git = (dir: string, ...args: string[]) => {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const repo = join(root, "slow-repo");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "-b", "main");
  git(
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "baseline",
  );
  // The installed Worktrunk, isolated from the user's configuration, and slow to start creating.
  const config = join(root, "wt-config", "worktrunk");
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "config.toml"), "");
  const isolated = {
    HOME: join(root, "wt-home"),
    XDG_CONFIG_HOME: join(root, "wt-config"),
    XDG_CACHE_HOME: join(root, "wt-cache"),
    XDG_STATE_HOME: join(root, "wt-state"),
    WORKTRUNK_CONFIG_PATH: join(config, "config.toml"),
  };
  mkdirSync(isolated.HOME);
  const real = spawnSync("which", ["wt"], { encoding: "utf8" }).stdout.trim();
  const started = join(root, "wt-started");
  const wt = join(root, "slow-wt");
  writeFileSync(
    wt,
    `#!${process.execPath}\nimport {spawnSync} from 'node:child_process';import {writeFileSync} from 'node:fs';
const a=process.argv.slice(2);
if(a.includes('switch')){writeFileSync(${JSON.stringify(started)},'');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);}
const r=spawnSync(${JSON.stringify(real)},a,{stdio:'inherit',env:{...process.env,...${JSON.stringify(isolated)}}});process.exit(r.status??1);\n`,
    { mode: 0o755 },
  );
  const until = <A>(read: Effect.Effect<A | undefined>, what: string) =>
    Effect.gen(function* () {
      for (let n = 0; n < 500; n++) {
        const value = yield* read;
        if (value !== undefined) return value;
        yield* Effect.sleep("20 millis");
      }
      return yield* Effect.die(new Error(`never observed: ${what}`));
    });
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      const requester = yield* hosts
        .create({ cwd: repo, options: {}, worktree: { branch: "slow" } })
        .pipe(Effect.forkChild);
      yield* until(
        Effect.sync(() => (existsSync(started) ? true : undefined)),
        "Worktrunk running",
      );
      yield* Fiber.interrupt(requester);
      // Without its requester, the creation still completes: the worktree, its registration
      // under the repository's folder, the session's reference and its running child.
      const entry = yield* until(
        Effect.map(registry.get, (data) => data.sessions.find((s) => s.cwd !== repo)),
        "a session registered in the new worktree",
      );
      assert.ok(git(repo, "worktree", "list", "--porcelain").includes(`worktree ${entry.cwd}\n`));
      assert.equal(git(entry.cwd, "branch", "--show-current"), "slow");
      // Git reports physical paths; the fixture root may be reached through a symlink (macOS /var).
      assert.deepEqual((yield* registry.get).worktrees, [
        { folder: realpathSync(repo), path: entry.cwd, branch: "slow" },
      ]);
      yield* until(
        Effect.map(hosts.list, (list) =>
          list.some((h) => h.sessionId === entry.sessionId) ? true : undefined,
        ),
        "the session's child running",
      );
      yield* hosts.release(entry.cwd, entry.sessionId);
    }).pipe(Effect.provideService(WorktrunkCommand, wt)),
  );
});
