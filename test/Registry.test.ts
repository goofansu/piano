import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type TestContext, test } from "node:test";
import { Effect, Layer, ManagedRuntime } from "effect";
import { Registry, type RegistryData, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { seedRegistry } from "./fixtures/registry.ts";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "piano-sqlite-")), dbPath = join(root, "registry.db");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const layer = RegistryLive.pipe(Layer.provide(Layer.succeed(RegistryDatabasePath, dbPath)));
  const run = <A, E>(effect: Effect.Effect<A, E, Registry>) => Effect.runPromise(effect.pipe(Effect.provide(layer)));
  const get = () => run(Effect.gen(function* () { return yield* (yield* Registry).get; }));
  return { root, dbPath, layer, run, get };
}

test("INV-01/07: SQLite preserves all metadata, order, hidden folders and path aliases across writes and restart", async t => {
  const f = fixture(t), folder = join(f.root, "folder"), hidden = join(f.root, "hidden"), alias = `${folder}/../folder`;
  const stats = { context: { tokens: 153139, contextWindow: 272000, percent: 56.301102941176474 }, cost: 7.290477599999999,
    tokens: { input: 1074786, output: 14967, cacheRead: 6729984, cacheWrite: 0, total: 7819737 }, statsUpdatedAt: 1791430502567 };
  const original: RegistryData = { version: 2, folders: [folder], worktrees: [{ folder: folder, path: hidden, branch: "feature" }],
    workspaces: [{ id: "hidden-id", folder: folder, path: hidden }, { id: "root-id", folder: folder, path: folder }, { id: "alias-id", folder: alias, path: alias }],
    projects: [{ id: "project-1", name: "Launch", archived: false }, { id: "project-2", name: "Old", archived: true }],
    sessions: [
      { cwd: hidden, sessionId: "same", title: "Closed folder session", createdAt: "then", updatedAt: "now", archived: false, projectId: "project-1", stats,
        pullRequest: { url: "https://github.com/example/repo/pull/1", source: "branch", apiHost: "github.int.exe.xyz" } },
      { cwd: folder, sessionId: "same", createdAt: "then", updatedAt: "now", archived: true, pullRequest: null },
      { cwd: alias, sessionId: "other", createdAt: "then", updatedAt: "now", archived: false },
    ],
  };
  seedRegistry(f.dbPath, original);
  // Reshape it as an older Piano left it: version 1, with a project goal. Opening upgrades it in place.
  const legacy = new DatabaseSync(f.dbPath);
  try { legacy.exec("ALTER TABLE projects ADD COLUMN goal TEXT; UPDATE projects SET goal = 'An older goal' WHERE id = 'project-1'; PRAGMA user_version = 1;"); }
  finally { legacy.close(); }
  assert.deepEqual(await f.get(), original);
  const upgraded = new DatabaseSync(f.dbPath, { readOnly: true }), backup = new DatabaseSync(`${f.dbPath}.v1-backup`, { readOnly: true });
  try {
    assert.equal(upgraded.prepare("PRAGMA user_version").get()!.user_version, 2);
    assert.deepEqual(upgraded.prepare("SELECT name FROM pragma_table_info('projects')").all().map(c => c.name), ["id", "name", "archived", "position"]);
    assert.equal(backup.prepare("PRAGMA user_version").get()!.user_version, 1);
    assert.equal(backup.prepare("SELECT goal FROM projects WHERE id = 'project-1'").get()!.goal, "An older goal");
    assert.equal(statSync(`${f.dbPath}.v1-backup`).mode & 0o777, 0o600);
  } finally { upgraded.close(); backup.close(); }
  assert.deepEqual(await f.get(), original, "a second open leaves version 2 alone");
  assert.equal(statSync(f.dbPath).mode & 0o777, 0o600);
  const db = new DatabaseSync(f.dbPath, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
    assert.ok(tables.includes("folders") && tables.includes("projects"));
    assert.equal(db.prepare("SELECT path FROM folders").get()!.path, folder);
    assert.equal(db.prepare("SELECT name FROM projects WHERE id = 'project-1'").get()!.name, "Launch");
    assert.equal(db.prepare("PRAGMA journal_mode").get()!.journal_mode, "wal");
  } finally { db.close(); }
  await f.run(Effect.gen(function* () {
    const r = yield* Registry;
    yield* r.mirrorSession(hidden, "same", { sessionName: "Renamed" });
    yield* r.assignProject(hidden, "same", "project-2");
    yield* r.removeFolder(folder);
  }));
  const reopened = await f.get();
  assert.deepEqual(reopened.folders, []);
  assert.deepEqual(reopened.workspaces, original.workspaces);
  assert.deepEqual(reopened.sessions[0], { ...original.sessions[0], title: "Renamed", projectId: "project-2" });
  assert.deepEqual(reopened.sessions.slice(1), original.sessions.slice(1));
});

test("INV-01: the title mirrors Pi's name, else the start name or first prompt; mirroring never moves activity", async t => {
  const f = fixture(t), cwd = join(f.root, "folder");
  const entry = (id: string) => f.run(Effect.gen(function* () { return (yield* (yield* Registry).get).sessions.find(s => s.sessionId === id); }));
  await f.run(Effect.gen(function* () {
    const r = yield* Registry;
    yield* r.addSession(cwd, "prompted");
    yield* r.touchSession(cwd, "prompted", "  First prompt  ");
    yield* r.touchSession(cwd, "prompted", "Second prompt");
    yield* r.addSession(cwd, "started", "Start name");
    yield* r.touchSession(cwd, "started", "A prompt");
  }));
  assert.equal((await entry("prompted"))?.title, "First prompt");
  assert.equal((await entry("started"))?.title, "Start name");

  const before = await entry("prompted");
  const stats = { cost: 2, statsUpdatedAt: 1 };
  await f.run(Effect.gen(function* () { yield* (yield* Registry).mirrorSession(cwd, "prompted", { stats }); }));
  assert.deepEqual(await entry("prompted"), { ...before, stats }, "statistics alone keep the title and activity time");

  await f.run(Effect.gen(function* () {
    const r = yield* Registry;
    yield* r.mirrorSession(cwd, "prompted", { sessionName: "Named by Pi" });
    yield* r.touchSession(cwd, "prompted", "Later prompt");
    yield* r.mirrorSession(cwd, "unregistered", { sessionName: "Ghost", stats });
  }));
  const named = await entry("prompted");
  assert.equal(named?.title, "Named by Pi", "a later prompt never replaces Pi's name");
  assert.deepEqual(named?.stats, stats, "a name alone keeps the cached statistics");
  assert.equal(await entry("unregistered"), undefined, "mirroring never creates a reference");
});

test("INV-01: initial membership never changes an existing reference or restricts later reassignment", async t => {
  const f = fixture(t), cwd = join(f.root, "folder");
  await f.run(Effect.gen(function* () {
    const r = yield* Registry;
    yield* r.saveProject({ id: "launch", name: "Launch" });
    yield* r.addSession(cwd, "one", "Original", "launch");
    yield* r.archiveProject("launch", true);
    const before = yield* r.get;
    for (const projectId of ["launch", "missing", undefined]) yield* r.addSession(cwd, "one", "Replacement", projectId);
    assert.deepEqual(yield* r.get, before, "re-registering is a no-op, even after the initial project is archived");
    yield* r.assignProject(cwd, "one", null);
    yield* r.addSession(cwd, "one", undefined, "launch");
    assert.equal((yield* r.get).sessions[0].projectId, undefined, "re-registration cannot restore removed membership");
    yield* r.assignProject(cwd, "one", "launch");
    assert.equal((yield* r.get).sessions[0].projectId, "launch", "existing sessions may still be assigned to an archived project");
    const failure = yield* r.addSession(cwd, "missing-project", undefined, "missing").pipe(Effect.flip);
    assert.equal(failure.detail, "Project is unavailable or archived. Choose a current project before starting.");
    assert.equal((yield* r.get).sessions.length, 1);
  }));
});

test("INV-01: a failed transaction publishes neither partial rows nor in-memory changes; retry succeeds", async t => {
  const f = fixture(t), runtime = ManagedRuntime.make(f.layer);
  try {
    const r = await runtime.runPromise(Registry);
    await runtime.runPromise(r.saveProject({ id: "launch", name: "Launch" }));
    const before = await runtime.runPromise(r.get);
    // A real SQLite write failure after workspace creation must roll back the whole operation.
    const db = new DatabaseSync(f.dbPath);
    try { db.exec("CREATE TRIGGER reject_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'test write failure'); END;"); }
    finally { db.close(); }
    await assert.rejects(runtime.runPromise(r.addSession(join(f.root, "hidden"), "new", undefined, "launch")), /test write failure/);
    assert.deepEqual(await runtime.runPromise(r.get), before);
    assert.deepEqual(await f.get(), before);
    const repaired = new DatabaseSync(f.dbPath);
    try { repaired.exec("DROP TRIGGER reject_session"); } finally { repaired.close(); }
    await runtime.runPromise(r.addSession(join(f.root, "hidden"), "new", undefined, "launch"));
    const saved = await f.get();
    assert.equal(saved.sessions.length, 1); assert.equal(saved.workspaces.length, 1);
    assert.equal(saved.sessions[0].projectId, "launch");
  } finally { await runtime.dispose(); }
});

test("INV-01: newer or damaged databases are never reset", async t => {
  const f = fixture(t);
  assert.deepEqual((await f.get()).folders, []);
  const db = new DatabaseSync(f.dbPath);
  try { db.exec("PRAGMA user_version = 99"); } finally { db.close(); }
  await assert.rejects(f.get(), /Unsupported registry database version 99/);
  rmSync(f.dbPath);
  writeFileSync(f.dbPath, "not sqlite");
  await assert.rejects(f.get(), /has not been reset/);
  assert.equal(readFileSync(f.dbPath, "utf8"), "not sqlite");
});

test("INV-01: competing backends cannot overwrite each other's committed metadata", async t => {
  const f = fixture(t), first = ManagedRuntime.make(f.layer), second = ManagedRuntime.make(f.layer);
  try {
    const a = await first.runPromise(Registry), b = await second.runPromise(Registry);
    await first.runPromise(a.saveProject({ id: "one", name: "First" }));
    await assert.rejects(second.runPromise(b.saveProject({ id: "two", name: "Second" })), /another writer/);
    assert.deepEqual((await second.runPromise(b.get)).projects, []);
    assert.deepEqual((await f.get()).projects, [{ id: "one", name: "First", archived: false }]);
  } finally { await first.dispose(); await second.dispose(); }
});

test("database location honors data home and DB override", () => {
  const env = { ...process.env };
  delete env.PIANO_DB_PATH;
  const location = (extra: Record<string, string>) => execFileSync(process.execPath, ["--input-type=module", "-e",
    "import { RegistryDatabasePath } from './server/Registry.ts'; console.log(RegistryDatabasePath.defaultValue());"],
  { cwd: resolve("."), env: { ...env, ...extra }, encoding: "utf8" }).trim();
  assert.equal(location({ HOME: "/tmp/piano-home", XDG_DATA_HOME: "" }), "/tmp/piano-home/.local/share/piano/piano.db");
  assert.equal(location({ XDG_DATA_HOME: "/tmp/piano-data" }), "/tmp/piano-data/piano/piano.db");
  assert.equal(location({ XDG_DATA_HOME: "/tmp/piano-data", PIANO_DB_PATH: "/tmp/explicit/piano.db" }), "/tmp/explicit/piano.db");
});
