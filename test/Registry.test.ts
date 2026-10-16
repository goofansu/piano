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
      { id: "project-1", name: "Launch", archived: false },
      { id: "project-2", name: "Old", archived: true },
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
  // Reshape it as an older Piano left it: version 1, with a project goal. Opening upgrades it in place.
  const legacy = new DatabaseSync(f.dbPath);
  try {
    legacy.exec(
      "DROP TABLE notification_settings; ALTER TABLE sessions DROP COLUMN completed_seq; ALTER TABLE sessions DROP COLUMN seq; ALTER TABLE sessions DROP COLUMN last_status; ALTER TABLE sessions DROP COLUMN last_detail; ALTER TABLE sessions DROP COLUMN radius_share; ALTER TABLE sessions DROP COLUMN pinned; ALTER TABLE projects ADD COLUMN goal TEXT; UPDATE projects SET goal = 'An older goal' WHERE id = 'project-1'; PRAGMA user_version = 1;",
    );
  } finally {
    legacy.close();
  }
  assert.deepEqual(await f.get(), original);
  const upgraded = new DatabaseSync(f.dbPath, { readOnly: true }),
    backup = new DatabaseSync(`${f.dbPath}.v1-backup`, { readOnly: true });
  try {
    assert.equal(upgraded.prepare("PRAGMA user_version").get()!.user_version, 7);
    assert.deepEqual(
      upgraded
        .prepare("SELECT name FROM pragma_table_info('projects')")
        .all()
        .map((c) => c.name),
      ["id", "name", "archived", "position"],
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
  await f.run(Effect.flatMap(Registry, (r) => r.ensureFolder(folder)));
  const id = workspaceId(await f.get());
  assert.ok(id);
  await f.run(
    Effect.gen(function* () {
      const r = yield* Registry;
      yield* r.removeFolder(folder);
      yield* r.ensureFolder(folder);
    }),
  );
  assert.equal(workspaceId(await f.get()), id);
});

test("INV-01: a session with every optional field set, linked without an API host, survives restart", async (t) => {
  const f = fixture(t),
    folder = join(f.root, "folder");
  const original: RegistryData = {
    version: 2,
    folders: [folder],
    worktrees: [],
    workspaces: [{ id: "folder-id", folder, path: folder }],
    projects: [{ id: "project-1", name: "Launch", archived: false }],
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
    legacy.exec(
      "DROP TABLE notification_settings; ALTER TABLE sessions DROP COLUMN completed_seq; ALTER TABLE sessions DROP COLUMN seq; ALTER TABLE sessions DROP COLUMN last_status; ALTER TABLE sessions DROP COLUMN last_detail; ALTER TABLE sessions DROP COLUMN radius_share; PRAGMA user_version = 3;",
    );
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

for (const { label, urls, selected } of [
  { label: "empty", urls: [], selected: null },
  { label: "one URL", urls: ["https://slack-hook.int.exe.xyz/"], selected: "slack-hook" },
  {
    label: "first legacy URL",
    urls: ["HTTPS://Slack-Hook.INT.EXE.XYZ", "https://second-slack.int.exe.xyz/"],
    selected: "slack-hook",
  },
])
  test(`version-5 notification migration stores only the integration name: ${label}`, async (t) => {
    const f = fixture(t);
    await f.run(
      Effect.flatMap(Registry, (r) =>
        r.addSession(join(f.root, "folder"), "one", "Retained session"),
      ),
    );
    const before = await f.get();
    const legacy = new DatabaseSync(f.dbPath);
    try {
      legacy.exec(
        "DROP TABLE notification_settings; ALTER TABLE sessions DROP COLUMN completed_seq; ALTER TABLE sessions DROP COLUMN seq; ALTER TABLE sessions DROP COLUMN last_status; ALTER TABLE sessions DROP COLUMN last_detail; CREATE TABLE notification_webhooks (url TEXT PRIMARY KEY NOT NULL) STRICT; PRAGMA user_version = 5;",
      );
      for (const url of urls)
        legacy.prepare("INSERT INTO notification_webhooks VALUES (?)").run(url);
    } finally {
      legacy.close();
    }
    assert.equal(await f.run(Effect.flatMap(Registry, (r) => r.notificationIntegration)), selected);
    assert.deepEqual(
      await f.get(),
      before,
      "migration and repeated reopen preserve session metadata",
    );
    const stored = new DatabaseSync(f.dbPath, { readOnly: true });
    try {
      assert.equal(stored.prepare("PRAGMA user_version").get()!.user_version, 7);
      assert.equal(
        stored.prepare("SELECT name FROM sqlite_master WHERE name = 'notification_webhooks'").get(),
        undefined,
      );
      assert.deepEqual(
        stored
          .prepare("SELECT * FROM notification_settings")
          .all()
          .map((row) => ({ ...row })),
        selected ? [{ id: 1, integration_name: selected }] : [],
      );
    } finally {
      stored.close();
    }
    await f.run(
      Effect.gen(function* () {
        const registry = yield* Registry;
        yield* registry.setNotificationIntegration("replacement");
        yield* registry
          .setNotificationIntegration("https://invalid.int.exe.xyz/")
          .pipe(Effect.flip);
        assert.equal(
          yield* registry.notificationIntegration,
          "replacement",
          "failed replacement rolls back its deletion",
        );
      }),
    );
    assert.equal(
      await f.run(Effect.flatMap(Registry, (r) => r.notificationIntegration)),
      "replacement",
    );
    await f.run(Effect.flatMap(Registry, (r) => r.setNotificationIntegration(null)));
    assert.equal(await f.run(Effect.flatMap(Registry, (r) => r.notificationIntegration)), null);
  });

for (const url of [
  "https://slack-hook.int.exe.xyz/?token=secret",
  "http://slack-hook.int.exe.xyz/",
  "https://-bad.int.exe.xyz/",
]) {
  test(`invalid legacy notification URL refuses migration without losing preferences: ${url}`, async (t) => {
    const f = fixture(t);
    await f.get();
    const legacy = new DatabaseSync(f.dbPath);
    try {
      legacy.exec(
        "DROP TABLE notification_settings; ALTER TABLE sessions DROP COLUMN completed_seq; ALTER TABLE sessions DROP COLUMN seq; ALTER TABLE sessions DROP COLUMN last_status; ALTER TABLE sessions DROP COLUMN last_detail; CREATE TABLE notification_webhooks (url TEXT PRIMARY KEY NOT NULL) STRICT; PRAGMA user_version = 5;",
      );
      legacy.prepare("INSERT INTO notification_webhooks VALUES (?)").run(url);
      legacy
        .prepare("INSERT INTO notification_webhooks VALUES (?)")
        .run("https://second.int.exe.xyz/");
    } finally {
      legacy.close();
    }
    await assert.rejects(f.get(), (error: Error) => {
      assert.match(error.message, /Cannot migrate the saved Slack integration/);
      assert.equal(
        error.message.includes(url),
        false,
        "the legacy URL is not echoed into diagnostics",
      );
      return true;
    });
    const unchanged = new DatabaseSync(f.dbPath, { readOnly: true });
    try {
      assert.equal(unchanged.prepare("PRAGMA user_version").get()!.user_version, 5);
      assert.deepEqual(
        unchanged
          .prepare("SELECT url FROM notification_webhooks ORDER BY rowid")
          .all()
          .map((row) => row.url),
        [url, "https://second.int.exe.xyz/"],
      );
      assert.equal(
        unchanged
          .prepare("SELECT name FROM sqlite_master WHERE name = 'notification_settings'")
          .get(),
        undefined,
      );
    } finally {
      unchanged.close();
    }
  });
}

test("version-4 migration adds empty notification preferences without changing session metadata", async (t) => {
  const f = fixture(t);
  const before = await f.get();
  const legacy = new DatabaseSync(f.dbPath);
  legacy.exec(
    "DROP TABLE notification_settings; ALTER TABLE sessions DROP COLUMN completed_seq; ALTER TABLE sessions DROP COLUMN seq; ALTER TABLE sessions DROP COLUMN last_status; ALTER TABLE sessions DROP COLUMN last_detail; PRAGMA user_version = 4;",
  );
  legacy.close();
  await f.run(
    Effect.gen(function* () {
      const registry = yield* Registry;
      assert.equal(yield* registry.notificationIntegration, null);
      yield* registry.setNotificationIntegration("slack-hook");
    }),
  );
  assert.deepEqual(await f.get(), before);
  assert.equal(
    await f.run(Effect.flatMap(Registry, (r) => r.notificationIntegration)),
    "slack-hook",
  );
});

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
      "DROP TABLE notification_settings; ALTER TABLE sessions DROP COLUMN completed_seq; ALTER TABLE sessions DROP COLUMN seq; ALTER TABLE sessions DROP COLUMN last_status; ALTER TABLE sessions DROP COLUMN last_detail; ALTER TABLE sessions DROP COLUMN radius_share; ALTER TABLE sessions DROP COLUMN pinned; PRAGMA user_version = 2;",
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
      yield* r.archiveProject("launch", true);
      const before = yield* r.get;
      for (const projectId of ["launch", "missing", undefined])
        yield* r.addSession(cwd, "one", "Replacement", projectId);
      assert.deepEqual(
        yield* r.get,
        before,
        "re-registering is a no-op, even after the initial project is archived",
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
        "existing sessions may still be assigned to an archived project",
      );
      const failure = yield* r
        .addSession(cwd, "missing-project", undefined, "missing")
        .pipe(Effect.flip);
      assert.equal(
        failure.detail,
        "Project is unavailable or archived. Choose a current project before starting.",
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

test("API turn counters and the last-known failure survive database reopen", async (t) => {
  const f = fixture(t);
  const cwd = join(f.root, "turns");
  mkdirSync(cwd);
  await f.run(
    Effect.gen(function* () {
      const registry = yield* Registry;
      yield* registry.ensureFolder(cwd);
      yield* registry.addSession(cwd, "s");
      assert.equal(yield* registry.recordTurn(cwd, "s", "accepted"), 1);
      assert.equal(yield* registry.recordTurn(cwd, "s", "accepted"), 2);
      yield* registry.recordTurn(cwd, "s", {
        status: "error",
        detail: "Pi exited",
        completedSeq: 2,
      });
    }),
  );
  const entry = (await f.get()).sessions[0];
  assert.equal(entry.seq, 2);
  assert.equal(entry.completedSeq, 2);
  assert.equal(entry.lastStatus, "error");
  assert.equal(entry.lastDetail, "Pi exited");
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
    assert.deepEqual((await f.get()).projects, [{ id: "one", name: "First", archived: false }]);
  } finally {
    await first.dispose();
    await second.dispose();
  }
});

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
