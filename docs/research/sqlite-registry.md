# SQLite registry migration — verification

Tested on Node 24.21.0/Linux, based on `71a5ed17c030d24144f7b350cb6b0224d90df9b6`
plus this change's working-tree diff. No dependency upgrade, model credits, production registry
access, build or deployment was needed.

## Contract and implementation

Preserves INV-01 and INV-07: Registry owns selections/identities/metadata, Pi owns history, Git owns
repository facts, and revision/evidence storage stays separate. Existing Registry/wire vocabulary
is unchanged. SQL uses `folders` for selected directories and `projects` for outcome groupings,
with `folder_path` and `project_id` for their respective references.

Node's built-in SQLite stores normalized references plus a replaceable statistics JSON column.
Import supports unversioned/v1/v2 JSON, preserves identities/order/path spelling and hidden-folder
references, and retains both the unchanged source and a private byte-exact backup. A versioned
transaction publishes the import once. Updates write changed rows transactionally before publishing
the memory snapshot; failed writes roll back and conflicting backend writers fail explicitly.
The schema separately retains discover/removed/linked PR preferences, including the integration host.

## Observed gates

- `npm test`: **97 passed**, zero failed/skipped. Raw output: `/tmp/piano-sqlite-tests.log`.
  New Registry tests cover full v2 roundtrip, SQL naming and private permissions, authoritative
  SQLite restart/no JSON dual writes, rollback of a multi-table failure with retry, rejected imports,
  unsupported/corrupt databases, competing writers, and database-location precedence.
  Existing legacy/v1 migration, workspace identity, Pi history and PR behavior tests also pass.
- `npm run typecheck`: passed. `/tmp/piano-sqlite-typecheck.log`.
- `npm run lint`: passed (Biome and Tailwind ESLint). `/tmp/piano-sqlite-lint.log`.
- `node test/browser-outcome-projects.mjs /tmp/piano-sqlite-browser-final`: **passed** using
  `npx agent-browser`, fake Pi, scratch Git directories, SQLite and ports 7171/7172. Observed import,
  project creation/rename, cross-folder assignment, moving/leaving, archive/unarchive during work,
  hidden folders, unavailable histories/checkouts, mobile views and backend restart persistence.
  Commands, screenshots, process output and result are retained in that directory; terminal output
  is `/tmp/piano-sqlite-browser-final.log`. The script cleaned up its processes and scratch files.
- Review: storage ownership, migration failure paths, exact optional-field mapping, table constraints,
  path defaults, and document guidance inspected; `git diff --check` passed.

An earlier browser run stopped at an obsolete header Project-submenu selector after successfully
exercising migration and edits. The simplified header at the base revision no longer offers it;
the test now uses the existing sidebar membership action. Failure output is retained in
`/tmp/piano-sqlite-browser-retry`; the complete corrected journey passed above.

## Limits and operations

The registry still serves cached full snapshots and computes row differences in memory. No measured
UI-speed claim is made, and multiple backend writers are not supported. SQLite's indexes do not
change conversation loading or Pi persistence. Direct database edits should be made with Piano stopped.
See [migration, location and backup guidance](../../README.md#registry-storage).
Rolling back to the old JSON-based application does not recover post-migration metadata edits.

## Follow-up: remove the legacy configuration environment variable

Based on `be0e510` plus this follow-up's working-tree diff, Node 24.21.0/Linux. `PIANO_CONFIG`
is no longer read by the runtime. Default startup imports the fixed `~/.config/piano/config.json`
without configuration. `PIANO_DB_PATH` remains the database override; a new non-default database
starts empty rather than importing the user's normal selections. Existing default revision storage
is preserved, while custom databases keep captures under `<database>.revisions` unless overridden.
This preserves INV-01/07 and removes the prior public JSON-sidecar location rule.

- `npm test`: **98 passed**, zero failed/skipped (`/tmp/piano-no-config-tests.log`). The added
  child-process check observes default migration/restart, ignored retired environment values and
  isolation of a custom database with a populated standard JSON file still present.
- `npm run typecheck` and `npm run lint`: passed (`/tmp/piano-no-config-{typecheck,lint}.log`).
- `node test/browser-outcome-projects.mjs /tmp/piano-no-config-browser`: passed the full journey
  again, now with scratch HOME/data directories and no config/database path override. The backend
  performs automatic import, preserves the backup and retains browser edits across restart.
  Commands, screenshots and results are retained in the evidence directory.
- `node test/browser-phase7.mjs /tmp/piano-no-config-revisions`: passed scratch custom-database
  seeding and workspace capture identity/edit/failure/recovery checks through HTTP. Other browser
  fixtures were mechanically updated to seed via Registry and launch with `PIANO_DB_PATH`; they
  were not all rerun. The seed helper isolates fixtures from inherited developer DB settings.
- Reviewed path selection, seed timing, default revision-store compatibility and active development
  recipes; `git diff --check` passed. Historical research notes retain their original environment
  names; current configuration/recovery instructions are in README.

Scratch processes/files were cleaned up. No production migration, build, deployment or paid model
call was performed.
