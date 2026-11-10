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
| `PIANO_PEER_CONFIG` | unset | Absolute path to the startup JSON for [same-owner remote Pianos](remote-piano.md): a single peer object or `{ "peers": [...] }`. No remotes when unset. |
| `PIANO_DEV_BACKEND` | `http://127.0.0.1:7070` | Backend that the Vite development server proxies to. |

Piano also honors two of Pi's own variables. `PI_CODING_AGENT_SESSION_DIR` sets where Piano looks
for session files. `PI_OFFLINE` stops the bundled Pi CLI from refreshing its model catalog at
startup.

`npm run dev:server` sets `PIANO_ALLOWED_ORIGINS` to the three loopback origins on Vite's port 5173,
unless you set it yourself.

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
as a dependency pinned to upstream commit `d5b5e04c314d3452d357174d16d10dda34daa2d2`
(version 0.1.0). It loads the installed extension directly, without installing a Pi package at
startup or changing global Pi settings. Pi run outside Piano is unaffected.

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

Open a new session and choose a `claude-code/...` model in the model picker
(upstream provider name: **Claude Code Subscription (Experimental)**).
The plugin hides these models when the CLI is missing or signed out; other providers remain
available. `/claude-code-status` checks the executable and login without generating a reply.
Sign in through the CLI, not Piano's provider sign-in flow. If availability is stale, refresh the
model list or open a new session.

Pi still owns conversation history and tool execution. The plugin uses `claude -p` for inference
and a local loopback relay; Claude Code does not execute the tools. It ignores `ANTHROPIC_API_KEY`
in its Claude children and rejects conflicting auth-token, proxy or cloud-backend overrides rather
than silently changing authentication or billing.

This provider is experimental and subject to Anthropic's subscription limits and billing-policy
changes; it does not provide unlimited or guaranteed subscription usage. See the
[upstream caveats](https://github.com/earendil-works/pi-claude-code#usage-and-billing).
Model discovery can make Claude catalog/feature-flag and telemetry requests but sends no generation
request or conversation history. Set `DISABLE_TELEMETRY=1` before starting Piano to opt out of
that telemetry; this can reduce the discovered model catalog.

## Piano's prompts and skills

What Settings › Prompts and Settings › Skills create lives in Piano's own folders beside the
registry database (`server/PianoFolders.ts`): `prompts/` and `skills/`, so
`~/.local/share/piano/prompts/` and `~/.local/share/piano/skills/` by default, and a scratch
`PIANO_DB_PATH` brings its own. Every Pi child Piano starts loads them through `--prompt-template`
and `--skill`; Pi run outside Piano does not. Each page lists its folder only: prompts and skills
in Pi's own folders, `~/.agents/skills` or a repository stay theirs. Pi loads everything else
first and keeps the first of a name, so a new name Pi already loads from outside Piano's folders
is refused: Pi's own folders and `~/.agents/skills`, the `skills` and `prompts` entries in Pi's
`settings.json` and installed Pi packages, as Pi's own resolver finds them (`server/PiLoads.ts`),
so one a `-name` entry turns off is free. Piano only reads them: a package that is not installed
is skipped, not installed. For the same reason a prompt or skill already in Piano's folder is not
updated once Pi loads one of its name from elsewhere: it stays listed so it can be deleted. A
repository's is not checked, since which one applies depends on the session's folder. Settings › Skills lists each skill Pi loads from Piano's folder
(a real `<directory>/SKILL.md`, not a link) under the name Pi loads it as, through Pi's own loader,
so a SKILL.md renamed by hand is still listed and can be deleted. Settings › Prompts lists each
real `<name>.md` (not a link) by the name Pi loads it as, so one placed by hand under a name New
prompt would refuse, such as `Review.md`, can still be deleted. Deleting one already gone is
refused on both pages. Both follow one draft rule (`shared/drafts.ts`): a name in the
Agent Skills form (at most 64 lowercase letters, numbers and single hyphens, not at the start or
end), a description of at most 1,024 characters and instructions of at most 20,000. A skill adds
Disable model invocation.
See [prompts](prompts.md).

### Saving from a session

`piano-library` registers `piano_save_skill` and `piano_save_prompt`, model-callable tools and no
slash command, and only when Piano gave the child its endpoint (`PIANO_SESSION_WS_URL`,
`PIANO_SESSION_ORIGIN`, as for [dispatch](#session-dispatch)). A call first asks Piano for the
save's proposal (`POST /api/settings/skills/proposal` or `/api/settings/prompts/proposal`): the file
it would write and, for one Piano created, the file it replaces, or the refusal the save itself
would give (the draft rule, a name already taken), so the user is never asked to approve a save
Piano would refuse. It then asks through a Pi `confirm` dialog whose title and message
`shared/library.ts` writes; the browser shows it above the composer as a card: the file as it would
be saved for a new one, a diff against the saved file for one Piano created. Only **Save** writes,
through the same HTTP endpoints Settings uses (`PUT` replaces a skill or prompt Piano created and
refuses any other name). Cancel, Stop or the dialog's recovery deadline write nothing. The toast is
the Settings page's, and the transcript row ("Prompt saved: `name`", with View) is rebuilt from Pi's
saved tool result. A save reaches sessions Piano starts from then on; no running Pi is reloaded.
Design: [agent-authored skills and prompts](research/2026-11-02-agent-authored-skills-and-prompts.md).

## Session dispatch

Piano sets two variables in each Pi child's environment, from the running server instance
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

## User questions

`piano-ask-user` registers the model-callable `ask_user` tool, not a slash command. The model supplies a
non-empty `questions` array, including for a single question. Each item has a unique `id`, a
`question` containing essential context, and optionally an `options` array for a single choice;
without options, the user can write a multiline answer. Batch independent questions; ask dependent
questions only after reading the earlier answers.

```json
{
  "questions": [
    { "id": "database", "question": "Which database?", "options": ["PostgreSQL", "SQLite"] },
    { "id": "requirements", "question": "What should change?" }
  ]
}
```

Piano displays one question at a time above the composer without replacing its draft. Batches
have numbered titles such as “1 of 2: Which database?”. **Send answer** saves that answer and
advances to the next question, with no model turn between questions. After the last answer, the
tool returns `{ status: "answered", answers: { database: "SQLite", requirements: "Keep the API" } }`.

**Cancel** ends the whole batch and returns `{ status: "cancelled", answers: { database: "SQLite" } }`
if only the first answer was submitted. Unanswered IDs are absent, not empty strings or inferred
answers. Empty text is a submitted answer, distinct from cancellation. There is no Back/Edit step.
Stop/Abort cancels the pending question and run, without opening remaining questions or starting
model continuation. Questions without a reply are also subject to the host's existing dialog
recovery deadline; cancellation is never approval and must not be retried automatically.

After the batch ends, the transcript's **Answers** row pairs each question with its submitted
answer, expanded by default. Partial batches show **Not answered** for missing replies and
**Empty answer** for submitted empty text. The temporary delivery receipt above the composer
disappears once written; pending or uncertain delivery stays visible. The transcript summary is
rebuilt from Pi's saved tool call and result when the session is reopened, not from the last receipt.

Pi owns the tool call and result in session history. The extension sends no synthetic user
message, starts no separate turn, and makes no extraction model call. It requires an interactive
UI (Piano's RPC dialogs or Pi's terminal); headless use fails explicitly. This preserves the
existing [dialog lifecycle](runtime-ownership.md) and INV-01/04/12.

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

### Session link origin

Piano links into its UI, `<origin>/s/<sessionId>`, from a dispatched session and in a webhook
payload. It takes the origin from `PIANO_ALLOWED_ORIGINS`, by one rule:

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
schema is version 15, which adds durable `creation_attempts` claims for
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
