# Configuration and storage

Reference for the environment variables Piano reads, the browser-origin policy, and the registry
database. Defaults come from `server/main.ts`, `server/Registry.ts`, `server/RegistryDatabase.ts`
and `web/vite.config.ts`.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Address the backend binds to. |
| `PORT` | `7070` | Backend port. |
| `PIANO_ALLOWED_ORIGINS` | `http://127.0.0.1:<PORT>`, `http://localhost:<PORT>`, `http://[::1]:<PORT>` | Comma-separated browser origins that may change state. A set value replaces the defaults. See [browser origins](#browser-origins). |
| `PIANO_DB_PATH` | `$XDG_DATA_HOME/piano/piano.db`, or `~/.local/share/piano/piano.db` when `XDG_DATA_HOME` is unset | Registry database file. |
| `PIANO_API_SOCKET` | unset | Enable the local `/api/v1/*` API on an absolute Unix socket path (mode `0600`); takes precedence over `PIANO_API_PORT`. Never forwarded by the HTTPS proxy. |
| `PIANO_API_PORT` | unset | Alternatively enable the local API on a separate `127.0.0.1` port, e.g. `8002`. Never proxy this port. With neither variable set, the API is off. |
| `PIANO_IDLE_MINUTES` | `30` | Idle minutes before Piano stops a session's Pi process. `0` keeps processes running. |
| `PIANO_PI_CLI` | the bundled Pi CLI, `server/PiRpcCli.ts` | Path to another Pi CLI entry. It must use Pi's credential format. |
| `PIANO_PI_ARGS` | none | Extra Pi arguments, split on whitespace, such as `-e ./ext.ts`. |
| `PIANO_WT_CLI` | `wt` | Worktrunk command. |
| `PIANO_DEBUG` | unset | Any value prints Pi transport messages to stderr, prefixed `[PiTransport]`. |
| `PIANO_DEV_BACKEND` | `http://127.0.0.1:7070` | Backend that the Vite development server proxies to. |

Piano also honors two of Pi's own variables. `PI_CODING_AGENT_SESSION_DIR` sets where Piano looks
for session files. `PI_OFFLINE` stops the bundled Pi CLI from refreshing its model catalog at
startup.

`npm run dev:server` sets `PIANO_ALLOWED_ORIGINS` to the three loopback origins on Vite's port 5173,
unless you set it yourself.

The optional [local session API](api.md) uses a separate, never-proxied listener and rejects every
`Origin` header. The browser-origin policy below applies only to the main listener.

Piano limits incoming WebSocket messages, RPC lines and pending work, and keeps capacity for answers
and cancellation. It rejects overload instead of queueing it for retry. See
[runtime input limits](runtime-input-limits.md).

## Browser origins

Piano is a single-user tool for loopback use or access through a private authenticated proxy. It has
no login, and it is not built for public or multi-user hosting. The missing login is part of that
model, not a security finding. Keep the listener on loopback and the proxy private.

A request needs an `Origin` header that exactly matches an allowed origin when it is any of these:

- a method other than GET, HEAD or OPTIONS
- a connection to `/ws`
- a request with an `Upgrade` header

Piano checks the origin before routing, body decoding or a WebSocket upgrade. A foreign, missing,
empty or `null` origin gets HTTP 403. Scripts get no exception, so a script that changes state must
send an allowed `Origin` too. Piano never trusts `Host`, `Forwarded`, `X-Forwarded-*` or identity
headers.

The origin check blocks cross-site browser requests. It is not authentication, because a client
outside a browser can set any `Origin`. It does not replace private access, and it does not prove
that a proxy is private. Never allow an origin that serves untrusted generated previews.

Each entry in `PIANO_ALLOWED_ORIGINS` is an HTTP or HTTPS scheme, a host and an optional port. An
entry with a path, a trailing slash, credentials, a wildcard or `null` is invalid, and an invalid
entry stops startup. Behind a proxy or on a custom Vite port, list the origin the browser uses, not
the backend address. For the exe.dev setup, see
[origin configuration](hosted-development.md#origin-configuration).

## Notifications

In **Settings → Integrations**, [Slack notifications](notifications.md) use one selected, attached
Slack integration when an agent finishes responding. Selection persists in Piano’s database. Positive
environment detection lasts until backend restart; the integration catalog refreshes separately.

## Registry storage

Piano stores its registry in SQLite through Node's built-in `node:sqlite` module. The tables match
the names the code uses: `folders` holds added directories, `projects` holds named session groups,
and `workspaces`, `worktrees` and `sessions` hold the rest. `notification_settings` holds the one
selected exe.dev integration name. Pi owns conversation files and Git owns repository facts,
so neither is in the registry.

Piano refuses to start on a corrupt database, an unrecognized one, or one from a newer Piano. It
never resets a database. It upgrades an older database in place when it opens it, and the current
schema is version 7 (session turn counters and last-known API outcomes). Before it upgrades a version 1 database, which still has project goals, Piano
writes a private copy to `<database>.v1-backup`. An older Piano can open that copy but not the
upgraded file.

Run one backend per database. When a second backend writes, the first backend's next write fails,
and that backend needs a restart. SQLite commits each change before Piano updates its in-memory
view.

Piano creates the database directory with mode `0700` and the file with mode `0600`. It refuses a
database path that is a symlink. SQLite runs in WAL mode, so `-wal` and `-shm` files appear beside
the database. To back up by copying files, stop Piano first. To back up while Piano runs, use
SQLite's backup API, because a copy of the main file alone can miss committed changes.

A new database starts empty, so a scratch `PIANO_DB_PATH` lets you test without touching your own
registry. Browser test fixtures seed scratch databases directly.
