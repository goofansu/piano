# Open and continue a session

A saved session opens from the sidebar, a project home or the Mod+K palette at `/s/<sessionId>`
with its Pi history, its project/title header, and its usage in the
"Context usage" popover. The user sends follow-ups in the "Message" box and stops a running reply
with "Stop". The row's "Session menu for <title>" archives or deletes it.

## Sub-features

- `open-from-sidebar`: click the session's row in navigation "Sessions".
- `history`: the saved user message and reply render; "Jump to message" lists them.
- `header`: on desktop, one line: the project crumb ("Project: <name>", only for a member session) and the
  title with "Session information and actions" beside it; at its end "Show session rail" and
  "Changes". Where the session runs is in the session rail and, when shown, the sidebar row; the
  pull request is read in Changes. The session's state is the sidebar row's; the header only
  carries it as screen-reader `role=status` text ("Ready", "Not running").
- `phone-menu`: one area at a time, the header shows folder/repository and branch below the title;
  "Session information and actions" opens the "Session" sheet. It holds the linked "Pull request
  #222", Rename, Pin, Move to project (Add to project for a loose session), Messages only,
  Archive and Delete; Preview appears only when one is known. It has no Outputs, Links,
  Environment copy menus or session ID. Escape returns focus to its trigger; widening closes it
  and narrowing again does not reopen it.
- `artifacts`: when the session has confirmed Radius publications, the header's "Artifacts: <n>"
  button lists their titles as new-tab links. Updating an artifact keeps one entry with its latest
  title. The palette's "Artifacts" opens the same menu; plain URLs are not publications.
- `row-details`: View options → Show → "Folder and branch" (off by default, remembered per
  browser; the palette's "Show folder and branch" / "Hide folder and branch") adds a line under
  each sidebar row with its folder and branch (only the branch where the group names the folder).
- `cost`: "Context usage" opens "Token and cost breakdown" with the selected response's tokens
  and cost (latest by default). "Response history" switches between tokens and cost and offers
  an "Inspect response" slider; the Session column remains the session totals.
- `follow-up`: "Message" plus Enter sends to the same Pi session (on touch, use Send; Enter is a newline).
- `compact-composer`: where the session shows one area at a time (the rail is unavailable), the
  composer card folds to one row: the pencil with "Compose", or with the draft's first line once
  Collapse composer has retained one (Edit draft). Compose opens the existing editor. Blur leaves it
  open. Its own accepted send closes an untouched empty editor, with Stop still reachable. Queues,
  image feedback and nonempty working drafts keep it expanded; newer input or interaction cancels
  pending auto-close. Side-by-side, New and project home keep the full editor.
- `stop`: "Stop" aborts a running reply.
- `nested-calls`: an opened codemode tool row lists the calls its script made, one line each
  (status dot, tool name, what it acted on) that opens to its arguments and output. More than 8
  fold to the last 8 behind "Show all <n> tool calls" (" · <k> failed" in red when any failed),
  which turns into "Show last 8 tool calls" once opened (keeping the failure suffix); a running
  call older than the last 8 stays in view, and an opened fold stays open while calls arrive. Closed, the row's header
  carries the progress instead: while running the call the script is on, and always
  "<n> calls" (" · <k> failed" in red). Drive it on
  `--fake-pi dialogs` from `/new` (its fake Pi cannot continue a seeded session): the first
  message `codemode 40 fail 2` runs one `code` call with 40 nested calls, 150ms each, then
  records them in its result.
- `archive-delete`: the row's "Session menu for <title>" ends with "Archive" and a red "Delete".
  Archiving an idle session without an owned app acts at once and toasts "Session archived"; Delete asks "Delete
  session?" (`"<title>" and its transcript are removed from Pi's session store. This cannot be
  undone.`) and toasts "Session deleted". A working session or one owning an app asks
  "Stop and archive this session?" first; deleting an app owner also warns about stopping the app.
  The same menu sits on project home rows.

## How to get to it (user POV)

- Sidebar row (grouped by date by default: "Today").
- A project home card, or Mod+K and the session's title.
- Address bar: `/s/<sessionId>`.

## Driving it with agent-browser

Preconditions: a seeded launch, `. "$RUN/run.env"`, doctor passed;
`ab() { .agents/skills/verify-piano/scripts/ab.sh "$RUN" "$@"; }`. Run the harness journey first.

- Harness
  - Command: `node test/browser/open-session.mjs "$EVIDENCE/open-session/harness"`
  - Result: exit 0 and `PASS open-session ...` (sidebar, jump, cost, follow-up, stop).
- `open-from-sidebar` and `history`
  - Action: `ab set viewport 1280 800; ab open "$WEB_URL/"; ab wait --text "Loose session";
    ab find role button click --name "Loose session" --exact; ab wait --url "**/s/verify-loose";
    ab wait --text "Answer 4."`
  - Result: `What is 2 + 2? (Loose session)` and `Answer 4.` visible; the header text reads
    `Loose session` / `Not running`. Capture `01-opened`.
- `phone-menu`
  - Action: `ab open "$WEB_URL/s/verify-plan"; ab wait --text "Answer 4.";
    ab set viewport 700 800;
    ab find role button click --name "Session information and actions" --exact;
    ab wait '[role=dialog]'`
  - Result: heading `Session`, link `Pull request #222` and the actions above, not rail sections.
    Capture `05-phone-menu`. `ab find role button click --name "Move to project" --exact`
    opens the project picker; capture `06-project-picker`, then
    `ab find role button click --name "Back" --exact` returns to actions.
    `ab find role switch click --name "Messages only" --exact` changes the switch; click it
    again to restore the default. `ab press Escape;
    ab wait --fn "!document.querySelector('[role=dialog]')"` closes the sheet;
    `ab eval "document.activeElement?.getAttribute('aria-label')"` reads
    `Session information and actions`.
  - Resize: reopen with the same trigger, then `ab set viewport 1280 800;
    ab wait --fn "!document.querySelector('[role=dialog]')"; ab set viewport 700 800;
    ab wait --fn "!document.querySelector('[role=dialog]')"`. Capture `07-menu-stays-closed`;
    `ab set viewport 1280 800; ab open "$WEB_URL/s/verify-loose"; ab wait --text "Answer 4."`
    restores desktop and the session for the following steps. This is viewport emulation, not
    real-phone proof.
- `compact-composer`
  - Action: `ab open "$WEB_URL/s/verify-loose"; ab wait --text "Answer 4.";
    ab set viewport 390 844; ab find role button click --name Compose --exact;
    ab fill '[aria-label="Message"]' 'Retain this draft';
    ab find role button click --name 'Collapse composer' --exact`.
  - Result: the folded card shows `Retain this draft` beside the pencil (Edit draft); capture
    `10-draft-closed`. Press Space to reopen the
    retained draft, then click the transcript: the editor stays open. Capture `11-draft-opened`.
    Fill Message with `hold`, click Send, wait for Compose and Stop; capture `12-send-collapsed`.
    Click Stop and wait for no Stop button; capture `13-collapsed-stop`. This is browser emulation,
    not a physical keyboard check. Set viewport 1280×800 to restore the always-expanded layout.
- `row-details`
  - Action: `ab find role button click --name "View options" --exact;
    ab find role menuitem click --name "Show" --exact;
    ab wait --fn "[...document.querySelectorAll('[role=menu]')].every(e => e.getAnimations({subtree:true}).every(a => a.playState !== 'running'))";
    ab find role menuitemcheckbox click --name "Folder and branch" --exact;
    ab wait --fn "!document.querySelector('[role=menu]')"`
  - Result: `ab eval "document.querySelector('nav[aria-label=Sessions]').innerText"` gives each row
    `Folder:` / `repo` / `Git branch:` / `main` under its title. Capture `05-folder-and-branch`.
- `cost`
  - Action: `ab find role button click --name "Context usage" --exact;
    ab wait '[aria-label="Token and cost breakdown"]'`
  - Result: `ab eval "document.querySelector('[aria-label=\"Token and cost breakdown\"]').innerText"`
    shows Input `1,200`, Output `300`, Total tokens `1,500`, Cost `$0.0063` in the Response column.
    Capture `02-cost`; `ab press Escape`.
- `follow-up`
  - Action: `ab fill '[aria-label="Message"]' "second"; ab press Enter; ab wait --text "echo: second"`
  - Result: the reply renders; the audit has `{"command":"prompt","text":"second","sessionId":"verify-loose"}`.
- `cost` response history (after `follow-up`)
  - Action: `ab find role button click --name "Context usage" --exact;
    ab wait '[aria-label="Token and cost breakdown"]';
    ab find role radio click --name "Show cost history" --exact;
    ab click '[aria-label="Inspect response"] [role=slider]'; ab press Home`.
  - Result: "Response 1 / 2" is selected; Response cost remains `$0.0063`, Session cost `$0.0126`
    (both fake responses have the same usage). Capture `02b-response-history`, then
    `ab find role radio click --name "Show tokens history" --exact; ab press Escape`.
- `stop`
  - Action: `ab fill '[aria-label="Message"]' "hold"; ab press Enter; ab wait '[aria-label="Stop"]';
    ab find role button click --name "Stop" --exact`
  - Result: `ab wait --fn "!document.querySelector('[aria-label=\"Stop\"]')"` passes; the audit has
    `prompt` `hold` then
    `{"command":"abort","sessionId":"verify-loose"}`. Capture `03-stopped`.
- `archive-delete`
  - Action: `ab find role button click --name "Session menu for Loose session" --exact;
    ab find role menuitem click --name "Archive" --exact`
  - Result: toast `Session archived` (read `[data-sonner-toast]`); "Loose session" leaves
    navigation "Sessions". Capture `04-archived`. Delete is driven on the project home
    ([`project-home.md`](./project-home.md) `row-actions`). Both change the database; relaunch
    afterwards.
- `artifacts` (separate `--fake-pi dialogs` launch, from `/new`)
  - Action: `ab open "$WEB_URL/new"; ab wait --text "What should we work on?";
    ab fill '[aria-label="First message"]' 'artifact verify confirmed Verification report';
    ab wait --fn "!document.querySelector('[aria-label=Send]').disabled"; ab click '[aria-label=Send]';
    ab wait '[data-artifacts-trigger]'; ab find role button click --name 'Artifacts: 1' --exact`
  - Result: menuitem `Verification report`, `href=https://radius.example.test/a/verify`,
    `target=_blank`. Capture `08-artifact-menu`; inspect the link with
    `ab eval "document.querySelector('[role=menuitem]')?.getAttribute('href')"` rather than opening
    this fake URL. `ab press Escape; ab wait --fn "!document.querySelector('[role=menu]')"`.
  - Update: `ab fill '[aria-label="Message"]' 'artifact verify confirmed Revised report';
    ab press Enter; ab wait --fn "!document.querySelector('[aria-label=Stop]')";
    ab find role button click --name 'Artifacts: 1' --exact`.
    Then `ab wait --fn "document.querySelector('[role=menuitem][href=\"https://radius.example.test/a/verify\"]')?.textContent === 'Revised report'"`.
    The same URL now has title `Revised report`, still one entry. Waiting for page text alone
    would also match the submitted prompt. Capture `09-artifact-update`.
    Escape, then Mod+K → query `artifacts` → wait for the palette to settle → "Artifacts"
    opens the same menu. This proves rendering of fake confirmed tool results, not Radius
    publication or authenticated access.

## Gotchas

- Opening a session can start a `probe` Pi for an uncached composer catalog; it is not a resend.
- "hold" must be the whole prompt for the fake Pi to keep running.
- Fake Pi supplies Session cost, not Session token totals (those remain `—`). After the seeded
  loose session's `second` reply, Response cost is `$0.0063` and Session cost `$0.0126`.
