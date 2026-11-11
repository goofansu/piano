# Session dispatch

`scripts/dispatch-session.ts` lets an orchestrator (a script or another agent) start a Piano session
from a prompt file in a folder, optionally in a new worktree, then read its status or list a
project's active sessions. It talks to Piano's `/ws` with an allowed Origin and prints JSON with a
link a person can open.

## Sub-features

- `start`: `<prompt-file> <cwd>` creates and starts a session; prints `creation`, `submission`,
  `handle.sessionId`, `link`.
- `worktree`: `--worktree BRANCH` has Piano create a worktree first and start there; the isolated
  scratch configuration uses `<repo>.<BRANCH>`. Use the returned `worktree.path`.
- `inherit-project`: `--parent-session <id>` inherits that parent's current project, even in a
  new worktree; `--no-inherit-project` starts ungrouped. Moving the parent later does not move
  existing children. An unlisted or ambiguous parent refuses inheritance before creation.
- `status`: `status <sessionId>` prints `disposition`, `needs`, `lastAnswer`, `changes`, `link`.
- `list`: `list --project <id>` prints one JSON line per active member session.
- `follow-up`: `follow-up <sessionId> <prompt-file> [--steer]` sends one more message to the
  session and prints `submission` and `link`.
- `options`: `--hooks` with `--worktree`, and an optional out-file (exit 3 when it exists). The
  session always starts on Piano's default model and effort; `--model` and `--thinkingLevel` are
  unknown options (exit 2).
- `refusals`: a missing cwd fails locally with exit 2; a refused creation prints
  `"creation":"refused"` and `"submission":"not_sent"`. No session remains and the first input
  was not sent, but startup extensions or worktree hooks may already have run. Refusal is not
  a rollback of their effects; inspect `detail` before retrying.
- `needs-input`: on `--fake-pi dialogs`, a prompt starting `ask` leaves the session waiting on a
  dialog ("Enter a value") that the web UI answers; `status` meanwhile reports
  `"disposition": "needs_input"`.

## How to get to it (user POV)

- Shell: `node scripts/dispatch-session.ts --help` from the checkout, with
  `PIANO_SESSION_WS_URL` and `PIANO_SESSION_ORIGIN` set (launch's `run.env` exports both) or
  `--ws-url` / `--origin`.
- Pi sessions inside Piano reach the same path through the `piano-dispatch` extension
  (`extensions/piano-dispatch/index.ts`).
- The printed `link` opens the session in the web UI.

## Driving it with agent-browser

Preconditions: a seeded launch, `. "$RUN/run.env"` (exports `PIANO_SESSION_WS_URL=ws://127.0.0.1:$PORT/ws`,
the backend, and `PIANO_SESSION_ORIGIN=$WEB_URL`), doctor passed; `echo "dispatch hello" > "$RUN/prompt.txt"`;
`mkdir -p "$EVIDENCE/session-dispatch"`; `ab() { .agents/skills/verify-piano/scripts/ab.sh "$RUN" "$@"; }`.

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
  - Result: once the reply finishes, exit 0; `"disposition": "settled"`, `"lastAnswer": "echo: dispatch hello"`,
    `"changes": {"branch": "verify-wt", "files": 0, "pullRequest": null}`.
- `list`
  - Command: `node scripts/dispatch-session.ts list --project verify`
  - Result: one line for `verify-plan` with `"projectId":"verify"`, `"lastAnswer":"Answer 4."`
    (from the baseline; a later prompt to it replaces that), and `changes.pullRequest.number` 222.
- `inherit-project` (additional starts, after the baseline list check)
  - Command: `node scripts/dispatch-session.ts "$RUN/prompt.txt" "$REPO" --worktree verify-child
    --parent-session verify-plan > "$EVIDENCE/session-dispatch/inherited.json"`.
    Open the returned link and wait for `echo: dispatch hello` before reading `status <id>`.
  - Result: status has `projectId: "verify"`, branch `verify-child`; `list --project verify`
    includes the child. Capture `01b-inherited`; `git -C "$REPO" worktree list` confirms placement.
  - Opt out: `node scripts/dispatch-session.ts "$RUN/prompt.txt" "$REPO" --parent-session verify-plan
    --no-inherit-project > "$EVIDENCE/session-dispatch/ungrouped.json"`; open its returned link,
    wait for the reply, then `status <id>` has `projectId: null`.
- `follow-up`
  - Command: `printf "one more" > "$RUN/more.txt"; node scripts/dispatch-session.ts follow-up <sessionId from start.json> "$RUN/more.txt"; echo $?`
  - Result: exit 0 with `"delivery": "follow-up"`, `"submission": "started"` and `link`; the
    audit gains `{"command":"prompt","text":"one more",...}` for that ID, and `status <id>` after
    the reply finishes reports `"lastAnswer": "echo: one more"`. A follow-up sends the file verbatim, so `echo`'s
    trailing newline would reach Pi (`"one more\n"`); the first message of a start arrives trimmed.
- `refusals`
  - Command: `node scripts/dispatch-session.ts "$RUN/prompt.txt" "$RUN/missing"; echo $?`
  - Result: `ENOENT: no such file or directory, stat '<path>'` and exit 2; the audit gains no
    `start`.
- Then open the worktree session's link (not the follow-up session):
  `ab open <link from worktree.json>; ab wait --text "echo: dispatch hello"`; capture
  `01-dispatched`.
- `needs-input` (separate dialogs run)
  - Preconditions: clean up the old run, launch with
    `.agents/skills/verify-piano/scripts/launch.sh --fake-pi dialogs`, assign the newly printed
    `RUN`, source its `run.env`, and run doctor on that run before dispatching.
  - Command: `echo "ask for a value" > "$RUN/ask.txt"; node scripts/dispatch-session.ts "$RUN/ask.txt" "$REPO"`,
    then `status <id>`.
  - Result: `status` reports `"disposition": "needs_input"` and `"needs": {"title": "Enter a
    value", "kind": "input", "link": "<link>"}`. `ab open <link>` shows region "Question" titled "Enter a value"
    with textbox "Enter a value" (the title, via `aria-labelledby`), "Cancel" and "Send answer".
    Capture `02-needs-input` now, before answering. Then
    `ab find role textbox fill --name "Enter a value" --exact 42;
    ab find role button click --name "Send answer" --exact` answers it: the dialog closes, the
    transcript shows `you said 42`, and `status` reports `"disposition": "settled"`. Capture
    `03-answered` after observing that reply.

## Gotchas

- `PIANO_SESSION_WS_URL` must be loopback. `run.env` points it at the backend's `/ws` (`$PORT`);
  the printed links come from `PIANO_SESSION_ORIGIN`, so they open the UI (`$WEB_URL`).
- `status`'s `changes.files` counts uncommitted files whatever comparison the Changes pane shows.
- Run it with the checkout's Node 24 (`node scripts/dispatch-session.ts`), not `npx tsx`.
- In Pi, `piano_wait_sessions` observes exact returned handles; omission of its timeout waits
  until completion or attention, while a timeout only bounds observation. There is no CLI wait
  command. CLI proof does not exercise the extension's tool row, Open session link or child's
  Dispatched from backlink; those need a real-Pi/scripted-model journey.
- Start/follow-up report submission, not completion. A status read can still say `running`;
  observe the expected reply in the browser before asserting settled status. Do not resend.
- `test/fake-pi.mjs` gives each `ask…` dialog the ID `d1`; a second ask in the same session may not
  render. Start a new session per dialog check.
- `test/fake-pi.mjs` writes no audit, so on `--fake-pi dialogs` the reply (`you said 42`) is the
  proof of what Pi received. Its `status` `lastAnswer` stays `null` after the answer.
- Worktrees from `--worktree` live beside `$REPO` inside the run dir and go with Cleanup; never
  dispatch against a real checkout.
