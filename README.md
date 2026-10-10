# piano

A browser UI for [Pi](https://github.com/earendil-works/pi) sessions across projects and git worktrees.

## Requirements

- Node.js 24 and npm.
- Git.
- Pi model credentials (sign in through Piano below, or configure Pi directly; default agent directory: `~/.pi/agent`). The Pi runtime is installed with Piano's dependencies.
- [Worktrunk](https://worktrunk.dev) (`wt`) on `PATH` for worktree support.

## Install and run

- Clone this repository and enter its directory.
- Install dependencies, build the UI, and start the server:

  ```bash
  npm install
  npm run build
  npm start
  ```

- Open <http://127.0.0.1:7070>.
- Keep Piano on loopback or behind private authenticated access: it has no built-in access authentication and can execute commands as your user.

## Provider sign-in

Open **Settings** at the bottom of the sidebar, then choose **Sign in** next to a
provider in **Providers**. Settings is also reachable through Mod+K and `/settings`.
No folder or model selection is required. Provider sign-in is not a composer command.

Pi handles authorization and saves credentials in its normal `auth.json`; Piano does
not put tokens or pasted codes in session history, the registry or browser storage.
Use device-code/copy-code methods when Piano runs on another machine. Radius's browser
method requires a callback on the Piano server; its device-code method works remotely.
Hiding or reloading the dialog preserves an active sign-in; return to **Settings → Providers** and click **Sign in** to resume
it. **Cancel sign-in** stops it. Attempts expire after 15 minutes or when Piano stops.

Start a new session after signing in: already-running RPC children retain their model
availability snapshot. This global flow uses the bundled Pi SDK's built-in providers
and `models.json` configuration; extension-only OAuth providers, API-key setup and
logout still require Pi TUI. A custom `PIANO_PI_CLI` must share the same credential format.

## Develop

- Start the backend and UI together:

  ```bash
  npm run dev
  ```

- Both processes have labeled logs. Press Ctrl+C to stop both.
- To run them separately, use `npm run dev:server` and `npm run dev:web`.

- Open <http://localhost:5173>. Vite proxies API and WebSocket requests to the backend on port 7070.
- `npm run dev` restarts the backend on changes, interrupting active sessions. Use `npm start` when you want manual restarts.
- Run checks before committing:

  ```bash
  npm test
  npm run typecheck
  npm run lint
  ```

- `npm run lint` runs Biome and `@shadcn/lint` via ESLint. Run `npm run lint:tailwind` for Tailwind checks alone. Configure rules in `eslint.config.mjs`; currently it rejects unknown classes using the UI's Tailwind theme, including inside `components/ui`. Inline ESLint directives are ignored for this dedicated check so legacy React Hooks directives do not interfere.
- `npm install` sets up a Husky pre-commit hook that runs `npm run lint`; a lint error blocks the commit.

- Tests use fake Pi and need no model credentials.
- Main directories: `server/` (backend), `web/` (React UI), `shared/` (wire schemas), `test/` (tests).
- See [development docs](docs/README.md) for architecture, invariants, and verification guidance.
- For the hosted exe.dev instance, use the [separate scratch development setup](docs/hosted-development.md#develop-and-verify-separately); do not develop against the running user instance.

## Configuration

- `HOST`: bind address; defaults to `127.0.0.1`.
- `PORT`: backend port; defaults to `7070`.
- `PIANO_DB_PATH`: SQLite registry path; defaults to `$XDG_DATA_HOME/piano/piano.db` or `~/.local/share/piano/piano.db` when `XDG_DATA_HOME` is unset.
- `PIANO_DEV_BACKEND`: Vite proxy target; defaults to `http://127.0.0.1:7070`.
- `PIANO_PI_CLI`: override the bundled Pi CLI entry path.
- `PIANO_PI_ARGS`: extra Pi arguments, such as `-e ./ext.ts`.
- `PIANO_IDLE_MINUTES`: idle time before retiring a session's Pi process; defaults to `30`, or `0` to disable.

## Registry storage

Piano keeps its registry in SQLite at `$XDG_DATA_HOME/piano/piano.db` (default
`~/.local/share/piano/piano.db`), using Node's built-in SQLite support. SQL tables `folders` hold the
selected directories and `projects` hold the named session groupings, matching `folders` and
`projects` in code.
Workspaces, worktree references and session metadata are separate tables. Pi still owns conversation
files; Git owns repository facts. Unsupported or corrupt databases fail startup rather than being reset.

Run one backend per database; stale writes from a second backend fail explicitly and require a
restart. SQLite transactions commit before the in-memory view changes.

The database uses mode `0600`. SQLite uses WAL, so `-wal` and `-shm` files may appear beside the
database. For a file-copy backup, stop Piano cleanly first; for live backups use SQLite's backup
facility rather than copying only the main file.

For scratch development, set `PIANO_DB_PATH` to a file in your scratch directory; a new database
starts empty. Workspace revision captures live in `<database>.revisions` unless
`PIANO_REVISION_STORE` overrides it. Browser fixtures seed scratch databases directly.
