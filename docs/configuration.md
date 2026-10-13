# Configuration and storage

Reference for the environment variables Piano reads, the browser-origin policy, and where the
registry lives. Defaults come from `server/main.ts`, `server/Registry.ts` and `web/vite.config.ts`.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Address the backend binds to. |
| `PORT` | `7070` | Backend port. |
| `PIANO_ALLOWED_ORIGINS` | `http://127.0.0.1:<PORT>`, `http://localhost:<PORT>`, `http://[::1]:<PORT>` | Comma-separated browser origins allowed to change state. See [Browser origins](#browser-origins). |
| `PIANO_DB_PATH` | `$XDG_DATA_HOME/piano/piano.db`, or `~/.local/share/piano/piano.db` when `XDG_DATA_HOME` is unset | Registry database file. |
| `PIANO_REVISION_STORE` | `<database>.revisions` | Directory for workspace revision captures. |
| `PIANO_IDLE_MINUTES` | `30` | Idle minutes before Piano stops a session's Pi process. `0` keeps processes running. |
| `PIANO_PI_CLI` | the bundled Pi CLI | Path to another Pi CLI entry. It must use Pi's credential format. |
| `PIANO_PI_ARGS` | none | Extra Pi arguments, such as `-e ./ext.ts`. |
| `PIANO_WT_CLI` | `wt` | Worktrunk command. |
| `PIANO_DEV_BACKEND` | `http://127.0.0.1:7070` | Backend that the Vite development server proxies to. |

`npm run dev:server` sets `PIANO_ALLOWED_ORIGINS` to the three loopback origins on Vite's port 5173
unless you set it yourself.

Piano limits incoming WebSocket messages, RPC lines and pending work, and keeps capacity for answers
and cancellation. It rejects overload instead of queueing it for retry. See
[runtime input limits](runtime-input-limits.md).

## Browser origins

Piano is a trusted single-user tool for loopback use or private authenticated proxy access. It is
not built for public or multi-user hosting, and it has no login of its own. The missing login is
part of that model, not a new exposure finding. Keep the listener on loopback and proxy access
private.

Every request other than GET, HEAD and OPTIONS, and every `/ws` connection, needs an `Origin`
header that exactly matches an allowed origin. Piano checks it before routing, body decoding or a
WebSocket upgrade. A foreign, missing, empty or `null` origin gets HTTP 403. Scripts get no
exception, so a script that changes state must send an allowed `Origin` too. Read-only requests
work without one. Piano never trusts `Host`, `Forwarded`, `X-Forwarded-*` or identity headers.

The origin check defends against cross-site browser requests. It is not authentication, because a
non-browser client can forge the header. It does not replace private access, and it does not prove
that a proxy is private. Never allow an origin that serves untrusted generated previews.

Each entry in `PIANO_ALLOWED_ORIGINS` is a scheme, host and optional port. Paths, trailing slashes,
credentials, wildcards and `null` are invalid, and an invalid value stops startup. Behind a proxy or
on a custom Vite port, list the origin the browser uses, not the backend address. For the exe.dev
hosted setup, see [origin configuration](hosted-development.md#origin-configuration).

## Registry storage

Piano keeps its registry in SQLite through Node's built-in SQLite module. The `folders` table holds
added directories and the `projects` table holds named session groupings, the same names the code
uses. Workspaces, worktree references and session metadata have their own tables. Pi owns
conversation files and Git owns repository facts, so neither lives in the registry.

Piano refuses to start on a corrupt or unsupported database instead of resetting it. It upgrades an
older database in place when it opens it. The upgrade from version 1 (which had a project goal) to
version 2 first writes a private copy, `<database>.v1-backup`. An older Piano can open that copy but
not the upgraded file.

Run one backend per database. A second backend's stale writes fail and need a restart. SQLite
transactions commit before Piano changes its in-memory view.

The database file has mode `0600`. SQLite runs in WAL mode, so `-wal` and `-shm` files appear beside
it. To back up by copying files, stop Piano first. To back up while Piano runs, use SQLite's backup
API instead of copying the main file alone.

A new database starts empty, which makes a scratch `PIANO_DB_PATH` the way to test without touching
your own registry. Browser test fixtures seed scratch databases directly.
