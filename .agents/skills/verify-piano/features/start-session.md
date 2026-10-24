# Start a session

The New page (`/new`, or `/projects/<id>/new` inside a project) asks "What should we work on?":
the user chooses a folder, optionally a model, effort and project, types the first message and
sends it. Piano starts Pi in that folder, opens `/s/<sessionId>` and shows Pi's reply. A reload keeps
the session without sending the message again; a message that cannot be sent keeps the draft.

## Sub-features

- `choose-folder`: combobox "Directory" lists registered folders, "Browse…" and "Worktrees".
- `model-effort`: the "Model: …" button picks a model and effort, passed to Pi as `--model` and
  `--thinking`.
- `project`: the "Project" button files the new session in a project.
- `first-message`: textbox "First message" plus Enter or "Send" starts the session and lands on it.
- `reload`: reloading `/s/<id>` shows the same transcript and sends no second prompt.
- `not-sent`: when the socket is down, "Message not sent. Your draft is kept; retry when the
  session reconnects."

## How to get to it (user POV)

- The sidebar's "New session" button, or the root URL with no session open.
- A project home's "New session in project", or the sidebar's "New session in <project>".
- Address bar: `/new`, `/projects/<id>/new`.

## Driving it with agent-browser

Preconditions: a seeded launch, `. "$RUN/run.env"`, doctor passed;
`ab() { .agents/skills/verify-piano/scripts/ab.sh "$RUN" "$@"; }`. Run the harness journey first; it covers model, effort,
project and reload on its own scratch instance.

- Harness
  - Command: `node test/browser/start-session.mjs "$EVIDENCE/start-session/harness"`
  - Result: exit 0 and `PASS start-session (<s>s), evidence in <dir>` with its screenshots.
- `choose-folder`
  - Action: `ab set viewport 1280 800; ab open "$WEB_URL/new"; ab wait --text "What should we work on?";
    ab find role combobox click --name "Directory" --exact`
  - Result: listbox "Suggestions" with options `repo`, `Browse…`, `Worktrees`.
    `ab find role option click --name "repo" --exact`. Capture `01-new`.
- `first-message`
  - Action: `ab fill '[aria-label="First message"]' "hello verify"; ab press Enter;
    ab wait --text "echo: hello verify"`
  - Result: the URL becomes `/s/<uuid>`; the header text starts `hello verify` with `Working
    directory: repo`, `Git branch: main`. Capture `02-reply`.
  - Side effect: the audit has one `start` for that session ID with `--session-id <uuid>`,
    `--model fake/alpha`, `--thinking medium`, then one
    `{"command":"prompt","text":"hello verify","sessionId":"<uuid>"}`:
    `rg '"command":"(start|prompt)"' "$AUDIT" | rg -v '"probe"'`.
- `reload`
  - Action: `ab reload; ab wait --text "echo: hello verify"`
  - Result: same URL and transcript. `rg -c '"command":"prompt"' "$AUDIT"` is still 1.
- `not-sent`
  - Action: covered by the harness and unit tests; driving it by hand means stopping the scratch
    backend by its recorded PID (`server` line of `$RUN/pids`) while the page stays open, then
    sending. That ends the run; relaunch afterwards.
  - Result: the warning text above, and the draft still in the textbox.

## Gotchas

- Fake Pi writes no Pi history, so a session started on it is empty after a backend restart.
- The Directory combobox starts at "Choose a folder"; choose `repo` before typing.
- Count only non-`probe` audit entries: Piano starts a `probe` Pi for the composer's model and
  command lists.
