# piano

Start or continue [pi](https://github.com/earendil-works/pi) threads across your projects from a
browser. Every thread is a pi session in a directory; that directory can be the project root or a
git worktree created through [worktrunk](https://worktrunk.dev) (`wt`).

Each running thread is one long-lived `pi --mode rpc --session-id <id>` child. RPC was chosen over
the SDK or one process per turn because it isolates threads from each other, keeps `abort` and
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
| `PIANO_IDLE_MINUTES` | `30`                           | Release a thread's pi after this long with no browser attached and nothing running (`0` disables) |

## Use

1. **Add project…** opens a folder picker that browses the server's filesystem (git repos are
   flagged). Git repos list their worktrees via `wt list`.
2. The branch button on a project runs `wt switch --create <branch> --no-cd`. Hooks are skipped
   unless the `hooks` box is ticked.
3. Pick **new thread** under a worktree, or click an existing thread to load its history (read
   from the session file; nothing is started).
4. The **model** picker is filled by pi itself: at startup piano runs a short-lived
   `pi --mode rpc --no-session` probe for the available models and pi's default. Models matching
   the `enabledModels` setting are listed first; an existing thread preselects the model it last
   used. Changing the picker on a running thread switches immediately.
5. Sending a message starts pi for the thread; **Start** starts it without a prompt. **Release**
   stops pi and keeps the session file. pi processes outlive browser tabs; re-selecting a thread
   re-attaches with a full snapshot, including any dialog pi is still waiting on.

## Design

The module that matters is `server/PiThreads.ts`. Its interface is deliberately small:

```ts
PiThreads.open(spec)   // scoped: one pi child for one thread
thread.events          // Stream<ThreadEvent>: a snapshot first, then live events, until `closed`
thread.act(action)     // prompt | abort | set_model | answer (a dialog)
thread.state           // current ThreadState without subscribing
PiThreads.probe(cwd)   // one-shot: available models and pi's default
```

`ThreadEvent` and `ThreadAction` are the browser's own vocabulary, so `server/WsSession.ts` is a
pass-through. Behind the seam: command construction, strict JSONL framing, request correlation,
streaming reconstruction, dialog retention, state tracking, fan-out to any number of subscribers,
stderr capture, exit handling and orderly shutdown. The only external seam is Effect's
`ChildProcessSpawner`; `test/fake-pi.mjs` is the second adapter, and `test/PiThreads.test.ts`
exercises the module only through `open`, `events`, `act`, `state` and `probe`.

```
server/main.ts         layers and entry point
server/PiThreads.ts    the deep module above
server/ThreadHosts.ts  one PiThread per (cwd, sessionId); attach counting; idle release
server/Catalog.ts      model catalog from PiThreads.probe plus the enabledModels setting
server/WsSession.ts    one browser client: ClientMessage in, ServerMessage out
server/Router.ts       /ws upgrade, /api/ls, /api/projects, /api/models; static web/dist
server/Sessions.ts     session listing and read-only peeking via pi's SessionManager
server/Worktrees.ts    wt list / wt switch
server/Projects.ts     the project list file
server/PiRecords.ts    pi record → wire translation, streaming partial assembly
server/PiEnv.ts        agent dir / session dir resolution matching the pi CLI
shared/wire.ts         Schemas: RenderMsg, ThreadEvent, ThreadAction, ClientMessage, ServerMessage…
web/                   React client
```
