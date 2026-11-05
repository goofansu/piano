# Start a session

The New page asks "What should we work on?" at `/new`, or shows the project name at
`/projects/<id>/new`. The user chooses a folder, optionally a model, effort and project, types
the first message and sends it. Piano starts Pi in that folder, opens `/s/<sessionId>` and shows Pi's reply. A reload keeps
the session without sending the message again; a message that cannot be sent keeps the draft.

## Sub-features

- `choose-folder`: combobox "Directory" lists registered folders and "Browse…", plus "Worktrees"
  for a registered checkout. `/new` defaults to the last-used directory, otherwise the first
  registered folder; a fresh `/projects/<id>/new` needs a directory choice.
- `model-effort`: the "Model: <model>; effort: <level>" button picks a model and effort, passed to
  Pi as `--model` and `--thinking`.
- `project`: the "Project" button lists "New project…" and the projects, filing the new session
  in the one chosen ("None" clears a choice).
- `first-message`: combobox "First message" plus "Send" starts the session and lands on it.
  Desktop Enter sends; on a coarse-pointer device Enter inserts a newline.
- `reload`: reloading `/s/<id>` shows the same transcript and sends no second prompt.
- `not-sent`: when the socket is down, Send is disabled and Enter keeps the draft without
  creating a session. A send refused at the delivery boundary can instead show "Message not
  sent. Your draft is kept; retry when the session reconnects."; disconnecting first does not
  exercise that race.

## How to get to it (user POV)

- The sidebar's "New session" button, or the root URL with no session open.
- A project home's composer ("First message" above its Sessions), or, with the sidebar grouped by
  project, the group's "New session in <project>".
- Address bar: `/new`, `/projects/<id>/new` (its `h1` is the project's name, not "What should we
  work on?").

## Driving it with agent-browser

Preconditions: a fresh seeded launch with the default browser fake, `. "$RUN/run.env"`, doctor passed;
`ab() { .agents/skills/verify-piano/scripts/ab.sh "$RUN" "$@"; }`. Run the harness journey first; it covers model, effort,
project and reload on its own scratch instance, with its own folders and models (not the seed's).

- Harness
  - Command: `node test/browser/start-session.mjs "$EVIDENCE/start-session/harness"`
  - Result: exit 0 and `PASS start-session (<s>s), evidence in <dir>` with its screenshots.
- `choose-folder`
  - Action: `ab set viewport 1280 800; ab open "$WEB_URL/new"; ab wait --text "What should we work on?";
    ab find role combobox click --name "Directory" --exact`
  - Result: the combobox already reads `repo`; listbox "Suggestions" with options `repo`
    (selected), `Browse…`, `Worktrees`. `ab find role option click --name "repo" --exact`.
    Capture `01-new`.
- `first-message`
  - Action: `ab fill '[aria-label="First message"]' "hello verify";
    ab wait --fn "!document.querySelector('[aria-label=Send]').disabled"; ab press Enter;
    ab wait --text "echo: hello verify"`
  - Result: the URL becomes `/s/<uuid>`; the visible header title is `hello verify`, with
    screen-reader `role=status` text `Ready`.
    Capture `02-reply`.
  - Side effect: the audit has one `start` for that session ID with `--session-id <uuid>`,
    `--model fake/alpha`, `--thinking medium`, `"cwd": "$REPO"` (the chosen folder), and the run's
    `--prompt-template` / `--skill` dirs under `$RUN/db/`, then one
    `{"command":"prompt","text":"hello verify","sessionId":"<uuid>"}`:
    `rg '"command":"(start|prompt)"' "$AUDIT" | rg -v '"probe"'`.
- `reload`
  - Action: `ab reload; ab wait --text "echo: hello verify"`
  - Result: same URL and transcript. `rg -c '"command":"prompt"' "$AUDIT"` is still 1.
- `not-sent` (last drive before Cleanup; ends this run)
  - Action: `ab open "$WEB_URL/new"; ab wait --text "What should we work on?";
    ab fill '[aria-label="First message"]' "keep this draft";
    ab wait --fn "!document.querySelector('[aria-label=Send]').disabled"`.
    Capture `03-connected-draft`. Stop only this scratch backend after checking its identity:
    `. .agents/skills/verify-piano/scripts/lib.sh; read -r role pid started cwd < "$RUN/pids";
    test "$role" = server && test "$(starttime "$pid")" = "$started" &&
    test "$(process_cwd "$pid")" = "$ROOT" && kill -TERM "$pid"`.
    Then `ab wait --fn "document.querySelector('[aria-label=Send]').disabled"; ab press Enter`.
  - Result: Send stays disabled; `ab get value '[aria-label="First message"]'` is
    `keep this draft`, still on `/new`, and the audit has no prompt with that text.
    Capture `04-disconnected-draft`, then Cleanup. No warning is required for an already-disabled
    send. The browser harness covers successful send/reload, not this case; the delivery-race
    warning is separately protected by `test/DraftSubmission.test.ts`.

## Gotchas

- Fake Pi writes no Pi history, so a session started on it is empty after a backend restart.
- The Directory combobox reads "Choose a folder" only when no folder is chosen yet (an `--empty`
  launch, an empty project's home); on the seed it already reads `repo`.
- Count only non-`probe` audit entries: Piano starts a `probe` Pi for the composer's model and
  command lists.
