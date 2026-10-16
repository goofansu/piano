#!/usr/bin/env node
/**
 * Downgrade Piano's SQLite registry schema 7 -> 6 after removing PIN-31.
 * Run with Piano fully stopped. Produces a SQLite-consistent backup first.
 * This intentionally drops only PIN-31's four session columns.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const databasePath = process.argv[2];
if (!databasePath || process.argv.length !== 3) {
  console.error("Usage: node scripts/downgrade-v7-to-v6.mjs /absolute/path/to/piano.db");
  process.exit(2);
}
const path = resolve(databasePath);
if (!existsSync(path) || lstatSync(path).isSymbolicLink() || realpathSync(path) !== path) {
  throw new Error("Database must exist and be a real, non-symlink path.");
}
const db = new DatabaseSync(path, { timeout: 5000 });
try {
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  const version = Number(db.prepare("PRAGMA user_version").get().user_version);
  if (version !== 7) throw new Error(`Expected schema 7; got ${version}. No changes made.`);
  const names = new Set(db.prepare("PRAGMA table_info(sessions)").all().map((row) => row.name));
  for (const name of ["seq", "completed_seq", "last_status", "last_detail"]) {
    if (!names.has(name)) throw new Error(`Expected column sessions.${name}. No changes made.`);
  }
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
    throw new Error("Database integrity check failed. No changes made.");
  if (db.prepare("PRAGMA foreign_key_check").all().length)
    throw new Error("Database foreign keys are invalid. No changes made.");

  // VACUUM INTO captures a consistent snapshot, including committed WAL contents.
  const backup = `${path}.before-v7-downgrade-${randomUUID()}.db`;
  db.prepare("VACUUM INTO ?").run(backup);
  console.log(`Backup: ${backup}`);

  // DDL and user_version change commit atomically. Preserve all non-PIN-31 data.
  db.exec("BEGIN IMMEDIATE");
  try {
    if (Number(db.prepare("PRAGMA user_version").get().user_version) !== 7)
      throw new Error("Schema version changed during downgrade.");
    // completed_seq references seq in its CHECK; drop it first.
    for (const name of ["completed_seq", "seq", "last_status", "last_detail"])
      db.exec(`ALTER TABLE sessions DROP COLUMN ${name}`);
    db.exec("PRAGMA user_version = 6");
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("Foreign key check failed during downgrade.");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
    throw new Error(`Post-migration integrity check failed; restore ${backup} before proceeding.`);
  console.log(`Downgraded ${path} from schema 7 to schema 6.`);
} finally {
  db.close();
}
