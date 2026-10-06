# piano

Start or continue [Pi](https://github.com/earendil-works/pi) sessions across your projects from a
browser. Every session is a Pi session in a directory; that directory can be the project root or a
git worktree created through [worktrunk](https://worktrunk.dev) (`wt`).

Each running session is one long-lived `pi --mode rpc --session-id <id>` child. RPC was chosen over
the SDK or one process per turn because it isolates sessions from each other, keeps `abort` and
follow-up semantics, and forwards extension dialogs (`select`, `confirm`, `input`, `editor`,
`notify`) so they can be answered from the browser.

## Development direction

The [docs index](docs/README.md) links the proposed ADR, development invariants, implementation
roadmap and exe.dev handoff. The direction is a Pi + Worktrunk workspace workbench with
revision-bound evidence. These documents distinguish planned contracts from current capabilities.
Piano owns workspace and verification policy; Worktrunk is the initial worktree lifecycle backend.
Development methodology remains skill-agnostic.

## Stack

- Server: Node 24 running TypeScript directly, on **Effect 4.0.0-rc.118** (pinned exactly; the RC
  line still renames things between releases). HTTP, WebSocket upgrade, child processes, schemas
  and lifecycle all come from `effect` and `@effect/platform-node`.
- Client: React 19, Vite, Tailwind 4, shadcn/ui components (copied into `web/src/components/ui`),
  light/dark/system theme via `next-themes`.
- Shared: the wire vocabulary in `shared/wire.ts` is a set of `effect` Schemas imported by both.

## Run

```bash
npm install          # installs the server and the web workspace
npm run build        # builds web/dist
npm start            # http://127.0.0.1:7070 serves web/dist and the WebSocket
```

During UI work run `npm start` and `npm run dev:web` together; the Vite dev server on 5173
proxies `/api` and `/ws` to the server. `npm test` runs the module tests (they use a scripted fake
Pi, no credentials needed). `npm run typecheck` checks server and client.

For the private development instance at `https://yejun-dev.exe.xyz/` (port 8000),
see [hosted development](docs/hosted-development.md). It serves the built frontend;
builds and backend restarts are deliberate so self-development does not interrupt active Pi sessions.

Requires a working `pi` setup (credentials in the Pi agent dir) and `wt` on `PATH` for worktree
support.

## Pi environment

Piano resolves Pi's directories the same way the `pi` CLI does, and the spawned children inherit
the environment, so both sides see the same sessions:

| Variable                      | Effect                                                                  |
|-------------------------------|-------------------------------------------------------------------------|
| `PI_CODING_AGENT_DIR`         | Pi agent dir (default `~/.pi/agent`): settings, auth, models, sessions     |
| `PI_CODING_AGENT_SESSION_DIR` | session dir; else the `sessionDir` setting; else `<agent dir>/sessions/<encoded cwd>/` |

Note Pi's variable is `PI_CODING_AGENT_DIR`, not `PI_AGENT_DIR`.

Piano's own settings:

| Variable             | Default                        | Purpose                                                        |
|----------------------|--------------------------------|----------------------------------------------------------------|
| `PORT`               | `7070`                         | HTTP/WebSocket port                                            |
| `HOST`               | `127.0.0.1`                    | Bind address. There is no auth; keep it local.                 |
| `PIANO_CONFIG`       | `~/.config/piano/config.json`  | Where the selected projects are stored                         |
| `PIANO_PI_CLI`       | `node_modules/.../dist/cli.js` | Pi CLI entry to spawn                                          |
| `PIANO_PI_ARGS`      | empty                          | Extra arguments for every spawned `pi`, e.g. `-e ./ext.ts`     |
| `PIANO_IDLE_MINUTES` | `30`                           | Retire a session's Pi process this long after its last activity, unless a turn, dialog or queued input is pending (`0` disables) |

## Use

Piano is the source of truth for what the sidebar shows. Its registry (the config file) holds the
projects you added, the worktrees created through piano, and the sessions started through piano.
Pi's own session store is read only to load a session's history; it is never scanned to populate
the sidebar, so sessions started from the terminal do not appear here.

1. **New** is the entry point and works like Codex: a prompt box whose footer holds the
   directory (known projects and worktrees, or Browse…; the last choice is remembered), the model
   (every model Pi can use, Pi's default preselected, fuzzy-searchable) and the effort level. Sending the prompt registers
   the directory as a project if it is not one yet, starts Pi with those settings, opens the
   session and delivers that first message. A project shows its root branch plus any worktrees
   created through piano.
2. The directory picker on the New page also offers **New worktree…**, which runs
   `wt switch --create <branch> --no-cd` in a project (hooks skipped unless ticked), registers the
   result and selects it. The project menu (…) offers **Close**, which takes the project out of the sidebar; its sessions stay in the registry and come back when the directory is used again.
3. The **+** on a project row opens New session with that directory prefilled; click an existing
   session to load its history (nothing is started).
4. The **model** picker is filled by Pi itself: Piano runs a short-lived
   `pi --mode rpc --no-session` probe in the selected directory for its available models and default.
   Project resources remain subject to Pi's trust policy. An existing session shows its recorded
   selection; starting it lets Pi restore or fall back unless you explicitly change the picker.
   Running selections and effort are read back from Pi, including clamping.
5. Sending a message starts Pi for the session and registers it; the first prompt becomes the title.
   Like Codex, there is nothing to start or stop by hand: Pi processes outlive browser tabs, a
   session's process is retired 30 minutes after its last activity, and the next message starts it
   again in about half a second from the session file. Re-selecting a session re-attaches with a full
   snapshot, including any dialog Pi is still waiting on.
6. A session's menu (…) offers **Archive**, which stops Pi for it and hides it, and **Delete**,
   which stops Pi, deletes the session file from Pi's session store and forgets the session. An Archived page to
   find and restore archived sessions is planned but not built yet.

## Image attachments

Upload, paste or drop PNG, JPEG, WebP or GIF images into either composer: **10 MiB per image,
4 images per message, 20 MiB combined**. Images send when Pi is idle. These are Piano's original-file
upload limits; Pi handles model-specific resizing. See the [policy and rationale](docs/image-attachments.md).

## Session display and limits

The transcript is **Current Pi context**, not all raw history. Live output is corrected by Pi's
content/message endings; settled work, handled commands and compaction reload the authoritative
context. File peeks use Pi's own active-branch, compaction and context-edit projection. System
messages and thinking blocks are omitted; user images have previews from Pi's processed content.
Raw history stays in Pi, unchanged by display redaction. A failed or repeatedly racing refresh is labeled rather than silently called current.

The composer model picker shows the selection. Its value from a stopped file is a recorded hint;
Pi confirms or restores it on start. The existing **Context usage** popover provides session totals,
cost and the latest displayed response's physical model/effort on demand. Response/tool usage remains
cumulative per result in the wire data. Full-session totals come from Pi (including work outside the
current context), and are unavailable on a read-only file peek. These guarantees are enforced in
state handling and tests, not repeated as permanent header or per-message disclaimers.

Tool previews show the **latest update**, not an assumed append-only log. Final execution output
replaces it. Nested calls remain execution details, not extra messages or additional usage. Pi
persists bounded nested-call identity/status, not their output; that output is available only while
the hosting process retains it. An unfinished retained call is labeled incomplete.

Supported extension statuses, string widgets, title and editor requests survive browser reload
while Pi is hosted. Editor requests are opt-in **Append to draft**, never automatic submission or
draft replacement. Widget placement is labeled within a shared extension panel. Pi must reissue
transient extension state after process restart; terminal `custom()`/component factories and other
RPC no-ops remain unsupported. Awaited startup dialogs retain the documented bounded-startup limit.

All outbound display data uses the same heuristic redaction: known secret-valued environment
variables (at least eight characters), common token shapes, bearer values, credential assignments
and private-key blocks. Known-secret prefixes are held during text streaming. Text/tool/widget
markup is untrusted; no raw executable HTML is accepted. **This is not credential containment**:
unknown, encoded, split-across-unrelated-fields or tool-specific values may escape heuristics, and
false positives are possible. Pi history/child credentials are not scrubbed. Ambiguous redacted
selection options must be cancelled instead of guessed. Keep the control plane private.

## Design

The module that matters is `server/PiSessions.ts`. Its interface is deliberately small:

```ts
PiSessions.open(spec)   // scoped: one Pi child for one session
session.events          // Stream<SessionEvent>: a snapshot first, then live events, until `closed`
session.act(action)     // prompt | abort | set_model | answer (a dialog)
session.state           // current SessionState without subscribing
PiSessions.probe(cwd)   // one-shot: available models and Pi's default
```

`SessionEvent` and `SessionAction` are the browser's own vocabulary, so `server/WsClient.ts` is a
pass-through. Behind the seam: command construction, strict JSONL framing, request correlation,
streaming reconstruction, dialog retention, state tracking, fan-out to any number of subscribers,
stderr capture, exit handling and orderly shutdown. The only external seam is Effect's
`ChildProcessSpawner`; `test/fake-pi.mjs` is the second adapter, and `test/PiSessions.test.ts`
exercises the module only through `open`, `events`, `act`, `state` and `probe`.

```
server/main.ts         layers and entry point
server/PiSessions.ts    the deep module above
server/SessionHosts.ts  one PiSession per (cwd, sessionId); idle release from last activity
server/Catalog.ts      model catalog from PiSessions.probe plus the enabledModels setting
server/WsClient.ts    one browser client: ClientMessage in, ServerMessage out
server/Router.ts       /ws upgrade, /api/ls, /api/projects, /api/models; static web/dist
server/SessionFiles.ts     read-only session peeking via Pi's SessionManager
server/Worktrees.ts    git worktree list / wt switch
server/Registry.ts     piano's registry: projects, worktrees and sessions (the config file)
server/PiRecords.ts    Pi record → wire translation, indexed partial assembly and execution previews
server/DisplayProjection.ts  consistent outbound display redaction (not credential containment)
server/PiEnv.ts        agent dir / session dir resolution matching the Pi CLI
shared/wire.ts         Schemas: RenderMsg, SessionEvent, SessionAction, ClientMessage, ServerMessage…
web/                   React client
```
