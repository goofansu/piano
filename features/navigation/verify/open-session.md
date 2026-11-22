# Open and continue a session

## Driving it with agent-browser

Preconditions: a seeded launch. Run `node test/browser/open-session.mjs <evidence-directory>`
first. It includes the transcript fidelity contract from [Read and navigate a transcript](../../sessions/session-transcripts.md):
three ordinary lines stay separate while settled, streaming and reloaded, token-like text stays
original, and Copy response retains the source (clipboard observation on Linux).

- `phone-menu`
  - Action: `ab open "$WEB_URL/s/verify-plan"; ab wait --text "Answer 4.";
    ab set viewport 700 800;
    ab find role button click --name "Session information and actions" --exact;
    ab wait '[role=dialog]'`
  - Result: heading `Session`, the session ID `verify-plan` with "Copy session path" beside it,
    link `Pull request #222` and the actions above, not rail sections. Capture `05-phone-menu`.
    `ab find role button click --name "Copy session path" --exact` closes the sheet and toasts
    `Session path copied` (`ab wait --text "Session path copied"`); a headless browser that
    refuses the clipboard toasts `Could not copy the session path.` instead. Dismiss the toast and
    reopen the sheet with the same trigger. `ab find role button click --name "Move to project" --exact`
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
- `view-options-phone`
  - Action: `ab set viewport 390 844; ab find role button click --name 'Show sidebar' --exact;
    ab wait '[role=dialog]'` (omit Show sidebar if its sheet is already open). Wait for the
    sheet's animations as in `unavailable-history`, then
    `ab find role button click --name 'View options' --exact; ab wait '[role=menu]'`.
  - Result: Group by, Sort by, Show and Appearance are inline sections; Date / Folder / Project,
    Activity / Name, Folder and branch, Light / Dark / System are directly reachable.
    Capture `23-narrow-view-options`, then
    `ab find role menuitemradio click --name Project --exact;
    ab wait --fn "!document.querySelector('[role=menu]')"`. The sidebar groups by project;
    capture `24-narrow-project-groups`. Escape closes the sidebar sheet; widen to 1280×800.
    The desktop `row-details` recipe below still uses the Show submenu.
- `row-details`
  - Action: `ab find role button click --name "View options" --exact;
    ab find role menuitem click --name "Show" --exact;
    ab wait --fn "[...document.querySelectorAll('[role=menu]')].every(e => e.getAnimations({subtree:true}).every(a => a.playState !== 'running'))";
    ab find role menuitemcheckbox click --name "Folder and branch" --exact;
    ab wait --fn "!document.querySelector('[role=menu]')"`
  - Result: `ab eval "document.querySelector('nav[aria-label=Sessions]').innerText"` gives each row
    `Folder:` / `repo` / `Git branch:` / `main` under its title. Capture `05-folder-and-branch`.
- `cost` response history (after `follow-up`)
  - Action: `ab find role button click --name "Context usage" --exact;
    ab wait '[aria-label="Token and cost breakdown"]';
    ab find role radio click --name "Show cost history" --exact;
    ab click '[aria-label="Inspect response"] [role=slider]'; ab press Home`.
  - Result: "Response 1 / 2" is selected; Response cost remains `$0.0063`, Session cost `$0.0126`
    (both fake responses have the same usage). Capture `02b-response-history`, then
    `ab find role radio click --name "Show tokens history" --exact; ab press Escape`.
- `inline-question` phone (the desktop path is in `test/browser/open-session.mjs`): send `question`
  through Message, `ab wait --text "Which checks?"`, `ab set viewport 390 844`, and record
  `ab eval "({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})"`:
  both are 390; Full suite and Send answer remain reachable. Widen to 1280×800 afterwards. This short
  question does not prove long Markdown/options scrolling or a real phone's keyboard behavior.
- `queue-edit` (default browser fake, on a disposable session with an empty draft)
  - Action: `ab fill '[aria-label="Message"]' hold; ab press Enter;
    ab wait '[aria-label="Stop"]'; ab fill '[aria-label="Message"]' 'queue review';
    ab press Enter; ab wait --text 'Queued messages (1)'`. Capture `25-queued`.
    `ab set viewport 390 844;
    ab eval "document.querySelector('[aria-label=\"Edit queued message\"]').getBoundingClientRect().toJSON()"`
    records the target (at least 44px tall); capture it, then
    `ab find role button click --name 'Edit queued message' --exact`.
  - Result: `ab wait --fn "document.querySelector('[aria-label=Message]').value === 'queue review' && !document.querySelector('[aria-label=\"Queued messages\"]')"`.
    Pi is still working: Delivery remains and the primary action queues the restored draft,
    rather than showing Stop. Capture `26-restored-queue`. The audit records `clear_queue`,
    not `abort`, for Edit.
  - Finish: clear with keyboard input, `ab click '[aria-label="Message"]'; ab press Control+a;
    ab press Backspace; ab wait '[aria-label="Stop"]'; ab find role button click --name Stop --exact;
    ab wait '[aria-label="Send"]'` (Meta+a on macOS). Capture `27-stopped`, then widen to 1280×800.
    An empty `ab fill` can clear the DOM value without updating the queued-action face; use the
    keyboard sequence here.
- `archive-delete`
  - Action: `ab find role button click --name "Session menu for Loose session" --exact;
    ab find role menuitem click --name "Archive" --exact`
  - Result: toast `Session archived` (read `[data-sonner-toast]`); "Loose session" leaves
    navigation "Sessions". Capture `04-archived`. Delete is driven on the project home
    ([`project-home.md`](../../projects/verify/project-home.md) `row-actions`). Both change the database; relaunch
    afterwards.
- `unavailable-history` (alternative destructive recipe for the loose seed)
  - Preconditions: Loose session has not been continued or archived in this run. Reading saved
    history is fine; a live Pi can still supply history after its file moves. Use this recipe
    instead of the loose seed's follow-up/stop/archive steps (also covered by the harness).
  - Action: `ab open "$WEB_URL/s/verify-loose"; ab wait --text 'Answer 4.'`;
    capture `17-before-history-removal`.
    Move only this scratch fixture's history out of its history directory:
    `mv "$RUN/pi-sessions/verify-loose.jsonl" "$RUN/verify-loose.saved"; ab reload;
    ab wait --text 'History unavailable'`. Capture `18-history-unavailable`.
  - Palette: Mod+K, fill `[cmdk-input]` with `Loose session`, wait for
    `'[cmdk-list][aria-busy="false"]'`; `No sessions, projects or commands match.` appears. Capture
    `19-palette-omitted`, then Escape.
  - Phone recovery: `ab set viewport 390 844;
    ab find role button click --name 'Show sidebar' --exact; ab wait '[role=dialog]'`.
    Wait for the sidebar sheet to settle before clicking its row menu:
    `ab wait --fn "[...document.querySelectorAll('[role=dialog]')].every(e => e.getAnimations({subtree:true}).every(a => a.playState !== 'running'))"`.
    `ab find role button click --name 'Session menu for Loose session' --exact;
    ab wait '[role=menu]'`. Capture `20-recovery-menu`: Rename disabled, Archive/Delete enabled.
    `ab find role menuitem click --name Archive --exact; ab wait --text 'Session archived'`.
    Capture `21-unavailable-archived`, Escape and restore the desktop viewport.
  - This changes the scratch history and database. A missing checkout with intact history is
    different: history remains readable, as the open-session harness's Gone worktree covers.
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
- `artifacts` from codemode receipts (separate fresh session on `--fake-pi dialogs`)
  - Action: on `/new`, send `codemode-artifact verify-receipt 1 Nested report` through First
    message and Send, as above. Then `ab wait '[data-artifacts-trigger]';
    ab find role button click --name 'Artifacts: 1' --exact`.
  - Result: despite the enclosing codemode call failing after publication, the menu has the
    confirmed receipt's title `Nested report` and URL `https://radius.example.test/a/verify-receipt`.
    Capture `15-receipt-menu`; do not open this fake URL.
  - Update: Escape, wait for the menu to close, send
    `codemode-artifact verify-receipt 2 Revised nested report` through Message. Open `Artifacts: 1`
    again and `ab wait --fn "document.querySelector('[role=menuitem][href=\"https://radius.example.test/a/verify-receipt\"]')?.textContent === 'Revised nested report'"`.
    Capture `16-receipt-update`: one entry, same URL, revised title. The palette path above opens
    this same menu. This proves handling of fake Pi publication receipts, not a Radius write.
