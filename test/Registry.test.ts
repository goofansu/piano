import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type TestContext, test } from "node:test";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
  Registry,
  type RegistryData,
  RegistryDatabasePath,
  RegistryLive,
} from "../server/Registry.ts";
import { openRegistryDatabase } from "../server/RegistryDatabase.ts";
import { decodeClientMessage, SESSION_TITLE_MAX } from "../shared/wire.ts";
import { seedRegistry } from "./fixtures/registry.ts";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "piano-sqlite-")),
    dbPath = join(root, "registry.db");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const layer = RegistryLive.pipe(Layer.provide(Layer.succeed(RegistryDatabasePath, dbPath)));
  const run = <A, E>(effect: Effect.Effect<A, E, Registry>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));
  const get = () =>
    run(
      Effect.gen(function* () {
        return yield* (yield* Registry).get;
      }),
    );
  return { root, dbPath, layer, run, get };
}

test("INV-01/07: SQLite preserves all metadata, order, hidden folders and path aliases across writes and restart", async (t) => {
  const f = fixture(t),
    folder = join(f.root, "folder"),
    hidden = join(f.root, "hidden"),
    alias = `${folder}/../folder`;
  const stats = {
    context: { tokens: 153139, contextWindow: 272000, percent: 56.301102941176474 },
    cost: 7.290477599999999,
    tokens: { input: 1074786, output: 14967, cacheRead: 6729984, cacheWrite: 0, total: 7819737 },
    statsUpdatedAt: 1791430502567,
  };
  const original: RegistryData = {
    version: 2,
    folders: [folder],
    worktrees: [{ folder: folder, path: hidden, branch: "feature" }],
    workspaces: [
      { id: "hidden-id", folder: folder, path: hidden },
      { id: "root-id", folder: folder, path: folder },
      { id: "alias-id", folder: alias, path: alias },
    ],
    projects: [
      { id: "project-1", name: "Launch" },
      { id: "project-2", name: "Old" },
    ],
    sessions: [
      {
        cwd: hidden,
        sessionId: "same",
        title: "Closed folder session",
        createdAt: "then",
        updatedAt: "now",
        archived: false,
        projectId: "project-1",
        stats,
        pullRequest: {
          url: "https://github.com/example/repo/pull/1",
          source: "branch",
          apiHost: "github.int.exe.xyz",
        },
      },
      {
        cwd: folder,
        sessionId: "same",
        createdAt: "then",
        updatedAt: "now",
        archived: true,
        pullRequest: null,
      },
      { cwd: alias, sessionId: "other", createdAt: "then", updatedAt: "now", archived: false },
    ],
  };
  seedRegistry(f.dbPath, original);
  // Reshape it as an older Piano left it: version 1, with a project goal and an archived project.
  // Opening upgrades it in place, and the archived project comes back as an ordinary one.
  const legacy = new DatabaseSync(f.dbPath);
  try {
    legacy.exec(
      "ALTER TABLE sessions DROP COLUMN radius_share; ALTER TABLE sessions DROP COLUMN pinned; ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)); UPDATE projects SET archived = 1 WHERE id = 'project-2'; ALTER TABLE projects ADD COLUMN goal TEXT; UPDATE projects SET goal = 'An older goal' WHERE id = 'project-1'; PRAGMA user_version = 1;",
    );
  } finally {
    legacy.close();
  }
  assert.deepEqual(await f.get(), original);
  const upgraded = new DatabaseSync(f.dbPath, { readOnly: true }),
    backup = new DatabaseSync(`${f.dbPath}.v1-backup`, { readOnly: true });
  try {
    assert.equal(upgraded.prepare("PRAGMA user_version").get()!.user_version, 10);
    assert.deepEqual(
      upgraded
        .prepare("SELECT name FROM pragma_table_info('projects')")
        .all()
        .map((c) => c.name),
      ["id", "name", "position", "instructions"],
    );
    assert.equal(backup.prepare("PRAGMA user_version").get()!.user_version, 1);
    assert.equal(
      backup.prepare("SELECT goal FROM projects WHERE id = 'project-1'").get()!.goal,
      "An older goal",
    );
    assert.equal(statSync(`${f.dbPath}.v1-backup`).mode & 0o777, 0o600);
  } finally {
    upgraded.close();
    backup.close();
  }
  assert.deepEqual(await f.get(), original, "a second open leaves the upgraded database alone");
  assert.equal(statSync(f.dbPath).mode & 0o777, 0o600);
  const db = new DatabaseSync(f.dbPath, { readOnly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    assert.ok(tables.includes("folders") && tables.includes("projects"));
    assert.equal(db.prepare("SELECT path FROM folders").get()!.path, folder);
    assert.equal(
      db.prepare("SELECT name FROM projects WHERE id = 'project-1'").get()!.name,
      "Launch",
    );
    assert.equal(db.prepare("PRAGMA journal_mode").get()!.journal_mode, "wal");
  } finally {
    db.close();
  }
  await f.run(
    Effect.gen(function* () {
      const r = yield* Registry;
      yield* r.mirrorSession(hidden, "same", { sessionName: "Renamed" });
      yield* r.assignProject(hidden, "same", "project-2");
      yield* r.removeFolder(folder);
    }),
  );
  const reopened = await f.get();
  assert.deepEqual(reopened.folders, []);
  assert.deepEqual(reopened.workspaces, original.workspaces);
  assert.deepEqual(reopened.sessions[0], {
    ...original.sessions[0],
    title: "Renamed",
    projectId: "project-2",
  });
  assert.deepEqual(reopened.sessions.slice(1), original.sessions.slice(1));
});

test("INV-01/07: a folder keeps its workspace identity when closed and reopened", async (t) => {
  const f = fixture(t),
    folder = join(f.root, "folder");
  mkdirSync(folder);
  const workspaceId = (data: RegistryData) => data.workspaces.find((w) => w.path === folder)?.id;
  await f.run(Effect.flatMap(Registry, (r) => r.addFolder(folder)));
  const id = workspaceId(await f.get());
  assert.ok(id);
  await f.run(
    Effect.gen(function* () {
      const r = yield* Registry;
      yield* r.removeFolder(folder);
      yield* r.addFolder(folder);
    }),
  );
  assert.equal(workspaceId(await f.get()), id);
});

test("INV-01/07: every path a write adds has a workspace when the database reopens", async (t) => {
  const f = fixture(t),
    folder = join(f.root, "folder"),
    worktree = join(f.root, "folder.feature"),
    sessionCwd = join(f.root, "elsewhere");
  mkdirSync(folder);
  const writes: Array<[string, Effect.Effect<unknown, unknown, Registry>]> = [
    [folder, Effect.flatMap(Registry, (r) => r.addFolder(folder))],
    [
      worktree,
      Effect.flatMap(Registry, (r) => r.addWorktree({ folder, path: worktree, branch: "feature" })),
    ],
    [sessionCwd, Effect.flatMap(Registry, (r) => r.addSession(sessionCwd, "s1"))],
  ];
  for (const [path, write] of writes) {
    await f.run(write);
    // Each `run` and `get` opens Piano's database afresh, so `get` succeeding means it decoded.
    const workspace = (await f.get()).workspaces.find((w) => w.path === path);
    assert.ok(workspace?.id, `${path} has a workspace after reopening`);
  }
  assert.equal(
    (await f.get()).workspaces.find((w) => w.path === worktree)?.folder,
    folder,
    "a worktree's workspace names its folder",
  );
});

test("INV-01: a worktree's observed branch replaces its last-known one in one write and survives reopening", async (t) => {
  const f = fixture(t),
    folder = join(f.root, "folder"),
    one = join(f.root, "folder.one"),
    two = join(f.root, "folder.two");
  mkdirSync(folder);
  let announced = 0;
  await f.run(
    Effect.gen(function* () {
      const r = yield* Registry;
      yield* r.addFolder(folder);
      yield* r.addWorktree({ folder, path: one, branch: "feat-a" });
      yield* r.addWorktree({ folder, path: two, branch: "feat-x" });
      yield* r.onChange(() =>
        Effect.sync(() => {
          announced++;
        }),
      );
      yield* r.observeWorktreeBranches([
        { path: one, branch: "feat-b" },
        { path: two, branch: "feat-y" },
        { path: join(f.root, "unregistered"), branch: "other" },
      ]);
      // Nothing new: the same branches again, a blank one, an unregistered path.
      yield* r.observeWorktreeBranches([
        { path: one, branch: "feat-b" },
        { path: two, branch: "" },
        { path: join(f.root, "unregistered"), branch: "other" },
      ]);
    }).pipe(Effect.scoped),
  );
  assert.equal(
    announced,
    1,
    "one announcement for the batch, none for a write that changes nothing",
  );
  assert.deepEqual((await f.get()).worktrees, [
    { folder, path: one, branch: "feat-b" },
    { folder, path: two, branch: "feat-y" },
  ]);
});

test("INV-01: a session with every optional field set, linked without an API host, survives restart", async (t) => {
  const f = fixture(t),
    folder = join(f.root, "folder");
  const original: RegistryData = {
    version: 2,
    folders: [folder],
    worktrees: [],
    workspaces: [{ id: "folder-id", folder, path: folder }],
    projects: [{ id: "project-1", name: "Launch" }],
    sessions: [
      {
        cwd: folder,
        sessionId: "full",
        projectId: "project-1",
        title: "Every field",
        createdAt: "then",
        updatedAt: "now",
        archived: true,
        pinned: true,
        stats: { cost: 1, statsUpdatedAt: 2 },
        radiusShare: { organizationId: "org", artifactId: "art", url: "https://radius.test/a" },
        pullRequest: { url: "https://github.com/example/repo/pull/2", source: "manual" },
      },
    ],
  };
  seedRegistry(f.dbPath, original);
  assert.deepEqual(await f.get(), original);
});

test("version-3 sharing migration preserves sessions; Radius destinations survive restart and reject stale replacements", async (t) => {
  const f = fixture(t),
    cwd = join(f.root, "folder");
  await f.run(
    Effect.gen(function* () {
      const registry = yield* Registry;
      yield* registry.addSession(cwd, "shared", "Original");
      yield* registry.pinSession(cwd, "shared", true);
    }),
  );
  const before = (await f.get()).sessions[0]!;
  const legacy = new DatabaseSync(f.dbPath);
  try {
    legacy.exec("ALTER TABLE sessions DROP COLUMN radius_share; PRAGMA user_version = 3;");
  } finally {
    legacy.close();
  }
  assert.deepEqual((await f.get()).sessions, [before]);
  const link = {
    organizationId: "org-a",
    artifactId: "artifact-a",
    url: "https://radius.earendil.com/a/artifact-a",
  };
  assert.equal(
    await f
      .run(Effect.flatMap(Registry, (r) => r.setSessionLink(before, "radiusShare", link)))
      .then(Boolean),
    true,
  );
  assert.deepEqual((await f.get()).sessions, [{ ...before, radiusShare: link }]);
  assert.equal(
    await f.run(
      Effect.flatMap(Registry, (r) =>
        r.setSessionLink(before, "radiusShare", { ...link, artifactId: "replacement" }),
      ),
    ),
    undefined,
  );
  await f.run(
    Effect.flatMap(Registry, (r) => r.mirrorSession(cwd, "shared", { sessionName: "Renamed" })),
  );
  assert.deepEqual((await f.get()).sessions[0]?.radiusShare, link);
  const replacement = {
    ...link,
    artifactId: "replacement",
    url: "https://radius.earendil.com/a/replacement",
  };
  await f.run(
    Effect.gen(function* () {
      const r = yield* Registry;
      const expected = (yield* r.get).sessions[0]!;
      assert.ok(yield* r.setSessionLink(expected, "radiusShare", replacement));
      assert.equal(
        yield* r.setSessionLink(expected, "radiusShare", link),
        undefined,
        "a stale replacement cannot undo the new link",
      );
    }),
  );
  assert.deepEqual((await f.get()).sessions[0]?.radiusShare, replacement);
  await f.run(Effect.flatMap(Registry, (r) => r.removeSession(cwd, "shared")));
  assert.equal(
    await f
      .run(Effect.flatMap(Registry, (r) => r.setSessionLink(before, "radiusShare", link)))
      .then(Boolean),
    false,
  );
  assert.deepEqual(
    (await f.get()).sessions,
    [],
    "late share results cannot resurrect a deleted session",
  );
});

test("INV-01/07: a session link is set only on the same reference, not archived or recreated since, with that link unchanged", async (t) => {
  const f = fixture(t),
    cwd = join(f.root, "folder");
  const linked = { url: "https://github.com/o/r/pull/1", source: "manual" as const };
  const share = {
    organizationId: "org-a",
    artifactId: "artifact-a",
    url: "https://radius.earendil.com/a/artifact-a",
  };
  await f.run(
    Effect.gen(function* () {
      const r = yield* Registry;
      yield* r.addSession(cwd, "one", "One");
      const expected = (yield* r.get).sessions[0]!;
      const saved = yield* r.setSessionLink(expected, "pullRequest", linked);
      assert.deepEqual(saved, { ...expected, pullRequest: linked });
      assert.deepEqual(yield* r.current(saved!, "pullRequest"), saved);

      assert.equal(
        yield* r.setSessionLink(expected, "pullRequest", null),
        undefined,
        "a link changed since it was read is not overwritten",
      );
      assert.equal(yield* r.current(expected, "pullRequest"), undefined);
      assert.ok(
        yield* r.setSessionLink(expected, "radiusShare", share),
        "another link's change does not block this one",
      );

      const latest = (yield* r.get).sessions[0]!;
      const earlier = { ...latest, createdAt: "2000-01-01T00:00:00.000Z" };
      assert.equal(
        yield* r.setSessionLink(earlier, "pullRequest", null),
        undefined,
        "a recreated reference refuses a result read from its predecessor",
      );
      assert.equal(yield* r.current(earlier), undefined);

      yield* r.archiveSession(cwd, "one");
      assert.equal(yield* r.setSessionLink(latest, "pullRequest", null), undefined);
      assert.equal(yield* r.current(latest), undefined, "archived since it was read");
      const archived = (yield* r.get).sessions[0]!;
      assert.ok(
        yield* r.setSessionLink(archived, "pullRequest", null),
        "a reference read as archived still keeps its links",
      );
    }),
  );
  const persisted = (await f.get()).sessions[0];
  assert.deepEqual(
    persisted && [persisted.archived, persisted.pullRequest, persisted.radiusShare],
    [true, null, share],
    "links persist across restart",
  );
});

for (const version of [4, 5, 6]) {
  test(`INV-01: version-${version} migration retires notification stores and preserves unrelated data`, async (t) => {
    const f = fixture(t);
    await f.run(
      Effect.gen(function* () {
        const registry = yield* Registry;
        yield* registry.addSession(join(f.root, "folder"), "one", "Retained session");
        yield* registry.pinSession(join(f.root, "folder"), "one", true);
      }),
    );
    const before = await f.get();
    const legacy = new DatabaseSync(f.dbPath);
    try {
      if (version === 5) {
        legacy.exec("CREATE TABLE notification_webhooks (url TEXT PRIMARY KEY NOT NULL) STRICT;");
        // Retired preferences must not block an upgrade, even when malformed.
        legacy.prepare("INSERT INTO notification_webhooks VALUES (?)").run("invalid old URL");
      }
      if (version === 6) {
        legacy.exec(
          "CREATE TABLE notification_settings (id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1), integration_name TEXT NOT NULL) STRICT;",
        );
        legacy.prepare("INSERT INTO notification_settings VALUES (1, ?)").run("old-destination");
      }
      legacy.exec(`PRAGMA user_version = ${version}`);
    } finally {
      legacy.close();
    }
    assert.deepEqual(await f.get(), before);
    assert.deepEqual(await f.get(), before, "reopening the upgraded database is idempotent");
    const stored = new DatabaseSync(f.dbPath, { readOnly: true });
    try {
      assert.equal(stored.prepare("PRAGMA user_version").get()!.user_version, 10);
      assert.deepEqual(
        stored
          .prepare(
            "SELECT name FROM sqlite_master WHERE name IN ('notification_webhooks', 'notification_settings')",
          )
          .all(),
        [],
      );
    } finally {
      stored.close();
    }
  });
}

test("INV-01: version-2 sessions start unpinned; pins persist without changing history metadata or activity", async (t) => {
  const f = fixture(t),
    cwd = join(f.root, "folder");
  await f.run(
    Effect.gen(function* () {
      yield* (yield* Registry).addSession(cwd, "one", "Original");
    }),
  );
  const legacy = new DatabaseSync(f.dbPath);
  try {
    legacy.exec(
      "ALTER TABLE sessions DROP COLUMN radius_share; ALTER TABLE sessions DROP COLUMN pinned; PRAGMA user_version = 2;",
    );
  } finally {
    legacy.close();
  }
  const before = (await f.get()).sessions[0]!;
  assert.equal(before.pinned, undefined);
  await f.run(
    Effect.gen(function* () {
      const r = yield* Registry;
      yield* r.pinSession(cwd, "one", true);
      yield* r.pinSession(cwd, "one", true);
    }),
  );
  assert.deepEqual(
    (await f.get()).sessions,
    [{ ...before, pinned: true }],
    "reopening preserves only the new preference",
  );
  await f.run(
    Effect.gen(function* () {
      yield* (yield* Registry).pinSession(cwd, "one", false);
    }),
  );
  assert.deepEqual((await f.get()).sessions, [before], "unpin persists across another restart");
  await assert.rejects(
    f.run(
      Effect.gen(function* () {
        yield* (yield* Registry).pinSession(cwd, "missing", true);
      }),
    ),
    /unavailable/,
  );
  await f.run(
    Effect.gen(function* () {
      yield* (yield* Registry).archiveSession(cwd, "one");
    }),
  );
  await assert.rejects(
    f.run(
      Effect.gen(function* () {
        yield* (yield* Registry).pinSession(cwd, "one", true);
      }),
    ),
    /unavailable/,
  );
});

test("INV-01: the title mirrors Pi's name, else the start name or first prompt; mirroring never moves activity", async (t) => {
  const f = fixture(t),
    cwd = join(f.root, "folder");
  const entry = (id: string) =>
    f.run(
      Effect.gen(function* () {
        return (yield* (yield* Registry).get).sessions.find((s) => s.sessionId === id);
      }),
    );
  await f.run(
    Effect.gen(function* () {
      const r = yield* Registry;
      yield* r.addSession(cwd, "prompted");
      yield* r.touchSession(cwd, "prompted", "  First prompt  ");
      yield* r.touchSession(cwd, "prompted", "Second prompt");
      yield* r.addSession(cwd, "started", "Start name");
      yield* r.touchSession(cwd, "started", "A prompt");
    }),
  );
  assert.equal((await entry("prompted"))?.title, "First prompt");
  assert.equal((await entry("started"))?.title, "Start name");

  const before = await entry("prompted");
  const stats = { cost: 2, statsUpdatedAt: 1 };
  await f.run(
    Effect.gen(function* () {
      yield* (yield* Registry).mirrorSession(cwd, "prompted", { stats });
    }),
  );
  assert.deepEqual(
    await entry("prompted"),
    { ...before, stats },
    "statistics alone keep the title and activity time",
  );

  await f.run(
    Effect.gen(function* () {
      const r = yield* Registry;
      yield* r.mirrorSession(cwd, "prompted", { sessionName: "Named by Pi" });
      yield* r.touchSession(cwd, "prompted", "Later prompt");
      yield* r.mirrorSession(cwd, "unregistered", { sessionName: "Ghost", stats });
    }),
  );
  const named = await entry("prompted");
  assert.equal(named?.title, "Named by Pi", "a later prompt never replaces Pi's name");
  assert.deepEqual(named?.stats, stats, "a name alone keeps the cached statistics");
  assert.equal(await entry("unregistered"), undefined, "mirroring never creates a reference");
});

test("INV-01: initial membership never changes an existing reference or restricts later reassignment", async (t) => {
  const f = fixture(t),
    cwd = join(f.root, "folder");
  await f.run(
    Effect.gen(function* () {
      const r = yield* Registry;
      yield* r.saveProject({ id: "launch", name: "Launch" });
      yield* r.addSession(cwd, "one", "Original", "launch");
      const before = yield* r.get;
      for (const projectId of ["launch", "missing", undefined])
        yield* r.addSession(cwd, "one", "Replacement", projectId);
      assert.deepEqual(
        yield* r.get,
        before,
        "re-registering is a no-op, even naming a missing project",
      );
      yield* r.assignProject(cwd, "one", null);
      yield* r.addSession(cwd, "one", undefined, "launch");
      assert.equal(
        (yield* r.get).sessions[0].projectId,
        undefined,
        "re-registration cannot restore removed membership",
      );
      yield* r.assignProject(cwd, "one", "launch");
      assert.equal(
        (yield* r.get).sessions[0].projectId,
        "launch",
        "a session can join the project again",
      );
      const failure = yield* r
        .addSession(cwd, "missing-project", undefined, "missing")
        .pipe(Effect.flip);
      assert.equal(
        failure.detail,
        "Project is unavailable. Choose a current project before starting.",
      );
      assert.equal((yield* r.get).sessions.length, 1);
    }),
  );
});

test("INV-01: a failed transaction publishes neither partial rows nor in-memory changes; retry succeeds", async (t) => {
  const f = fixture(t),
    runtime = ManagedRuntime.make(f.layer);
  try {
    const r = await runtime.runPromise(Registry);
    await runtime.runPromise(r.saveProject({ id: "launch", name: "Launch" }));
    const before = await runtime.runPromise(r.get);
    // A real SQLite write failure after workspace creation must roll back the whole operation.
    const db = new DatabaseSync(f.dbPath);
    try {
      db.exec(
        "CREATE TRIGGER reject_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'test write failure'); END;",
      );
    } finally {
      db.close();
    }
    await assert.rejects(
      runtime.runPromise(r.addSession(join(f.root, "hidden"), "new", undefined, "launch")),
      /test write failure/,
    );
    assert.deepEqual(await runtime.runPromise(r.get), before);
    assert.deepEqual(await f.get(), before);
    const repaired = new DatabaseSync(f.dbPath);
    try {
      repaired.exec("DROP TRIGGER reject_session");
    } finally {
      repaired.close();
    }
    await runtime.runPromise(r.addSession(join(f.root, "hidden"), "new", undefined, "launch"));
    const saved = await f.get();
    assert.equal(saved.sessions.length, 1);
    assert.equal(saved.workspaces.length, 1);
    assert.equal(saved.sessions[0].projectId, "launch");
  } finally {
    await runtime.dispose();
  }
});

test("INV-01: newer or damaged databases are never reset", async (t) => {
  const f = fixture(t);
  assert.deepEqual((await f.get()).folders, []);
  const db = new DatabaseSync(f.dbPath);
  try {
    db.exec("PRAGMA user_version = 99");
  } finally {
    db.close();
  }
  await assert.rejects(f.get(), /Unsupported registry database version 99/);
  rmSync(f.dbPath);
  writeFileSync(f.dbPath, "not sqlite");
  await assert.rejects(f.get(), /has not been reset/);
  assert.equal(readFileSync(f.dbPath, "utf8"), "not sqlite");
});

test("INV-01: competing backends cannot overwrite each other's committed metadata", async (t) => {
  const f = fixture(t),
    first = ManagedRuntime.make(f.layer),
    second = ManagedRuntime.make(f.layer);
  try {
    const a = await first.runPromise(Registry),
      b = await second.runPromise(Registry);
    await first.runPromise(a.saveProject({ id: "one", name: "First" }));
    await assert.rejects(
      second.runPromise(b.saveProject({ id: "two", name: "Second" })),
      /another writer/,
    );
    assert.deepEqual((await second.runPromise(b.get)).projects, []);
    assert.deepEqual((await f.get()).projects, [{ id: "one", name: "First" }]);
  } finally {
    await first.dispose();
    await second.dispose();
  }
});

test("PIN-50: metadata writes share unchanged collections and rows; value-equal writes do not publish or revise", async (t) => {
  const f = fixture(t),
    cwd = `${f.root}/alias/../folder`;
  seedRegistry(f.dbPath, {
    projects: [{ id: "project", name: "Project" }],
    sessions: ["one", "two"].map((sessionId) => ({
      cwd,
      sessionId,
      createdAt: "then",
      updatedAt: "then",
    })),
  });
  let saved: RegistryData | undefined;
  await f.run(
    Effect.gen(function* () {
      const r = yield* Registry;
      let notifications = 0;
      yield* r.onChange(() =>
        Effect.sync(() => {
          notifications++;
        }),
      );
      const before = yield* r.get;
      yield* r.touchSession(cwd, "one", "First prompt");
      yield* r.mirrorSession(cwd, "one", {
        sessionName: "Pi name",
        stats: { cost: 2, statsUpdatedAt: 3 },
      });
      yield* r.pinSession(cwd, "one", true);
      const entry = (yield* r.get).sessions[0];
      yield* r.setSessionLink(entry, "pullRequest", {
        url: "https://github.com/o/r/pull/1",
        source: "manual",
      });
      saved = yield* r.get;
      for (const name of ["projects", "folders", "worktrees", "workspaces"] as const)
        assert.equal(saved[name], before[name], `${name} keeps its identity`);
      assert.equal(saved.sessions[1], before.sessions[1], "unrelated session keeps its identity");
      assert.equal(saved.sessions[0].cwd, cwd);
      assert.notEqual(saved.sessions[0].updatedAt, "then");
      assert.equal(saved.sessions[0].title, "Pi name");
      assert.deepEqual(saved.workspaces, before.workspaces);
      assert.equal(notifications, 4);
      const db = new DatabaseSync(f.dbPath, { readOnly: true });
      try {
        const revision = () => db.prepare("SELECT revision FROM registry_meta").get()!.revision;
        const priorRevision = revision();
        yield* r.updateProject("project", { name: "Project" });
        yield* r.assignProject(cwd, "one", null);
        yield* r.removeFolder("/missing");
        yield* r.removeSession(cwd, "missing");
        yield* r.touchSession(cwd, "missing");
        yield* r.mirrorSession(cwd, "one", { stats: { cost: 2, statsUpdatedAt: 3 } });
        yield* r.setSessionLink(saved.sessions[0], "pullRequest", {
          url: "https://github.com/o/r/pull/1",
          source: "manual",
        });
        assert.equal(yield* r.get, saved, "a true no-op retains the published state");
        assert.equal(notifications, 4);
        assert.equal(revision(), priorRevision);
      } finally {
        db.close();
      }
    }).pipe(Effect.scoped),
  );
  assert.deepEqual(await f.get(), saved, "all changed metadata survives reopening");
});

test("PIN-50: new cwd creates one workspace, keeping aliases and worktree parents", async (t) => {
  const f = fixture(t),
    folder = join(f.root, "folder"),
    cwd = `${folder}/../worktree`;
  await f.run(
    Effect.gen(function* () {
      const r = yield* Registry;
      yield* r.addWorktree({ path: cwd, folder, branch: "feature" });
      const before = yield* r.get;
      yield* r.addSession(cwd, "one");
      yield* r.addSession(cwd, "two");
      assert.equal((yield* r.get).workspaces, before.workspaces);
      yield* r.addSession(`${cwd}/alias`, "new");
      yield* r.addSession(`${cwd}/alias`, "another");
    }),
  );
  const data = await f.get();
  assert.deepEqual(
    data.workspaces.map(({ path, folder }) => ({ path, folder })),
    [
      { path: cwd, folder },
      { path: `${cwd}/alias`, folder: `${cwd}/alias` },
    ],
  );
});

// Registry does not expose removal for every collection. Exercise the existing database save
// boundary too, so position handling is protected for every ordered table, including parents.
for (const name of ["projects", "workspaces", "folders", "worktrees", "sessions"] as const) {
  test(`PIN-50: deleting the first ${name} row persists shifted positions and restart order`, async (t) => {
    const f = fixture(t);
    const paths = ["a", "b", "c"].map((p) => join(f.root, p));
    const workspaces = paths.map((path, i) => ({ id: `w${i}`, path, folder: path }));
    seedRegistry(f.dbPath, {
      workspaces,
      projects: name === "projects" ? paths.map((id) => ({ id, name: id })) : [],
      folders: name === "folders" ? paths : [],
      worktrees:
        name === "worktrees"
          ? paths.map((path) => ({ path, folder: path, branch: "feature" }))
          : [],
      sessions:
        name === "sessions"
          ? paths.map((cwd) => ({ cwd, sessionId: "same", createdAt: "then", updatedAt: "then" }))
          : [],
    });
    const db = openRegistryDatabase(f.dbPath);
    const before = db.data;
    const after = { ...before, [name]: before[name].slice(1) };
    try {
      db.save(before, after);
    } finally {
      db.close();
    }
    const stored = new DatabaseSync(f.dbPath, { readOnly: true });
    try {
      assert.deepEqual(
        stored
          .prepare(`SELECT position FROM ${name} ORDER BY position`)
          .all()
          .map((r) => r.position),
        [0, 1],
      );
    } finally {
      stored.close();
    }
    assert.deepEqual(await f.get(), after);
    // Reinsert at the end: stale positions must not tie with the appended item.
    const reopened = openRegistryDatabase(f.dbPath);
    const appended = { ...reopened.data, [name]: [...reopened.data[name], before[name][0]] };
    try {
      reopened.save(reopened.data, appended);
    } finally {
      reopened.close();
    }
    assert.deepEqual(await f.get(), appended);
  });
}

test("database location honors data home and DB override", () => {
  const env = { ...process.env };
  delete env.PIANO_DB_PATH;
  const location = (extra: Record<string, string>) =>
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import { RegistryDatabasePath } from './server/Registry.ts'; console.log(RegistryDatabasePath.defaultValue());",
      ],
      { cwd: resolve("."), env: { ...env, ...extra }, encoding: "utf8" },
    ).trim();
  assert.equal(
    location({ HOME: "/tmp/piano-home", XDG_DATA_HOME: "" }),
    "/tmp/piano-home/.local/share/piano/piano.db",
  );
  assert.equal(location({ XDG_DATA_HOME: "/tmp/piano-data" }), "/tmp/piano-data/piano/piano.db");
  assert.equal(
    location({ XDG_DATA_HOME: "/tmp/piano-data", PIANO_DB_PATH: "/tmp/explicit/piano.db" }),
    "/tmp/explicit/piano.db",
  );
});

test("a new session's title is limited where it is stored, from a start name or a first prompt", async (t) => {
  const f = fixture(t),
    cwd = join(f.root, "folder");
  await f.run(
    Effect.gen(function* () {
      const r = yield* Registry;
      yield* r.addSession(cwd, "named", ` ${"n".repeat(SESSION_TITLE_MAX + 50)} `);
      yield* r.addSession(cwd, "prompted");
      yield* r.touchSession(cwd, "prompted", ` ${"p".repeat(SESSION_TITLE_MAX + 50)}`);
    }),
  );
  const titles = Object.fromEntries((await f.get()).sessions.map((s) => [s.sessionId, s.title]));
  assert.equal(titles.named, "n".repeat(SESSION_TITLE_MAX));
  assert.equal(titles.prompted, "p".repeat(SESSION_TITLE_MAX));
});

test("a start name over the title limit is refused like a rename", () => {
  const act = (name: string) =>
    JSON.stringify({
      _tag: "act",
      selectionId: "s",
      action: { _tag: "abort" },
      start: { name },
    });
  assert.doesNotThrow(() => decodeClientMessage(act("t".repeat(SESSION_TITLE_MAX))));
  assert.throws(() => decodeClientMessage(act("t".repeat(10_000))));
});
