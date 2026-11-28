# Start a session

## Driving it with agent-browser

Preconditions: a fresh seeded launch with the default browser fake. Run
`node test/browser/start-session.mjs <evidence-directory>` first; it uses its own folders and
models, not the seed's.

- `choose-folder`: after picking in combobox "Directory", wait for the picker to close before using
  another control: `ab wait --fn "!document.querySelector('[aria-label=\"Choose a directory\"]')"`.
- `directory-trust` (scratch resources only)
  - Preconditions: put a harmless skill at `$REPO/.agents/skills/demo/SKILL.md` before opening
    New: front matter `name: demo`, `description: Verification fixture.`, body `Reply briefly.`.
    Reload `/new` to obtain a fresh catalog if the directory was already visited. This creates
    a scratch input fixture, not a trust decision or a claim that fake Pi loaded the skill.
  - Action: `ab open "$WEB_URL/new"; ab wait '[aria-label="Directory trust"]'`;
    capture `14-untrusted`, then `ab find role button click --name 'Directory trust' --exact;
    ab wait --fn "document.querySelector('[aria-label=\"Directory trust\"]').getAttribute('aria-pressed') === 'true'"`.
  - Result: Trusted replaces Untrusted. Capture `15-trusted`; click again and wait for
    `aria-pressed=false` to return to Untrusted. The seed without resources need not show this
    control.
- `model-defaults` (before sending, with the seed's default browser fake)
  - Action: `ab click '[aria-label^="Model:"]'; ab wait '[aria-label="Model and effort"]';
    ab find role option click --name "fake/gamma" --exact`;
    capture `01b-model-choice`, then `ab find role button click --name "Use default" --exact`.
  - Result: the trigger returns to `Model: fake/alpha; effort: medium`; the picker remains open,
    Use default is disabled and Default replaces Make default. Capture `01c-default`, then
    `ab press Escape`. This checks restoring the choice, not saving a new default.
- `project` Done destinations (seeded run, before changing Empty Project)
  - Action: `ab open "$WEB_URL/projects"; ab wait --text 'Empty Project';
    ab click 'main [aria-label="Project menu for Empty Project"]';
    ab find role menuitem click --name 'Mark project done' --exact;
    ab wait --fn "!document.querySelector('[role=menu]')";
    ab open "$WEB_URL/new"; ab wait --text 'What should we work on?';
    ab find role button click --name Project --exact; ab wait '[role=menu]'`.
  - Result: `ab wait --fn "!document.querySelector('[role=menu]').textContent.includes('Empty Project')"`;
    Verify Project remains offered. Capture `17-done-destination`, then Escape. On
    `/s/verify-plan`, Session information and actions → Move to project likewise omits Empty
    Project; capture that menu separately. Reopen Empty Project through its home menu before
    continuing recipes that need it active. Its Done home remains reachable from Projects → Done.
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
  - Action: `ab upload 'input[aria-label="Attachment files"]' "$RUN/pixel.png";
    ab wait '[aria-label="Remove pixel.png"]'`; capture `09-image-draft`.
    Send with a unique message (or as the `failed-start` input above).
  - Result: after the reply,
    `ab wait --fn "[...document.querySelectorAll('img[alt=\"Attachment preview\"]')].some(i => i.complete && i.naturalWidth > 0)"`.
    Capture `10-image-sent`; the local full-image link and thumbnail use the same
    `/api/image-previews/<hash>` address, with `target=_blank` on the link. Reload and repeat
    the image wait: the audit still has one prompt, with one image's MIME type, byte count and hash.
  - Refusal/removal: upload the PNG again, then
    `ab upload 'input[aria-label="Attachment files"]' "$RUN/invalid.txt";
    ab wait --text "use PNG, JPEG, GIF, WebP, or DWG."`. The PNG remains; capture `11-image-refusal`.
    `ab find role button click --name 'Remove pixel.png' --exact` removes it.
- `drawings` (covered by `test/browser/start-session.mjs`)
  - Upload a DWG with **Attach files**. Its name and DWG label appear without an image preview.
  - Send the drawing without text. The audit records a local path, not an image payload. Read the
    file at that path and compare its bytes to the upload.
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
    warning is separately protected by `test/integration/sessions/composer/DraftSubmission.test.ts`.

## Gotchas

- The one-folder seed does not prove fallback from a missing remembered root to another folder,
  or a project home's fallback to an older member's usable folder. Those branches need multiple
  registered scratch folders and removal of only a run-owned root. `test/Client.test.ts` covers
  the selection rule; report that as module evidence, not a live missing-folder journey.
