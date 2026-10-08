import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type TestContext, test } from "node:test";
import { Effect, Layer, ManagedRuntime } from "effect";
import { Registry, type RegistryData, RegistryDatabasePath, RegistryLive, RegistryPath } from "../server/Registry.ts";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "piano-sqlite-")), config = join(root, "registry.json"), dbPath = `${config}.sqlite`;
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const layer = RegistryLive.pipe(Layer.provide(Layer.succeed(RegistryPath, config)), Layer.provide(Layer.succeed(RegistryDatabasePath, dbPath)));
  const run = <A, E>(effect: Effect.Effect<A, E, Registry>) => Effect.runPromise(effect.pipe(Effect.provide(layer)));
  const get = () => run(Effect.gen(function* () { return yield* (yield* Registry).get; }));
  return { root, config, dbPath, layer, run, get };
}

test("INV-01/07: v2 import preserves all metadata, order, hidden folders and path aliases; SQLite alone owns subsequent writes", async t => {
  const f = fixture(t), folder = join(f.root, "folder"), hidden = join(f.root, "hidden"), alias = `${folder}/../folder`;
  const stats = { context: { tokens: 153139, contextWindow: 272000, percent: 56.301102941176474 }, cost: 7.290477599999999,
    tokens: { input: 1074786, output: 14967, cacheRead: 6729984, cacheWrite: 0, total: 7819737 }, statsUpdatedAt: 1791430502567 };
  const original: RegistryData = { version: 2, projects: [folder], worktrees: [{ project: folder, path: hidden, branch: "feature" }],
    workspaces: [{ id: "hidden-id", project: folder, path: hidden }, { id: "root-id", project: folder, path: folder }, { id: "alias-id", project: alias, path: alias }],
    outcomeProjects: [{ id: "project-1", name: "Launch", goal: "Goal", archived: false }, { id: "project-2", name: "Old", archived: true }],
    sessions: [
      { cwd: hidden, sessionId: "same", title: "Closed folder session", createdAt: "then", updatedAt: "now", archived: false, outcomeProjectId: "project-1", stats,
        pullRequest: { url: "https://github.com/example/repo/pull/1", source: "branch", apiHost: "github.int.exe.xyz" } },
      { cwd: folder, sessionId: "same", createdAt: "then", updatedAt: "now", archived: true, pullRequest: null },
      { cwd: alias, sessionId: "other", createdAt: "then", updatedAt: "now", archived: false },
    ],
  };
  const bytes = `${JSON.stringify(original, null, 2)}\n`;
  writeFileSync(f.config, bytes);
  assert.deepEqual(await f.get(), original);
  assert.equal(readFileSync(f.config, "utf8"), bytes);
  const backups = readdirSync(f.root).filter(p => p.endsWith(".bak"));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(f.root, backups[0]), "utf8"), bytes);
  assert.equal(statSync(join(f.root, backups[0])).mode & 0o777, 0o600);
  assert.equal(statSync(f.dbPath).mode & 0o777, 0o600);
  const db = new DatabaseSync(f.dbPath, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
    assert.ok(tables.includes("folders") && tables.includes("projects"));
    assert.ok(!tables.includes("outcomeProjects"));
    assert.equal(db.prepare("SELECT path FROM folders").get()!.path, folder);
    assert.equal(db.prepare("SELECT name FROM projects WHERE id = 'project-1'").get()!.name, "Launch");
    assert.equal(db.prepare("PRAGMA journal_mode").get()!.journal_mode, "wal");
  } finally { db.close(); }
  await f.run(Effect.gen(function* () {
    const r = yield* Registry;
    yield* r.renameSession(hidden, "same", "Renamed");
    yield* r.assignProject(hidden, "same", "project-2");
    yield* r.removeProject(folder);
  }));
  assert.equal(readFileSync(f.config, "utf8"), bytes, "no dual writes");
  writeFileSync(f.config, "{broken"); // A completed import never reads this file again.
  const reopened = await f.get();
  assert.deepEqual(reopened.projects, []);
  assert.deepEqual(reopened.workspaces, original.workspaces);
  assert.deepEqual(reopened.sessions[0], { ...original.sessions[0], title: "Renamed", outcomeProjectId: "project-2" });
  assert.deepEqual(reopened.sessions.slice(1), original.sessions.slice(1));
  assert.equal(readdirSync(f.root).filter(p => p.endsWith(".bak")).length, 1);
});

test("INV-01: a failed transaction publishes neither partial rows nor in-memory changes; retry succeeds", async t => {
  const f = fixture(t), runtime = ManagedRuntime.make(f.layer);
  try {
    const r = await runtime.runPromise(Registry), before = await runtime.runPromise(r.get);
    // A real SQLite write failure after workspace creation must roll back the whole operation.
    const db = new DatabaseSync(f.dbPath);
    try { db.exec("CREATE TRIGGER reject_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'test write failure'); END;"); }
    finally { db.close(); }
    await assert.rejects(runtime.runPromise(r.addSession(join(f.root, "hidden"), "new")), /test write failure/);
    assert.deepEqual(await runtime.runPromise(r.get), before);
    assert.deepEqual(await f.get(), before);
    const repaired = new DatabaseSync(f.dbPath);
    try { repaired.exec("DROP TRIGGER reject_session"); } finally { repaired.close(); }
    await runtime.runPromise(r.addSession(join(f.root, "hidden"), "new"));
    const saved = await f.get();
    assert.equal(saved.sessions.length, 1); assert.equal(saved.workspaces.length, 1);
    assert.equal(existsSync(f.config), false, "new installs need no JSON file");
  } finally { await runtime.dispose(); }
});

test("INV-01: failed import can retry atomically; newer or damaged databases never fall back to stale JSON", async t => {
  const f = fixture(t);
  writeFileSync(f.config, '{"version":99}');
  await assert.rejects(f.get(), /has not been reset/);
  assert.equal(readFileSync(f.config, "utf8"), '{"version":99}');
  assert.equal(readdirSync(f.root).filter(p => p.endsWith(".bak")).length, 0);
  const legacy = { projects: [], worktrees: [], sessions: [] };
  writeFileSync(f.config, JSON.stringify(legacy));
  assert.deepEqual((await f.get()).projects, []);
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
    await first.runPromise(a.saveOutcomeProject({ id: "one", name: "First" }));
    await assert.rejects(second.runPromise(b.saveOutcomeProject({ id: "two", name: "Second" })), /another writer/);
    assert.deepEqual((await second.runPromise(b.get)).outcomeProjects, []);
    assert.deepEqual((await f.get()).outcomeProjects, [{ id: "one", name: "First", archived: false }]);
  } finally { await first.dispose(); await second.dispose(); }
});

test("database location honors data home and explicit DB override while legacy scratch configs stay isolated", () => {
  const env = { ...process.env };
  delete env.PIANO_CONFIG; delete env.PIANO_DB_PATH;
  const location = (extra: Record<string, string>) => execFileSync(process.execPath, ["--input-type=module", "-e",
    "import { CONFIG_PATH, registryDatabasePath } from './server/Registry.ts'; console.log(registryDatabasePath(CONFIG_PATH, process.env.PIANO_DB_PATH));"],
  { cwd: resolve("."), env: { ...env, ...extra }, encoding: "utf8" }).trim();
  assert.equal(location({ HOME: "/tmp/piano-home", XDG_DATA_HOME: "" }), "/tmp/piano-home/.local/share/piano/piano.db");
  assert.equal(location({ XDG_DATA_HOME: "/tmp/piano-data" }), "/tmp/piano-data/piano/piano.db");
  assert.equal(location({ PIANO_CONFIG: "/tmp/scratch/config.json" }), "/tmp/scratch/config.json.sqlite");
  assert.equal(location({ PIANO_CONFIG: "/tmp/scratch/config.json", PIANO_DB_PATH: "/tmp/explicit/piano.db" }), "/tmp/explicit/piano.db");
});
