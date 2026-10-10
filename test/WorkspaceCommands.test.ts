import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, Stream } from "effect";
import { PiCli } from "../server/PiCli.ts";
import { type PiSession, PiSessionsLive } from "../server/PiSessions.ts";
import { Registry, RegistryDatabasePath, RegistryLive, RegistryLookupError } from "../server/Registry.ts";
import { SessionHosts, SessionHostsLive } from "../server/SessionHosts.ts";
import { WorkspaceCommands, WorkspaceCommandsLive } from "../server/WorkspaceCommands.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-commands-")));
const cwd = join(root, "checkout");
mkdirSync(cwd); mkdirSync(join(root, "sessions"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
after(() => rmSync(root, { recursive: true, force: true }));

const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { stdio: "pipe" });
let databases = 0;
const run = <A, E>(effect: Effect.Effect<A, E, WorkspaceCommands | SessionHosts | Registry>) => {
  const layer = WorkspaceCommandsLive.pipe(
    Layer.provideMerge(SessionHostsLive({ idleMs: 0 })),
    Layer.provide(PiSessionsLive), Layer.provideMerge(RegistryLive), Layer.provide(NodeServices.layer));
  return Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(layer),
    Effect.provideService(PiCli, { node: process.execPath, cli: new URL("./fake-pi.mjs", import.meta.url).pathname, extraArgs: [] }),
    Effect.provideService(RegistryDatabasePath, join(root, `registry-${++databases}.db`)), Effect.timeout("10 seconds")));
};
const firstSnapshot = (session: PiSession) => session.events.pipe(Stream.filter(e => e._tag === "snapshot"), Stream.take(1), Stream.runCollect,
  Effect.map(c => { const e = [...c][0]!; assert.ok(e._tag === "snapshot"); return e.snapshot; }));
/** A client that attaches nothing and records what the registry and Pi held at each publish. */
const recordingClient = (log: string[]) => Effect.gen(function* () {
  const registry = yield* Registry;
  let attached: PiSession | undefined;
  return {
    attach: <E>(open: Effect.Effect<PiSession, E>) => open.pipe(Effect.tap(s => Effect.sync(() => { attached = s; log.push(`attach ${s.spec.sessionId}`); }))),
    published: Effect.gen(function* () {
      const entry = (yield* registry.get).sessions[0];
      const prompted = attached ? (yield* firstSnapshot(attached)).messages.some(m => m.role === "user") : undefined;
      log.push(`published project=${entry?.projectId} touched=${entry?.updatedAt !== entry?.createdAt} prompted=${prompted}`);
    }),
  };
});

test("INV-01/02: creating a session writes the reference and project before the first prompt reaches Pi", async () => {
  await run(Effect.gen(function* () {
    const commands = yield* WorkspaceCommands, registry = yield* Registry, hosts = yield* SessionHosts;
    yield* registry.saveProject({ id: "launch", name: "Launch" });
    const log: string[] = [];
    const session = yield* commands.createSession({ cwd, projectId: "launch", options: {}, text: "  hello  " }, yield* recordingClient(log));
    const id = session.spec.sessionId;
    assert.deepEqual(log, [`attach ${id}`, "published project=launch touched=false prompted=false", "published project=launch touched=true prompted=false"]);
    const entry = (yield* registry.get).sessions.find(s => s.sessionId === id)!;
    assert.equal(entry.cwd, cwd);
    assert.ok((yield* registry.get).folders.includes(cwd), "an unregistered directory becomes a folder");
    assert.ok((yield* firstSnapshot(session)).messages.some(m => m.role === "user" && m.text === "hello"), "the trimmed prompt reached Pi");
    assert.equal((yield* hosts.list).filter(h => h.sessionId === id).length, 1, "one child for the new session");
  }));
});

test("an archived or unknown project is refused before any session or folder is registered", async () => {
  await run(Effect.gen(function* () {
    const commands = yield* WorkspaceCommands, registry = yield* Registry;
    yield* registry.saveProject({ id: "old", name: "Old" });
    yield* registry.archiveProject("old", true);
    const log: string[] = [];
    for (const projectId of ["old", "missing"]) {
      const error = yield* commands.createSession({ cwd, projectId, options: {}, text: "hello" }, yield* recordingClient(log)).pipe(Effect.flip);
      assert.ok(error instanceof RegistryLookupError);
      assert.equal(error.message, "Project is unavailable or archived. Choose a current project before starting.");
    }
    assert.deepEqual(log, []);
    const data = yield* registry.get;
    assert.deepEqual([data.sessions.length, data.folders.length], [0, 0]);
  }));
});

test("worktree commands require a registered folder and record a discovered checkout", async () => {
  const repo = join(root, "repo"), linked = join(root, "linked");
  mkdirSync(repo); git(repo, "init", "--quiet"); git(repo, "commit", "--quiet", "--allow-empty", "-m", "init");
  git(repo, "worktree", "add", "--quiet", "-b", "feature", linked);
  await run(Effect.gen(function* () {
    const commands = yield* WorkspaceCommands, registry = yield* Registry;
    for (const attempt of [commands.addWorktree(repo, linked), commands.createWorktree(repo, "other", {})]) {
      const error = yield* Effect.flip(attempt);
      assert.equal(error._tag, "WorktreeError");
      assert.equal(error.detail, "Select a registered folder first.");
    }
    assert.deepEqual((yield* registry.get).worktrees, []);
    yield* registry.addFolder(repo);
    assert.deepEqual(yield* commands.addWorktree(repo, linked), { status: "ready", folder: repo, path: linked, branch: "feature" });
    assert.deepEqual((yield* registry.get).worktrees, [{ folder: repo, path: linked, branch: "feature" }]);
  }));
});

test("INV-01: renaming goes through Pi, even for a stopped session, and the registry mirrors Pi's name", async () => {
  await run(Effect.gen(function* () {
    const commands = yield* WorkspaceCommands, registry = yield* Registry, hosts = yield* SessionHosts;
    const session = yield* commands.createSession({ cwd, options: {} }, yield* recordingClient([]));
    const id = session.spec.sessionId;
    yield* hosts.release(cwd, id);
    assert.equal(yield* commands.renameSession(cwd, id, "Release notes"), "Release notes");
    const running = (yield* hosts.get(cwd, id))!;
    assert.equal((yield* running.state).sessionName, "Release notes", "Pi recorded the name");
    assert.equal((yield* registry.get).sessions.find(s => s.sessionId === id)?.title, "Release notes");
  }));
});

test("INV-02: archive and delete both stop Pi; archive keeps the reference, delete forgets it", async () => {
  await run(Effect.gen(function* () {
    const commands = yield* WorkspaceCommands, registry = yield* Registry, hosts = yield* SessionHosts;
    const client = yield* recordingClient([]);
    const archived = (yield* commands.createSession({ cwd, options: {} }, client)).spec.sessionId;
    const deleted = (yield* commands.createSession({ cwd, options: {} }, client)).spec.sessionId;
    assert.equal((yield* hosts.list).length, 2);
    yield* commands.retireSession(cwd, archived, "archive");
    yield* commands.retireSession(cwd, deleted, "delete");
    assert.deepEqual(yield* hosts.list, []);
    assert.deepEqual((yield* registry.get).sessions.map(s => [s.sessionId, s.archived]), [[archived, true]]);
    const reopen = yield* Effect.flip(hosts.open({ cwd, sessionId: archived }));
    assert.match(reopen.detail ?? "", /archived/);
  }));
});
