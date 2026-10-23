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
| `PIANO_IDLE_MINUTES` | `30` | Idle minutes before Piano stops a session's Pi process. `0` keeps processes running. |
| `PIANO_PI_CLI` | the bundled Pi CLI, `server/PiRpcCli.ts` | Path to another Pi CLI entry. It must use Pi's credential format. |
| `PIANO_PI_ARGS` | none | Extra Pi arguments, split on whitespace, such as `-e ./ext.ts`. |
| `PIANO_WT_CLI` | `wt` | Worktrunk command. |
| `PIANO_DEBUG` | unset | Any value prints Pi transport messages to stderr, prefixed `[PiTransport]`. |
| `PIANO_PREVIEW_CONFIG` | unset (macOS: previews on `http://localhost`; Linux: unavailable) | Absolute path to private JSON deployment configuration for [managed previews](live-previews.md): the explicit exe.dev origin (required on Linux), reserved ports and the app's `PATH`. |
| `PIANO_PREVIEW_STATE` | `~/.local/state/piano/previews` | Durable preview intents and allocation lock. Override only for isolated scratch verification; all production sessions must share one directory. |
| `PIANO_DEV_BACKEND` | `http://127.0.0.1:7070` | Backend that the Vite development server proxies to. |

Piano also honors two of Pi's own variables. `PI_CODING_AGENT_SESSION_DIR` sets where Piano looks
for session files. `PI_OFFLINE` stops the bundled Pi CLI from refreshing its model catalog at
startup.

`npm run dev:server` sets `PIANO_ALLOWED_ORIGINS` to the three loopback origins on Vite's port 5173,
unless you set it yourself.

## The session extension

Every Pi child Piano starts loads `extensions/piano-sessions/index.ts` through Pi's `--extension`, as an
absolute path resolved from the Piano installation rather than from the session's directory, so a
repository cannot supply or shadow it. The flag comes before the session arguments, so a `-e` in
`PIANO_PI_ARGS` adds an extension instead of replacing Piano's.

The extension follows Pi's multi-file layout: `index.ts` registers the tools, while `NodeSocket.ts`
and `SessionDispatch.ts` sit beside it as supporting modules, not separately discovered extensions.
It remains bundled with Piano and uses the application's existing dependencies and shared protocol.

Piano sets two variables in that child's environment, from the running server instance
(`server/SessionEndpoint.ts`). They are set for the child only; Piano never reads them.

| Variable | Value |
| --- | --- |
| `PIANO_SESSION_WS_URL` | `ws://<listener host>:<PORT>/ws`, the same socket the browser uses. The listener is addressed directly, so a child reaches Piano without going through a proxy; `0.0.0.0` and `::` become their loopback addresses. |
| `PIANO_SESSION_ORIGIN` | The [session link origin](#session-link-origin). It is also the base for a `/s/<sessionId>` link into Piano's UI, so there is no separate base-URL variable. |

The origin is chosen from the configured set, never added to it, so starting a child cannot widen
the [origin policy](#browser-origins). The extension sends it as the `Origin` header on the upgrade,
which Node's built-in `WebSocket` supports through Undici's `headers` option. Without a loopback
endpoint and an allowed origin, dispatch is not advertised. Inherited endpoint variables are
cleared before Piano supplies this instance's configuration. See [session dispatch](session-dispatch.md)
for usage and observation limits.

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

### Session link origin

Piano links into its UI, `<origin>/s/<sessionId>`, from a dispatched session. It takes the origin
from `PIANO_ALLOWED_ORIGINS`, by one rule:

1. the first HTTPS origin, because a link has to open from a remote browser;
2. otherwise the origin naming the listener (`HOST:PORT`);
3. otherwise the first configured origin, which in development is Vite's.

Without `PIANO_ALLOWED_ORIGINS` this is the listener's loopback origin. To link through a different
HTTPS alias, list it first. The origin is never taken from a request header.

## Registry storage

Piano stores its registry in SQLite through Node's built-in `node:sqlite` module. The tables match
the names the code uses: `folders` holds added directories, `projects` holds named session groups,
and `workspaces`, `worktrees` and `sessions` hold the rest. Pi owns conversation files and Git owns
repository facts, so neither is in the registry.

Piano refuses to start on a corrupt database, an unrecognized one, or one from a newer Piano. It
never resets a database. It upgrades an older database in place when it opens it, and the current
schema is version 9, which retires project archive: each archived project comes back as an
ordinary one. Version 8 adds user-configured [webhooks](webhooks.md). Version 7 drops retired
notification preference tables without changing session data. Before it upgrades a version 1 database, which still has project goals, Piano
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
