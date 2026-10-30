/** SQLite implementation detail of Registry. Pi history and evidence never enter this store. */
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import type { RegistryData, StoredWebhook } from "./Registry.ts";

const schema = `
  CREATE TABLE registry_meta (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL);
  INSERT INTO registry_meta VALUES (1, 0);
  CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    position INTEGER NOT NULL, instructions TEXT
  ) STRICT;
  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0), path TEXT NOT NULL UNIQUE,
    folder_path TEXT NOT NULL, position INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE folders (
    path TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(path), position INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE worktrees (
    path TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(path), folder_path TEXT NOT NULL,
    branch TEXT NOT NULL, position INTEGER NOT NULL, base_branch TEXT
  ) STRICT;
  CREATE TABLE sessions (
    cwd TEXT NOT NULL REFERENCES workspaces(path), session_id TEXT NOT NULL,
    project_id TEXT REFERENCES projects(id), title TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
    pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    stats TEXT CHECK (stats IS NULL OR json_valid(stats)),
    radius_share TEXT CHECK (radius_share IS NULL OR json_valid(radius_share)),
    pull_request_state TEXT NOT NULL CHECK (pull_request_state IN ('discover', 'removed', 'linked')),
    pull_request_url TEXT, pull_request_source TEXT, pull_request_api_host TEXT CHECK (pull_request_api_host IS NULL OR pull_request_api_host = 'github.int.exe.xyz'), position INTEGER NOT NULL,
    pull_request_head TEXT, pull_request_base TEXT,
    pull_request_head_repo TEXT, pull_request_base_repo TEXT,
    changes_scope TEXT CHECK (changes_scope IS NULL OR changes_scope IN ('branch', 'since-start', 'uncommitted')),
    start_head TEXT,
    PRIMARY KEY (cwd, session_id),
    CHECK ((pull_request_state = 'linked' AND pull_request_url IS NOT NULL AND pull_request_source IS NOT NULL AND pull_request_source IN ('branch', 'manual'))
      OR (pull_request_state != 'linked' AND pull_request_url IS NULL AND pull_request_source IS NULL AND pull_request_api_host IS NULL))
  ) STRICT;
  CREATE INDEX sessions_activity ON sessions(archived, updated_at DESC);
  CREATE INDEX sessions_project ON sessions(project_id, updated_at DESC);
  PRAGMA user_version = 4;
`;

type Row = SQLInputValue[];
type Stored = Record<string, SQLOutputValue>;
type Collection = Exclude<keyof RegistryData, "version">;
type Item<K extends Collection> = RegistryData[K][number];

/**
 * One table's codec: its SQL table is named after the `RegistryData` collection it stores, and
 * `encode` and `decode` are inverses (`position` is the array index, implicit on decode). The first
 * `keys` columns are the primary key. Column names never come from user input.
 */
interface Table<K extends Collection> {
  readonly name: K;
  readonly columns: ReadonlyArray<string>;
  readonly keys: number;
  key(item: Item<K>): ReadonlyArray<string>;
  encode(item: Item<K>, position: number): Row;
  decode(row: Stored): Item<K>;
}

/** A session's pull-request link: absent is discovery, null is removal, otherwise a linked URL. */
const pullRequestState = (link: Item<"sessions">["pullRequest"]) =>
  link === undefined ? "discover" : link === null ? "removed" : "linked";

/** Every collection has a codec, ordered parent-first; deletions run in reverse. */
const codecs: { readonly [K in Collection]: Table<K> } = {
  projects: {
    name: "projects",
    columns: ["id", "name", "instructions", "position"],
    keys: 1,
    key: (p) => [p.id],
    encode: (p, i) => [p.id, p.name, p.instructions ?? null, i],
    decode: (r) => ({
      id: r.id as string,
      name: r.name as string,
      ...(r.instructions === null ? {} : { instructions: r.instructions as string }),
    }),
  },
  workspaces: {
    name: "workspaces",
    columns: ["path", "id", "folder_path", "position"],
    keys: 1,
    key: (w) => [w.path],
    encode: (w, i) => [w.path, w.id, w.folder, i],
    decode: (r) => ({
      id: r.id as string,
      path: r.path as string,
      folder: r.folder_path as string,
    }),
  },
  folders: {
    name: "folders",
    columns: ["path", "position"],
    keys: 1,
    key: (path) => [path],
    encode: (path, i) => [path, i],
    decode: (r) => r.path as string,
  },
  worktrees: {
    name: "worktrees",
    columns: ["path", "folder_path", "branch", "position", "base_branch"],
    keys: 1,
    key: (w) => [w.path],
    encode: (w, i) => [w.path, w.folder, w.branch, i, w.baseBranch ?? null],
    decode: (r) => ({
      path: r.path as string,
      folder: r.folder_path as string,
      branch: r.branch as string,
      ...(r.base_branch === null ? {} : { baseBranch: r.base_branch as string }),
    }),
  },
  sessions: {
    name: "sessions",
    columns: [
      "cwd",
      "session_id",
      "project_id",
      "title",
      "created_at",
      "updated_at",
      "archived",
      "pinned",
      "stats",
      "radius_share",
      "pull_request_state",
      "pull_request_url",
      "pull_request_source",
      "pull_request_api_host",
      "position",
      "pull_request_head",
      "pull_request_base",
      "pull_request_head_repo",
      "pull_request_base_repo",
      "changes_scope",
      "start_head",
    ],
    keys: 2,
    key: (s) => [s.cwd, s.sessionId],
    encode: (s, i) => [
      s.cwd,
      s.sessionId,
      s.projectId ?? null,
      s.title ?? null,
      s.createdAt,
      s.updatedAt,
      Number(s.archived),
      Number(!!s.pinned),
      s.stats === undefined ? null : JSON.stringify(s.stats),
      s.radiusShare === undefined ? null : JSON.stringify(s.radiusShare),
      pullRequestState(s.pullRequest),
      s.pullRequest?.url ?? null,
      s.pullRequest?.source ?? null,
      s.pullRequest?.apiHost ?? null,
      i,
      s.pullRequest?.head ?? null,
      s.pullRequest?.base ?? null,
      s.pullRequest?.headRepo ?? null,
      s.pullRequest?.baseRepo ?? null,
      s.changesScope ?? null,
      s.startHead ?? null,
    ],
    decode: (r) => ({
      cwd: r.cwd as string,
      sessionId: r.session_id as string,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      archived: Boolean(r.archived),
      ...(r.pinned ? { pinned: true } : {}),
      ...(r.changes_scope === null
        ? {}
        : { changesScope: r.changes_scope as "branch" | "since-start" | "uncommitted" }),
      ...(r.start_head === null ? {} : { startHead: r.start_head as string }),
      ...(r.project_id === null ? {} : { projectId: r.project_id as string }),
      ...(r.title === null ? {} : { title: r.title as string }),
      ...(r.stats === null ? {} : { stats: JSON.parse(r.stats as string) }),
      ...(r.radius_share === null ? {} : { radiusShare: JSON.parse(r.radius_share as string) }),
      ...(r.pull_request_state === "discover"
        ? {}
        : {
            pullRequest:
              r.pull_request_state === "removed"
                ? null
                : {
                    url: r.pull_request_url as string,
                    source: r.pull_request_source as "branch" | "manual",
                    ...(r.pull_request_api_host === null
                      ? {}
                      : { apiHost: r.pull_request_api_host as "github.int.exe.xyz" }),
                    ...(r.pull_request_head === null
                      ? {}
                      : { head: r.pull_request_head as string }),
                    ...(r.pull_request_base === null
                      ? {}
                      : { base: r.pull_request_base as string }),
                    ...(r.pull_request_head_repo === null
                      ? {}
                      : { headRepo: r.pull_request_head_repo as string }),
                    ...(r.pull_request_base_repo === null
                      ? {}
                      : { baseRepo: r.pull_request_base_repo as string }),
                  },
          }),
    }),
  },
};
const tables: ReadonlyArray<Table<Collection>> = Object.values(codecs);
/** Unchanged collections and rows are not encoded. Position is persisted data, not just identity. */
function persist(db: DatabaseSync, before: RegistryData, after: RegistryData) {
  const changes = tables
    .filter((table) => before[table.name] !== after[table.name])
    .map((table) => {
      const previous = new Map(
        before[table.name].map((item, position) => {
          const key = table.key(item);
          return [JSON.stringify(key), { item, position, key }] as const;
        }),
      );
      const upserts: Row[] = [];
      after[table.name].forEach((item, position) => {
        const key = JSON.stringify(table.key(item));
        const old = previous.get(key);
        previous.delete(key);
        if (old?.item === item && old.position === position) return;
        const row = table.encode(item, position);
        const prior = old && table.encode(old.item, old.position);
        if (!prior || row.some((value, i) => value !== prior[i])) upserts.push(row);
      });
      return { table, upserts, removals: [...previous.values()].map(({ key }) => key) };
    });
  for (const { table, removals } of [...changes].reverse()) {
    if (!removals.length) continue;
    const remove = db.prepare(
      `DELETE FROM ${table.name} WHERE ${table.columns
        .slice(0, table.keys)
        .map((c) => `${c} = ?`)
        .join(" AND ")}`,
    );
    for (const key of removals) remove.run(...key);
  }
  for (const { table, upserts } of changes) {
    if (!upserts.length) continue;
    const upsert =
      db.prepare(`INSERT INTO ${table.name} (${table.columns.join(",")}) VALUES (${table.columns.map(() => "?").join(",")})
      ON CONFLICT (${table.columns.slice(0, table.keys).join(",")}) DO UPDATE SET ${table.columns
        .slice(table.keys)
        .map((c) => `${c} = excluded.${c}`)
        .join(",")}`);
    for (const row of upserts) upsert.run(...row);
  }
}

function snapshot(db: DatabaseSync): RegistryData {
  const read = (table: Table<Collection>) => [
    table.name,
    db
      .prepare(`SELECT * FROM ${table.name} ORDER BY position`)
      .all()
      .map((r) => table.decode(r)),
  ];
  // `codecs` covers every collection, so the entries form a complete RegistryData.
  return { version: 2, ...Object.fromEntries(tables.map(read)) } as RegistryData;
}

const empty: RegistryData = {
  version: 2,
  folders: [],
  worktrees: [],
  workspaces: [],
  sessions: [],
  projects: [],
};

/** `initial` populates a new database only; test fixtures use it to seed scratch registries. */
export function openRegistryDatabase(path: string, initial: RegistryData = empty) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // Create privately before SQLite can create journal files. Never follow a DB symlink.
  try {
    closeSync(openSync(path, "wx", 0o600));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if (lstatSync(path).isSymbolicLink())
    throw new Error("Registry database symlinks are not supported. Use the actual file path.");
  chmodSync(path, 0o600);
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    // Version 2 retired the project goal. Keep a private copy of a version-1 file before dropping the
    // column: it is the only way back to an older Piano, and the only place old goals survive.
    if (db.prepare("PRAGMA user_version").get()!.user_version === 1) {
      const backup = `${path}.v1-backup`;
      try {
        closeSync(openSync(backup, "wx", 0o600));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      if (lstatSync(backup).isSymbolicLink())
        throw new Error("Registry backup symlinks are not supported.");
      if (lstatSync(backup).size === 0) db.prepare("VACUUM INTO ?").run(backup);
      chmodSync(backup, 0o600);
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const version = db.prepare("PRAGMA user_version").get()!.user_version;
      if (version === 0) {
        if (
          db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all().length
        )
          throw new Error("Unrecognized registry database; refusing to initialize it.");
        db.exec(schema);
        persist(db, empty, initial);
      } else if (version === 1 || version === 2 || version === 3) {
        if (version === 1) db.exec("ALTER TABLE projects DROP COLUMN goal;");
        if (version < 3)
          db.exec(
            "ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1));",
          );
        db.exec(
          "ALTER TABLE sessions ADD COLUMN radius_share TEXT CHECK (radius_share IS NULL OR json_valid(radius_share)); PRAGMA user_version = 4;",
        );
      } else if (
        version !== 4 &&
        version !== 5 &&
        version !== 6 &&
        version !== 7 &&
        version !== 8 &&
        version !== 9 &&
        version !== 10 &&
        version !== 11 &&
        version !== 12 &&
        version !== 13
      )
        throw new Error(
          `Unsupported registry database version ${version}; upgrade Piano rather than resetting the database.`,
        );
      // Version 7 retires both historical notification stores. Older databases can skip
      // preference conversion: no destination is read or used after this migration.
      if (Number(version) < 7)
        db.exec(
          "DROP TABLE IF EXISTS notification_webhooks; DROP TABLE IF EXISTS notification_settings; PRAGMA user_version = 7;",
        );
      if (Number(version) < 8)
        db.exec(`CREATE TABLE IF NOT EXISTS webhooks (
          id TEXT PRIMARY KEY NOT NULL, url TEXT NOT NULL, token TEXT,
          events TEXT NOT NULL CHECK (json_valid(events)),
          active INTEGER NOT NULL CHECK (active IN (0, 1)), created_at TEXT NOT NULL
        ) STRICT; PRAGMA user_version = 8;`);
      // Version 9 retires project archive: an archived project comes back as an ordinary one, its
      // sessions still its members. A database created since never had the column.
      if (Number(version) < 9) {
        const archive = db
          .prepare("SELECT 1 FROM pragma_table_info('projects') WHERE name = 'archived'")
          .get();
        if (archive) db.exec("ALTER TABLE projects DROP COLUMN archived;");
        db.exec("PRAGMA user_version = 9;");
      }
      // Version 10 adds project instructions; a database created since already has the column.
      if (Number(version) < 10) {
        const instructions = db
          .prepare("SELECT 1 FROM pragma_table_info('projects') WHERE name = 'instructions'")
          .get();
        if (!instructions) db.exec("ALTER TABLE projects ADD COLUMN instructions TEXT;");
        db.exec("PRAGMA user_version = 10;");
      }
      // Version 11 adds the Changes comparison: a worktree's base branch at creation, the pull
      // request's branch names, and the session's chosen scope. A database created since already
      // has the columns.
      if (Number(version) < 11) {
        const has = (table: string, column: string) =>
          db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column) !==
          undefined;
        if (!has("worktrees", "base_branch"))
          db.exec("ALTER TABLE worktrees ADD COLUMN base_branch TEXT;");
        if (!has("sessions", "pull_request_head"))
          db.exec("ALTER TABLE sessions ADD COLUMN pull_request_head TEXT;");
        if (!has("sessions", "pull_request_base"))
          db.exec("ALTER TABLE sessions ADD COLUMN pull_request_base TEXT;");
        if (!has("sessions", "changes_scope"))
          db.exec(
            "ALTER TABLE sessions ADD COLUMN changes_scope TEXT CHECK (changes_scope IS NULL OR changes_scope IN ('branch', 'uncommitted'));",
          );
        db.exec("PRAGMA user_version = 11;");
      }
      // Version 12 qualifies PR branches. Legacy links deliberately retain unknown repositories
      // until GitHub refreshes them; a URL alone cannot prove a fork's head repository.
      if (Number(version) < 12) {
        for (const column of ["pull_request_head_repo", "pull_request_base_repo"]) {
          if (!db.prepare("SELECT 1 FROM pragma_table_info('sessions') WHERE name = ?").get(column))
            db.exec(`ALTER TABLE sessions ADD COLUMN ${column} TEXT;`);
        }
        db.exec("PRAGMA user_version = 12;");
      }
      // Version 13 records the commit a session started at, and lets the saved comparison name
      // Since start. A database created since already has both. Widening the scope check means
      // rebuilding the table: SQLite cannot alter a CHECK.
      if (Number(version) < 13) {
        const sql = String(
          db
            .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sessions'")
            .get()?.sql ?? "",
        );
        const hasStart =
          db
            .prepare("SELECT 1 FROM pragma_table_info('sessions') WHERE name = 'start_head'")
            .get() !== undefined;
        if (!sql.includes("'since-start'")) {
          db.exec(`CREATE TABLE sessions_next (
            cwd TEXT NOT NULL REFERENCES workspaces(path), session_id TEXT NOT NULL,
            project_id TEXT REFERENCES projects(id), title TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
            pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
            stats TEXT CHECK (stats IS NULL OR json_valid(stats)),
            radius_share TEXT CHECK (radius_share IS NULL OR json_valid(radius_share)),
            pull_request_state TEXT NOT NULL CHECK (pull_request_state IN ('discover', 'removed', 'linked')),
            pull_request_url TEXT, pull_request_source TEXT, pull_request_api_host TEXT CHECK (pull_request_api_host IS NULL OR pull_request_api_host = 'github.int.exe.xyz'), position INTEGER NOT NULL,
            pull_request_head TEXT, pull_request_base TEXT,
            pull_request_head_repo TEXT, pull_request_base_repo TEXT,
            changes_scope TEXT CHECK (changes_scope IS NULL OR changes_scope IN ('branch', 'since-start', 'uncommitted')),
            start_head TEXT,
            PRIMARY KEY (cwd, session_id),
            CHECK ((pull_request_state = 'linked' AND pull_request_url IS NOT NULL AND pull_request_source IS NOT NULL AND pull_request_source IN ('branch', 'manual'))
              OR (pull_request_state != 'linked' AND pull_request_url IS NULL AND pull_request_source IS NULL AND pull_request_api_host IS NULL))
          ) STRICT;`);
          db.exec(`INSERT INTO sessions_next (
            cwd, session_id, project_id, title, created_at, updated_at, archived, pinned, stats,
            radius_share, pull_request_state, pull_request_url, pull_request_source,
            pull_request_api_host, position, pull_request_head, pull_request_base,
            pull_request_head_repo, pull_request_base_repo, changes_scope
          ) SELECT
            cwd, session_id, project_id, title, created_at, updated_at, archived, pinned, stats,
            radius_share, pull_request_state, pull_request_url, pull_request_source,
            pull_request_api_host, position, pull_request_head, pull_request_base,
            pull_request_head_repo, pull_request_base_repo, changes_scope
          FROM sessions;`);
          db.exec("DROP TABLE sessions;");
          db.exec("ALTER TABLE sessions_next RENAME TO sessions;");
          db.exec(
            "CREATE INDEX sessions_activity ON sessions(archived, updated_at DESC); CREATE INDEX sessions_project ON sessions(project_id, updated_at DESC);",
          );
        } else if (!hasStart) {
          db.exec("ALTER TABLE sessions ADD COLUMN start_head TEXT;");
        }
        db.exec("PRAGMA user_version = 13;");
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("Registry database contains invalid references.");
    // Read the revision and data from the same snapshot. Registry remains a single-backend cache;
    // another writer is detected at commit, never silently overwritten with stale state.
    db.exec("BEGIN");
    let revision: number;
    let data: RegistryData;
    try {
      revision = Number(
        db.prepare("SELECT revision FROM registry_meta WHERE id = 1").get()!.revision,
      );
      data = snapshot(db);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const write = (change: () => void) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        // References are checked at commit: deleting a project unlinks its sessions in the same
        // write, and rows are removed before the rows that pointed at them are updated.
        db.exec("PRAGMA defer_foreign_keys = ON");
        const updated = db
          .prepare("UPDATE registry_meta SET revision = revision + 1 WHERE id = 1 AND revision = ?")
          .run(revision);
        if (updated.changes !== 1)
          throw new Error(
            "Registry changed by another writer. Run only one Piano backend per database and restart this backend before retrying.",
          );
        change();
        db.exec("COMMIT");
        revision++;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    };
    return {
      data,
      webhooks: (): StoredWebhook[] =>
        db
          .prepare("SELECT * FROM webhooks ORDER BY created_at, id")
          .all()
          .map((r) => ({
            id: r.id as string,
            url: r.url as string,
            token: r.token as string | null,
            events: JSON.parse(r.events as string),
            active: Boolean(r.active),
            createdAt: r.created_at as string,
          })),
      saveWebhook: (hook: StoredWebhook) =>
        write(() => {
          db.prepare(`INSERT INTO webhooks (id, url, token, events, active, created_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET url=excluded.url, token=excluded.token, events=excluded.events, active=excluded.active`).run(
            hook.id,
            hook.url,
            hook.token,
            JSON.stringify(hook.events),
            Number(hook.active),
            hook.createdAt,
          );
        }),
      removeWebhook: (id: string) =>
        write(() => {
          db.prepare("DELETE FROM webhooks WHERE id = ?").run(id);
        }),
      close: () => db.close(),
      save: (before: RegistryData, after: RegistryData) => write(() => persist(db, before, after)),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
