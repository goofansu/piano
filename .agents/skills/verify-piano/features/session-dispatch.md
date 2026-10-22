# Session dispatch

`scripts/dispatch-session.ts` lets an orchestrator (a script or another agent) start a Piano session
from a prompt file in a folder, optionally in a new worktree, then read its status or list a
project's active sessions. It talks to Piano's `/ws` with an allowed Origin and prints JSON with a
link a person can open.

## Sub-features

- `start`: `<prompt-file> <cwd>` creates and starts a session; prints `creation`, `submission`,
  `handle.sessionId`, `link`.
- `worktree`: `--worktree BRANCH` has Piano create `<repo>.<BRANCH>` first and start there.
- `status`: `status <sessionId>` prints `disposition`, `needs`, `lastAnswer`, `changes`, `link`.
- `list`: `list --project <id>` prints one JSON line per active member session.
- `refusals`: a missing cwd fails locally with exit 2; a refused creation prints
  `"creation":"refused"` and `"submission":"not_sent"`.
- `needs-input`: on `--fake-pi dialogs`, a prompt starting `ask` leaves the session waiting on a
  dialog ("Enter a value") that the web UI answers.

## How to get to it (user POV)

- Shell: `node scripts/dispatch-session.ts --help` from the checkout, with
  `PIANO_SESSION_WS_URL` and `PIANO_SESSION_ORIGIN` set (launch's `run.env` exports both) or
  `--ws-url` / `--origin`.
- Pi sessions inside Piano reach the same path through the `piano-sessions` extension
  (`extensions/piano-sessions/index.ts`).
- The printed `link` opens the session in the web UI.

## Driving it with agent-browser

Preconditions: a seeded launch, `. "$RUN/run.env"` (exports `PIANO_SESSION_WS_URL=ws://127.0.0.1:$WEB_PORT/ws`
and `PIANO_SESSION_ORIGIN=$WEB_URL`), doctor passed; `echo "dispatch hello" > "$RUN/prompt.txt"`;
`mkdir -p "$EVIDENCE/session-dispatch"`; `ab() { $S/ab.sh "$RUN" "$@"; }`.

- `start`
  - Command: `node scripts/dispatch-session.ts "$RUN/prompt.txt" "$REPO" > "$EVIDENCE/session-dispatch/start.json"; echo $?`
  - Result: exit 0; `"creation": "created"`, `"submission": "started"`, `"worktree": null`,
    `"link": "$WEB_URL/s/<uuid>"`. The audit has `prompt` `dispatch hello` for that ID.
- `worktree`
  - Command: `node scripts/dispatch-session.ts "$RUN/prompt.txt" "$REPO" --worktree verify-wt > "$EVIDENCE/session-dispatch/worktree.json"; echo $?`
  - Result: exit 0; `"worktree": {"path": "$REPO.verify-wt", "branch": "verify-wt"}` and `cwd`
    equal to that path. Side effects: `git -C "$REPO" worktree list` shows `[verify-wt]`;
    `curl -s "$API_URL/api/folders"` lists it under folder `repo`.
- `status`
  - Command: `node scripts/dispatch-session.ts status <sessionId from worktree.json>`
  - Result: exit 0; `"disposition": "settled"`, `"lastAnswer": "echo: dispatch hello"`,
    `"changes": {"branch": "verify-wt", "files": 0, "pullRequest": null}`.
- `list`
  - Command: `node scripts/dispatch-session.ts list --project verify`
  - Result: one line for `verify-plan` with `"projectId":"verify"`, `"lastAnswer":"Answer 4."`,
    and `pullRequest.number` 222.
- `refusals`
  - Command: `node scripts/dispatch-session.ts "$RUN/prompt.txt" "$RUN/missing"; echo $?`
  - Result: `ENOENT: no such file or directory, stat '<path>'` and exit 2; the audit gains no
    `start`.
- Then open the link: `ab open <link>; ab wait --text "echo: dispatch hello"`; capture
  `01-dispatched`.
- `needs-input` (relaunch with `$S/launch.sh --fake-pi dialogs`)
  - Command: `echo "ask for a value" > "$RUN/ask.txt"; node scripts/dispatch-session.ts "$RUN/ask.txt" "$REPO"`,
    then `status <id>`.
  - Result: `ab open <link>` shows the dialog "Enter a value"; `ab snapshot -i` gives the ref of
    its textbox "type" (`ab fill @<ref> 42`), then
    `ab find role button click --name "Send answer" --exact` answers it and the session goes on.

## Gotchas

- `PIANO_SESSION_WS_URL` must be loopback. `run.env` points it at the UI port's `/ws`, and the
  printed links use that port.
- Run it with the checkout's Node 24 (`node scripts/dispatch-session.ts`), not `npx tsx`.
- `test/fake-pi.mjs` gives every dialog the ID `d1`; a second dialog in the same session may not
  render. Start a new session per dialog check.
- `needs-input` was checked in earlier QA of this SHA, not in the skill's first proof run; its
  `status` `needs` field is not pinned here yet.
- Worktrees from `--worktree` live beside `$REPO` inside the run dir and go with Cleanup; never
  dispatch against a real checkout.
