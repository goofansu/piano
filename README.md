# piano

Start or continue [pi](https://github.com/earendil-works/pi) sessions across your projects from a
browser. Every session is a pi session in a directory; that directory can be the project root or a
git worktree created through [worktrunk](https://worktrunk.dev) (`wt`).

Each running session is one long-lived `pi --mode rpc --session-id <id>` child. RPC was chosen over
the SDK or one process per turn because it isolates sessions from each other, keeps `abort` and
follow-up semantics, and forwards extension dialogs (`select`, `confirm`, `input`, `editor`,
`notify`) so they can be answered from the browser.

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
pi, no credentials needed). `npm run typecheck` checks server and client.

Requires a working `pi` setup (credentials in the pi agent dir) and `wt` on `PATH` for worktree
support.

## pi environment

Piano resolves pi's directories the same way the `pi` CLI does, and the spawned children inherit
the environment, so both sides see the same sessions:

| Variable                      | Effect                                                                  |
|-------------------------------|-------------------------------------------------------------------------|
| `PI_CODING_AGENT_DIR`         | pi agent dir (default `~/.pi/agent`): settings, auth, models, sessions     |
| `PI_CODING_AGENT_SESSION_DIR` | session dir; else the `sessionDir` setting; else `<agent dir>/sessions/<encoded cwd>/` |

Note pi's variable is `PI_CODING_AGENT_DIR`, not `PI_AGENT_DIR`.

Piano's own settings:

| Variable             | Default                        | Purpose                                                        |
|----------------------|--------------------------------|----------------------------------------------------------------|
| `PORT`               | `7070`                         | HTTP/WebSocket port                                            |
| `HOST`               | `127.0.0.1`                    | Bind address. There is no auth; keep it local.                 |
| `PIANO_CONFIG`       | `~/.config/piano/config.json`  | Where the selected projects are stored                         |
| `PIANO_PI_CLI`       | `node_modules/.../dist/cli.js` | pi CLI entry to spawn                                          |
| `PIANO_PI_ARGS`      | empty                          | Extra arguments for every spawned `pi`, e.g. `-e ./ext.ts`     |
| `PIANO_IDLE_MINUTES` | `5`                            | Retire a session's pi process this long after its last activity, unless a turn or dialog is pending (`0` disables) |

## Use

Piano is the source of truth for what the sidebar shows. Its registry (the config file) holds the
projects you added, the worktrees created through piano, and the sessions started through piano.
Pi's own session store is read only to load a session's history; it is never scanned to populate
the sidebar, so sessions started from the terminal do not appear here.

1. **New** is the entry point and works like Codex: a prompt box whose footer holds the
   directory (known projects and worktrees, or Browse…; the last choice is remembered), the model
   (every model pi can use, pi's default preselected, fuzzy-searchable) and the effort level. Sending the prompt registers
   the directory as a project if it is not one yet, starts pi with those settings, opens the
   session and delivers that first message. A project shows its root branch plus any worktrees
   created through piano.
2. The directory picker on the New page also offers **New worktree…**, which runs
   `wt switch --create <branch> --no-cd` in a project (hooks skipped unless ticked), registers the
   result and selects it. The project menu (…) offers **Close**, which takes the project out of the sidebar; its sessions stay in the registry and come back when the directory is used again.
3. The **+** on a project row opens New session with that directory prefilled; click an existing
   session to load its history (nothing is started).
4. The **model** picker is filled by pi itself: at startup piano runs a short-lived
   `pi --mode rpc --no-session` probe for the available models and pi's default. An existing
   session preselects the model it last used. Changing the picker on a running session switches
   immediately.
5. Sending a message starts pi for the session and registers it; the first prompt becomes the title.
   Like Codex, there is nothing to start or stop by hand: pi processes outlive browser tabs, a
   session's process is retired five minutes after its last activity, and the next message starts it
   again in about half a second from the session file. Re-selecting a session re-attaches with a full
   snapshot, including any dialog pi is still waiting on.
6. A session's menu (…) offers **Archive**, which stops pi for it and hides it. An Archived page to
   find and restore archived sessions is planned but not built yet.

## Design

The module that matters is `server/PiSessions.ts`. Its interface is deliberately small:

```ts
PiSessions.open(spec)   // scoped: one pi child for one session
session.events          // Stream<SessionEvent>: a snapshot first, then live events, until `closed`
session.act(action)     // prompt | abort | set_model | answer (a dialog)
session.state           // current SessionState without subscribing
PiSessions.probe(cwd)   // one-shot: available models and pi's default
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
server/SessionFiles.ts     read-only session peeking via pi's SessionManager
server/Worktrees.ts    wt list / wt switch
server/Registry.ts     piano's registry: projects, worktrees and sessions (the config file)
server/PiRecords.ts    pi record → wire translation, streaming partial assembly
server/PiEnv.ts        agent dir / session dir resolution matching the pi CLI
shared/wire.ts         Schemas: RenderMsg, SessionEvent, SessionAction, ClientMessage, ServerMessage…
web/                   React client
```
