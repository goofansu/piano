# piano

Start or continue [pi](https://github.com/earendil-works/pi) threads across your projects from a
browser. Every thread is a pi session in a directory; that directory can be the project root or a
git worktree created through [worktrunk](https://worktrunk.dev) (`wt`).

Each running thread is one long-lived `pi --mode rpc --session-id <id>` child, driven over JSONL by
pi's `RpcClient`. That mode was chosen because it isolates threads from each other, keeps `abort`,
`steer`, and `follow_up` semantics, and forwards extension dialogs (`select`, `confirm`, `input`,
`editor`, `notify`) so they can be answered from the browser.

## Run

```bash
npm install
npm start            # http://127.0.0.1:7070
```

Requires Node 24 (TypeScript runs directly via type stripping), a working `pi` setup, and `wt` on
`PATH` for worktree support.

## pi environment

Piano resolves pi's directories the same way the `pi` CLI does, and the spawned `pi` children
inherit the environment, so both sides see the same sessions:

| Variable                       | Effect                                                              |
|--------------------------------|---------------------------------------------------------------------|
| `PI_CODING_AGENT_DIR`          | pi agent dir (default `~/.pi/agent`): settings, auth, models, sessions |
| `PI_CODING_AGENT_SESSION_DIR`  | session storage dir; else the `sessionDir` setting; else `<agent dir>/sessions/<encoded cwd>/` |

Note pi's variable is `PI_CODING_AGENT_DIR`, not `PI_AGENT_DIR`.

Piano's own settings:

| Variable             | Default                         | Purpose                                            |
|----------------------|---------------------------------|----------------------------------------------------|
| `PORT`               | `7070`                          | HTTP/WebSocket port                                |
| `HOST`               | `127.0.0.1`                     | Bind address. There is no auth; keep it local.     |
| `PIANO_CONFIG`       | `~/.config/piano/config.json`   | Where the selected projects are stored             |
| `PIANO_PI_CLI`       | `node_modules/.../dist/cli.js`  | pi CLI entry to spawn                              |
| `PIANO_PI_ARGS`      | empty                           | Extra arguments for every spawned `pi`, e.g. `-e ./ext.ts --thinking high` |
| `PIANO_IDLE_MINUTES` | `30`                            | Release a thread's pi process after this long with no browser attached and nothing running (`0` disables) |

## Use

1. **Add project…** opens a folder picker that browses the server's filesystem (git repos are
   flagged). Git repos list their worktrees via `wt list`.
2. **+ worktree** on a project runs `wt switch --create <branch> --no-cd`. Hooks are skipped unless
   the `hooks` box is ticked.
3. Pick **+ new thread** under a worktree, or click an existing thread to load its history
   (read directly from the session file, nothing is started).
4. The **model** picker is filled from pi itself: at startup piano runs a short-lived
   `pi --mode rpc --no-session` probe and asks it for the available models and the model pi would
   pick by default. Models matching the `enabledModels` setting are listed first; pi's default is
   preselected. An existing thread preselects the model it last used. Changing the picker on a
   running thread switches the model immediately (`set_model`).
5. Sending a message starts pi for the thread; **Start** starts it without a prompt. **Release**
   stops pi and keeps the session file. pi processes outlive browser tabs; re-selecting a thread
   re-attaches with a full sync, including any dialog pi is still waiting on.

## Layout

```
src/server.ts        HTTP + WebSocket, ThreadHost registry, idle release, folder listing
src/runner.ts        RpcRunner: one `pi --mode rpc` child per thread, dialogs in and out
src/models.ts        model catalog probe (available models + pi's default)
src/pi-env.ts        agent dir / session dir resolution matching the pi CLI
src/wire.ts          RenderMsg/WireEvent shapes and EventBridge (pi events → browser events)
src/threads.ts       session listing/peeking via SessionManager
src/worktrees.ts     wt list / wt switch wrappers
public/index.html    UI, adapted from pi-remote-control
```

## WebSocket protocol

Client → server: `projects`, `models`, `add_project {path}`, `remove_project {path}`,
`create_worktree {project, branch, hooks}`, `select {cwd, sessionId|null}`,
`start {model?, name?}`, `prompt {text, start?}`, `set_model {model}`,
`ui_response {id, value?|confirmed?|cancelled?}`, `stop`, `release`.

Server → client: `projects`, `hosts`, `models`, `sync`, `message_update`, `message_end`,
`tool_start`, `tool_end`, `agent_start`, `agent_end`, `ui_request`, `ui_resolved`, `error`, `toast`.
