# Start a session

The New page asks "What should we work on?" at `/new` and `/projects/<id>/new` on desktop
(the heading is hidden on narrow screens); the latter preselects the project. The user chooses a folder, optionally a model, effort and project, types
the first message and sends it. Piano starts Pi in that folder, opens `/s/<sessionId>` and shows Pi's reply. A reload keeps
the session without sending the message again; a message that cannot be sent keeps the draft.

## Sub-features

- `choose-folder`: combobox "Directory" lists registered folders and "Browse…", plus "Worktrees"
  for a registered checkout. `/new` defaults to the last-used directory, otherwise the first
  registered folder; a fresh `/projects/<id>/new` needs a directory choice.
- `model-effort`: the "Model: <model>; effort: <level>" button picks a model and effort, passed to
  Pi as `--model` and `--thinking`.
- `model-defaults`: the model picker shows New sessions' default, Refresh models, Use default
  and Make default / Default. Use default restores the current choice without saving a new default.
- `project`: the "Project" button lists "New project" and the projects, filing the new session
  in the one chosen ("No project" clears a choice).
- `first-message`: combobox "First message" plus "Send" starts the session and lands on it.
  Desktop Enter sends; on a coarse-pointer device Enter inserts a newline.
- `reload`: reloading `/s/<id>` shows the same transcript and sends no second prompt.
- `draft-navigation`: leaving New for Projects and returning through New session keeps the
  unsent draft within the page load; a full reload is not draft persistence.
- `failed-start`: a conclusively failed startup returns to New with "Could not start session",
  Retry and Dismiss, keeping the message, images, model and effort. Retry is explicit; an
  uncertain start must be reconciled, not submitted again as a new session.
- `images`: Attach images (file input "Image files"), paste or drop adds image tiles; Remove
  <name> removes one. An unsupported file shows "Other files aren't supported yet." without
  losing accepted images. Sent thumbnails link to "Open attached image" in a new tab.
- `not-sent`: when the socket is down, Send is disabled and Enter keeps the draft without
  creating a session. A send refused at the delivery boundary can instead show "Message not
  sent. Your draft is kept; retry when the session reconnects."; disconnecting first does not
  exercise that race.

## How to get to it (user POV)

- The sidebar's "New session" button, or the root URL with no session open.
- A project home's composer ("First message" above its Sessions), or, with the sidebar grouped by
  project, the group's "New session in <project>".
- Address bar: `/new`, `/projects/<id>/new`. The project-name heading belongs to the project
  home at `/projects/<id>`, not its New page.

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
    Capture `01-new`, then wait for the directory picker to close before using another control:
    `ab wait --fn "!document.querySelector('[aria-label=\"Choose a directory\"]')"`.
- `model-defaults` (before sending, with the seed's default browser fake)
  - Action: `ab click '[aria-label^="Model:"]'; ab wait '[aria-label="Model and effort"]';
    ab find role option click --name "fake/gamma" --exact`;
    capture `01b-model-choice`, then `ab find role button click --name "Use default" --exact`.
  - Result: the trigger returns to `Model: fake/alpha; effort: medium`; the picker remains open,
    Use default is disabled and Default replaces Make default. Capture `01c-default`, then
    `ab press Escape`. This checks restoring the choice, not saving a new default.
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
- `draft-navigation` (before sending)
  - Action: `ab open "$WEB_URL/new"; ab wait --text 'What should we work on?';
    ab fill '[aria-label="First message"]' 'retained draft';
    ab find role button click --name Projects --exact; ab wait --url '**/projects';
    ab find role button click --name 'New session' --exact`.
  - Result: `ab wait --fn "document.querySelector('[aria-label=\"First message\"]')?.value === 'retained draft'"`
    passes. Capture `05-retained-draft`, then clear or replace the draft.
- `failed-start` (opt-in fixture on the same browser-fake launch)
  - Preconditions: before Launch, set
    `export PIANO_TEST_STARTUP_FAILURE="$EVIDENCE/startup-failure"`, where `EVIDENCE` is an
    existing run-notes directory outside the scratch run. Leave that marker absent until this
    check; save its path as `FAIL_MARKER=$PIANO_TEST_STARTUP_FAILURE` before sourcing `run.env`.
    The browser fake refuses new-session startup while the marker exists, but not catalog probes
    or saved sessions. This is a process-boundary fixture, not a real Pi startup failure.
  - Action: `touch "$FAIL_MARKER"; ab open "$WEB_URL/new";
    ab wait --text 'What should we work on?'; ab click '[aria-label^="Model:"]';
    ab find role option click --name fake/gamma --exact;
    ab find role radio click --name high --exact; ab press Escape;
    ab fill '[aria-label="First message"]' 'recover this start'`.
    Optionally attach the PNG from `images` below, then
    `ab wait --fn "!document.querySelector('[aria-label=Send]').disabled"`;
    capture `06-before-failed-start`, and `ab click '[aria-label=Send]'`.
  - Result: `ab wait --text 'Could not start session'` and
    `ab wait --fn "document.querySelector('[aria-label=\"First message\"]')?.value === 'recover this start'"`;
    `ab wait '[aria-label="Model: fake/gamma; effort: high"]'` confirms the choice was restored.
    Any attached image remains. Capture `07-restored`; no `prompt` with this text reached Pi.
  - Retry: `rm "$FAIL_MARKER"; ab find role button click --name Retry --exact;
    ab wait --text 'echo: recover this start'`. Capture `08-retried`; the audit has exactly one
    `prompt` with this text, including its image when supplied. Remove the marker even if a
    check fails. This proves confirmed rejection, not the connection-loss reconciliation path.
  - Dismiss (a second rejected start with a distinct message):
    `ab find role button click --name Dismiss --exact` clears the banner, not the restored draft.
    Capture both states and remove the marker; Dismiss is not a retry.
- `images` (local New or an existing session's Message composer)
  - Preconditions: a small valid PNG at `$RUN/pixel.png` and a text file at `$RUN/invalid.txt`.
    For example, use a screenshot already captured by this run as the PNG; no private image.
  - Action: `ab upload 'input[aria-label="Image files"]' "$RUN/pixel.png";
    ab wait '[aria-label="Remove pixel.png"]'`; capture `09-image-draft`.
    Send with a unique message (or as the `failed-start` input above).
  - Result: after the reply,
    `ab wait --fn "[...document.querySelectorAll('img[alt=\"Attachment preview\"]')].some(i => i.complete && i.naturalWidth > 0)"`.
    Capture `10-image-sent`; the local full-image link and thumbnail use the same
    `/api/image-previews/<hash>` address, with `target=_blank` on the link. Reload and repeat
    the image wait: the audit still has one prompt, with one image's MIME type, byte count and hash.
  - Refusal/removal: upload the PNG again, then
    `ab upload 'input[aria-label="Image files"]' "$RUN/invalid.txt";
    ab wait --text "Other files aren't supported yet."`. The PNG remains; capture `11-image-refusal`.
    `ab find role button click --name 'Remove pixel.png' --exact` removes it. This local recipe
    does not prove peer image preparation, cancellation or isolation; see
    [Open a session](./open-session.md#gotchas).
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
- The Directory combobox reads "Directory" when no folder is chosen yet (an `--empty`
  launch, an empty project's home); on the seed it already reads `repo`.
- Count only non-`probe` audit entries: Piano starts a `probe` Pi for the composer's model and
  command lists.
