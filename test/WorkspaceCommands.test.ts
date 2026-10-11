import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Fiber, Layer, type Scope, Stream } from "effect";
import { Catalog, CatalogLive } from "../server/Catalog.ts";
import { PiCli } from "../server/PiCli.ts";
import { type PiSession, PiSessionsLive } from "../server/PiSessions.ts";
import { Registry, type RegistryData, RegistryDatabasePath, RegistryLive, RegistryLookupError } from "../server/Registry.ts";
import { SessionHosts, SessionHostsLive } from "../server/SessionHosts.ts";
import { SidebarViewLive } from "../server/SidebarView.ts";
import { WorkspaceCommands, WorkspaceCommandsLive } from "../server/WorkspaceCommands.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-commands-")));
const cwd = join(root, "checkout");
mkdirSync(cwd); mkdirSync(join(root, "sessions"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
after(() => rmSync(root, { recursive: true, force: true }));

const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { stdio: "pipe" });
let databases = 0;
const run = <A, E>(effect: Effect.Effect<A, E, WorkspaceCommands | SessionHosts | Registry | Catalog | Scope.Scope>) => {
  const layer = WorkspaceCommandsLive.pipe(
    Layer.provide(SidebarViewLive()),
    Layer.provideMerge(SessionHostsLive({ idleMs: 0 })), Layer.provideMerge(CatalogLive),
    Layer.provide(PiSessionsLive), Layer.provideMerge(RegistryLive), Layer.provide(NodeServices.layer));
  return Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(layer),
    Effect.provideService(PiCli, { node: process.execPath, cli: new URL("./fake-pi.mjs", import.meta.url).pathname, extraArgs: [] }),
    Effect.provideService(RegistryDatabasePath, join(root, `registry-${++databases}.db`)), Effect.timeout("10 seconds")));
};
const firstSnapshot = (session: PiSession) => session.events.pipe(Stream.filter(e => e._tag === "snapshot"), Stream.take(1), Stream.runCollect,
  Effect.map(c => { const e = [...c][0]!; assert.ok(e._tag === "snapshot"); return e.snapshot; }));
/** Waits until Pi has recorded `text` as a user message, whether before or after attaching. */
const userMessage = (session: PiSession, text: string) => session.events.pipe(
  Stream.filter(e => e._tag === "snapshot" ? e.snapshot.messages.some(m => m.role === "user" && m.text === text) : e._tag === "message_end" && e.message.role === "user" && e.message.text === text),
  Stream.take(1), Stream.runDrain);
/**
 * A client that records what it attached, and what the registry and Pi held each time a registry
 * write was announced; the sidebar view publishes from that same announcement.
 */
const recordingClient = (log: string[]) => Effect.gen(function* () {
  const registry = yield* Registry;
  let attached: PiSession | undefined;
  const facts = (d: RegistryData) => JSON.stringify(d.sessions.map(s => [s.projectId, s.updatedAt]));
  yield* registry.onChange((before, after) => Effect.gen(function* () {
    // The folder and the reference itself are written while opening; cached Pi statistics may follow the prompt.
    if (!attached || facts(before) === facts(after)) return;
    const entry = after.sessions[0];
    const prompted = (yield* firstSnapshot(attached)).messages.some(m => m.role === "user");
    log.push(`published project=${entry?.projectId} touched=${entry?.updatedAt !== entry?.createdAt} prompted=${prompted}`);
  }).pipe(Effect.orDie));
  return {
    attach: <E>(open: Effect.Effect<PiSession, E>) => open.pipe(Effect.tap(s => Effect.sync(() => { attached = s; log.push(`attach ${s.spec.sessionId}`); }))),
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
    yield* userMessage(session, "hello"); // the trimmed prompt reached Pi
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

/** Counts activity bumps: only a recorded prompt or steer moves a reference's `updatedAt`. */
const activity = Effect.gen(function* () {
  const registry = yield* Registry;
  const bumps: string[] = [];
  yield* registry.onChange((before, after) => Effect.sync(() => {
    for (const s of after.sessions) {
      if (before.sessions.find(b => b.sessionId === s.sessionId && b.updatedAt !== s.updatedAt)) bumps.push(s.sessionId);
    }
  }));
  return bumps;
});

test("INV-01: a prompt or steer records activity, whether it starts a session or follows; other input does not", async () => {
  await run(Effect.gen(function* () {
    const commands = yield* WorkspaceCommands;
    const bumps = yield* activity;
    // Activity times have millisecond resolution; keep each step on its own tick so every bump is a change.
    const tick = Effect.sleep("2 millis");
    const session = yield* commands.createSession({ cwd, options: {}, text: "First prompt" }, yield* recordingClient([]));
    const id = session.spec.sessionId;
    assert.deepEqual(bumps, [id], "creating with a first prompt records activity");
    yield* tick;
    yield* commands.act(session, { _tag: "prompt", text: "Second prompt" });
    yield* tick;
    yield* commands.act(session, { _tag: "steer", text: "Steer" });
    assert.deepEqual(bumps, [id, id, id], "each later prompt and steer records activity");
    yield* tick;
    yield* commands.act(session, { _tag: "set_thinking_level", level: "low" });
    assert.deepEqual(bumps, [id, id, id], "other input is not activity");
  }));
});

test("INV-01: a trust decision is saved in Pi's store and every client's model catalog is invalidated", async () => {
  // A project skill makes the directory's trust matter to Pi.
  mkdirSync(join(cwd, ".agents/skills/hello"), { recursive: true });
  writeFileSync(join(cwd, ".agents/skills/hello/SKILL.md"), "---\nname: hello\ndescription: say hello\n---\nSay hello.\n");
  try {
    await run(Effect.gen(function* () {
      const commands = yield* WorkspaceCommands, catalog = yield* Catalog;
      // Each socket forwards this stream as `catalogs_invalidated`.
      const invalidated = yield* catalog.changes.pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true }));
      assert.deepEqual(yield* commands.setTrust(cwd, true), { cwd, trust: { required: true, trusted: true } });
      assert.deepEqual(yield* commands.setTrust(cwd, false), { cwd, trust: { required: true, trusted: false } });
      assert.equal([...(yield* Fiber.join(invalidated))].length, 2, "one invalidation per decision");
    }));
  } finally {
    rmSync(join(cwd, ".agents"), { recursive: true, force: true });
  }
});
