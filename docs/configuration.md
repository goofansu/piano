# Configuration and storage

## Environment variables

Read where they are used: `grep -rn "process\.env\." server scripts web/vite.config.ts`.

## Piano's extensions

Every Pi child Piano starts loads Piano's extensions through Pi's `--extension`, as absolute paths
resolved from the Piano installation rather than from the session's directory, so a repository
cannot supply or shadow them. The flags come before the session arguments, so a `-e` in
`PIANO_PI_ARGS` adds an extension instead of replacing Piano's.

| Extension | Responsibility |
| --- | --- |
| `piano-session` | Keeps the session Piano started under its ID: Pi cancels an extension's switch, new session or fork. |
| `piano-project` | Adds a Piano project's instructions to each run's system prompt. |
| `piano-dispatch` | Dispatches work to sessions and observes them: `piano_start_session`, `piano_session_status` and `piano_wait_sessions`. |
| `piano-preview` | Manages the workspace's app preview: [`piano_preview`](live-previews.md). |
| `piano-ask-user` | Asks the user questions through Piano: [`ask_user`](#user-questions). |
| `piano-library` | Saves a skill or a prompt in Piano's folders after the user's Save: [`piano_save_skill` and `piano_save_prompt`](#saving-from-a-session). |
| `radius-artifacts` | When Radius is signed in, publishes, updates and views [Radius artifacts](radius-artifacts.md). Also usable as a standalone Pi package. |
| `pi-claude-code` | Offers Claude Code models through an externally installed, signed-in Claude CLI. See [Claude Code](#claude-code). |

Piano's first-party extensions follow Pi's multi-file layout under `extensions/<name>/`: `index.ts` is the extension, and a
module beside it, such as `piano-dispatch/SessionDispatch.ts`, is a supporting module, not a
separately discovered extension. They stay bundled with Piano and use the application's existing
dependencies and shared protocol.

### Claude Code

Piano bundles [`@earendil-works/pi-claude-code`](https://github.com/earendil-works/pi-claude-code)
as a dependency pinned to commit `dfb949333b9746df02bacbacbcbefd2b0138eff3` of the
[goofansu/pi-claude-code](https://github.com/goofansu/pi-claude-code) fork (version 0.1.0):
upstream `d5b5e04c314d3452d357174d16d10dda34daa2d2` plus fixes that keep every request within
Anthropic's limit of four cache breakpoints
([upstream issue #40](https://github.com/earendil-works/pi-claude-code/issues/40)) and wait for
captured Claude CLI output to close before reading the result
([fork PR #2](https://github.com/goofansu/pi-claude-code/pull/2)). It loads the installed extension
directly, without installing a Pi package at startup or changing global Pi settings. Pi run outside
Piano is unaffected.

**Avoid duplicate installations.** If the same plugin is also installed in user or project Pi
settings, Pi can load both copies: paths are deduplicated, not package identity across separate
installations. Provider registrations can override each other, status commands get numbered
suffixes, and initial model availability can be inconsistent. Piano does not suppress or remove
the other copy. Use only the bundled copy in the Pi environment used by Piano; if standalone Pi
needs a separate installation, keep that in a separate Pi environment.

Claude Code installation and authentication remain external. Install Claude Code separately and
run `claude auth login` in a terminal as the user running Piano. Its executable must be on the
Piano backend's `PATH`, or set `PI_CLAUDE_CODE_COMMAND` to its absolute path. For a nondefault
Claude configuration directory, set `PI_CLAUDE_CODE_CONFIG_DIR`; the plugin passes it to Claude
as `CLAUDE_CONFIG_DIR`. Piano does not copy or manage Claude credentials.

## Session dispatch

For dispatch, Piano sets two variables in each Pi child's environment, from the running server instance
(`server/SessionEndpoint.ts`). They are set for the child only; Piano never reads them.

| Variable | Value |
| --- | --- |
| `PIANO_SESSION_WS_URL` | `ws://<listener host>:<PORT>/ws`, the same socket the browser uses. The listener is addressed directly, so a child reaches Piano without going through a proxy; `0.0.0.0` and `::` become their loopback addresses. |
| `PIANO_SESSION_ORIGIN` | The [session link origin](#session-link-origin). It is also the base for a `/s/<sessionId>` link into Piano's UI, so there is no separate base-URL variable. |

The origin is chosen from the configured set, never added to it, so starting a child cannot widen
the [origin policy](#browser-origins). `piano-dispatch` sends it as the `Origin` header on the upgrade,
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
send an allowed `Origin` too. Piano never trusts `Forwarded`, `X-Forwarded-*` or identity headers.

Every request, a read included, also needs a `Host` header that names Piano: the host of an allowed
origin, or a loopback name (`127.0.0.1`, `localhost`, `[::1]`) on any port. A page reached through
DNS rebinding sends its own hostname as `Host` and gets HTTP 403, though a read carries no `Origin`
to refuse. Piano compares `Host` only with the configured origins, never the other way round.

The origin check blocks cross-site browser requests. It is not authentication, because a client
outside a browser can set any `Origin`. It does not replace private access, and it does not prove
that a proxy is private. Never allow an origin that serves untrusted generated previews.

Each entry in `PIANO_ALLOWED_ORIGINS` is an HTTP or HTTPS scheme, a host and an optional port. An
entry with a path, a trailing slash, credentials, a wildcard or `null` is invalid, and an invalid
entry stops startup. Behind a proxy or on a custom Vite port, list the origin the browser uses, not
the backend address. For the exe.dev setup, see
[origin configuration](hosted-development.md#origin-configuration).

## Registry storage

Piano stores its registry in SQLite through Node's built-in `node:sqlite` module. The tables match
the names the code uses: `folders` holds added directories, `projects` holds named session groups,
and `workspaces`, `worktrees` and `sessions` hold the rest. Pi owns conversation files and Git owns
repository facts, so neither is in the registry.

Piano refuses to start on a corrupt database, an unrecognized one, or one from a newer Piano. It
never resets a database. It upgrades an older database in place when it opens it, and the current
schema is version 17, which adds the [Data controls](data-controls.md) retention version. Version 16
drops the saved Radius link of the removed session sharing; artifacts already published stay in Radius. Version 15 adds durable `creation_attempts` claims for
[failed-creation recovery](runtime-ownership.md#failed-creation-and-reconnect). These small records
are retained even after a session is removed, so replaying an old attempt cannot create again.
They contain no prompt or attachments and do not clean up legacy sessions. Version 14 adds voice
input preferences; version 13 adds project done (`done_at`). Version 12 qualifies pull request branches with their repositories, version 11 adds the Changes
comparison and version 10 adds project instructions. Version 9 retires project archive: each archived project comes back as an
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
