/** SQLite implementation detail of Registry. Pi history and evidence never enter this store. */
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { RegistryData } from "./Registry.ts";

const schema = `
  CREATE TABLE registry_meta (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL);
  INSERT INTO registry_meta VALUES (1, 0);
  CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    archived INTEGER NOT NULL CHECK (archived IN (0, 1)), position INTEGER NOT NULL
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
    branch TEXT NOT NULL, position INTEGER NOT NULL
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
    PRIMARY KEY (cwd, session_id),
    CHECK ((pull_request_state = 'linked' AND pull_request_url IS NOT NULL AND pull_request_source IS NOT NULL AND pull_request_source IN ('branch', 'manual'))
      OR (pull_request_state != 'linked' AND pull_request_url IS NULL AND pull_request_source IS NULL AND pull_request_api_host IS NULL))
  ) STRICT;
  CREATE INDEX sessions_activity ON sessions(archived, updated_at DESC);
  CREATE INDEX sessions_project ON sessions(project_id, updated_at DESC);
  PRAGMA user_version = 4;
`;

type Row = SQLInputValue[];
/** Ordered parent-first; deletions run in reverse. Column names never come from user input. */
const tables = [
  {
    name: "projects",
    columns: ["id", "name", "archived", "position"],
    keys: 1,
    rows: (d: RegistryData): Row[] =>
      d.projects.map((p, i) => [p.id, p.name, Number(p.archived), i]),
  },
  {
    name: "workspaces",
    columns: ["path", "id", "folder_path", "position"],
    keys: 1,
    rows: (d: RegistryData): Row[] => d.workspaces.map((w, i) => [w.path, w.id, w.folder, i]),
  },
  {
    name: "folders",
    columns: ["path", "position"],
    keys: 1,
    rows: (d: RegistryData): Row[] => d.folders.map((path, i) => [path, i]),
  },
  {
    name: "worktrees",
    columns: ["path", "folder_path", "branch", "position"],
    keys: 1,
    rows: (d: RegistryData): Row[] => d.worktrees.map((w, i) => [w.path, w.folder, w.branch, i]),
  },
  {
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
    ],
    keys: 2,
    rows: (d: RegistryData): Row[] =>
      d.sessions.map((s, i) => [
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
        s.pullRequest === undefined ? "discover" : s.pullRequest === null ? "removed" : "linked",
        s.pullRequest?.url ?? null,
        s.pullRequest?.source ?? null,
        s.pullRequest?.apiHost ?? null,
        i,
      ]),
  },
];

/** No full-table rewrite: only changed/new rows and removed keys are written. */
function persist(db: DatabaseSync, before: RegistryData, after: RegistryData) {
  const changes = tables.map((table) => {
    const key = (r: Row) => JSON.stringify(r.slice(0, table.keys));
    return {
      ...table,
      key,
      previous: new Map(table.rows(before).map((r) => [key(r), r])),
      next: new Map(table.rows(after).map((r) => [key(r), r])),
    };
  });
  for (const table of [...changes].reverse()) {
    const remove = db.prepare(
      `DELETE FROM ${table.name} WHERE ${table.columns
        .slice(0, table.keys)
        .map((c) => `${c} = ?`)
        .join(" AND ")}`,
    );
    for (const [key, row] of table.previous)
      if (!table.next.has(key)) remove.run(...row.slice(0, table.keys));
  }
  for (const table of changes) {
    const upsert =
      db.prepare(`INSERT INTO ${table.name} (${table.columns.join(",")}) VALUES (${table.columns.map(() => "?").join(",")})
      ON CONFLICT (${table.columns.slice(0, table.keys).join(",")}) DO UPDATE SET ${table.columns
        .slice(table.keys)
        .map((c) => `${c} = excluded.${c}`)
        .join(",")}`);
    for (const [key, row] of table.next)
      if (JSON.stringify(row) !== JSON.stringify(table.previous.get(key))) upsert.run(...row);
  }
}

function snapshot(db: DatabaseSync): RegistryData {
  const rows = (table: string) =>
    db.prepare(`SELECT * FROM ${table} ORDER BY position`).all() as Record<
      string,
      string | number | null
    >[];
  return {
    version: 2,
    folders: rows("folders").map((r) => r.path as string),
    projects: rows("projects").map((r) => ({
      id: r.id as string,
      name: r.name as string,
      archived: Boolean(r.archived),
    })),
    workspaces: rows("workspaces").map((r) => ({
      id: r.id as string,
      path: r.path as string,
      folder: r.folder_path as string,
    })),
    worktrees: rows("worktrees").map((r) => ({
      path: r.path as string,
      folder: r.folder_path as string,
      branch: r.branch as string,
    })),
    sessions: rows("sessions").map((r) => ({
      cwd: r.cwd as string,
      sessionId: r.session_id as string,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      archived: Boolean(r.archived),
      ...(r.pinned ? { pinned: true } : {}),
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
                  },
          }),
    })),
  };
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
      } else if (version !== 4)
        throw new Error(
          `Unsupported registry database version ${version}; upgrade Piano rather than resetting the database.`,
        );
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
    return {
      data,
      close: () => db.close(),
      save: (before: RegistryData, after: RegistryData) => {
        db.exec("BEGIN IMMEDIATE");
        try {
          const updated = db
            .prepare(
              "UPDATE registry_meta SET revision = revision + 1 WHERE id = 1 AND revision = ?",
            )
            .run(revision);
          if (updated.changes !== 1)
            throw new Error(
              "Registry changed by another writer. Run only one Piano backend per database and restart this backend before retrying.",
            );
          persist(db, before, after);
          db.exec("COMMIT");
          revision++;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
