# Open and continue a session

## How to get to it (user POV)

- Sidebar row (grouped by date by default: "Today").
- A project home card, or Mod+K and the session's title.
- Alt+Up / Alt+Down, following the open groups in the sidebar's current order.
- Address bar: `/s/<sessionId>`, or `/m/<configured-machine>/s/<sessionId>` for a peer.
  The Machine picker requires a configured peer; a default launch lists only Local.

## Driving it with agent-browser

Preconditions: a seeded launch, `. "$RUN/run.env"`, doctor passed;
`ab() { .agents/skills/verify-piano/scripts/ab.sh "$RUN" "$@"; }`. Run the harness journey first.

- Harness
  - Command: `node test/browser/open-session.mjs "$EVIDENCE/open-session/harness"`
  - Result: exit 0 and `PASSED open-session ...` (sidebar, long-history jumps, cost, follow-up,
    inline questions, stop, streaming scroll anchoring and persistent tool disclosure).
    The Release notes fixture also proves `long-message` expansion/collapse across resize and
    `code-copy`: visible at rest at 1280, 390 and 800px, copied feedback, and code-only clipboard
    content on Linux (the clipboard-content assertion is skipped on macOS).
    It also checks `session-arrows`: rapid/cold selection, offscreen-row reveal, hidden sidebar,
    collapsed groups, boundaries, composer draft/focus restoration and menu/palette key ownership.
    Its 80-row fixture proves offscreen navigation; the two-session seed does not.
- `open-from-sidebar` and `history`
  - Action: `ab set viewport 1280 800; ab open "$WEB_URL/"; ab wait --text "Loose session";
    ab find role button click --name "Loose session" --exact; ab wait --url "**/s/verify-loose";
    ab wait --text "Answer 4."`
  - Result: `What is 2 + 2? (Loose session)` and `Answer 4.` visible; the header text reads
    `Loose session` / `Not running`. Capture `01-opened`.
- `sidebar-layout` (desktop sidebar initially visible)
  - Action: `ab press Meta+b; ab wait '[aria-label="Show sidebar"]'`; capture `12-sidebar-hidden`.
    `ab press Meta+b; ab wait '[aria-label="Hide sidebar"]'` restores the desktop column.
    `ab set viewport 700 800; ab find role button click --name "Show sidebar" --exact;
    ab wait '[role=dialog]'`; capture `13-sidebar-sheet`.
  - Result: Escape dismisses only the sheet. `ab press Escape;
    ab wait --fn "!document.querySelector('[role=dialog]')"; ab set viewport 1280 800;
    ab wait '[aria-label="Hide sidebar"]'` restores the visible column. Capture `14-sidebar-restored`.
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
- `inline-question` (after response history)
  - Action: `ab fill '[aria-label="Message"]' "question"; ab press Enter;
    ab wait --text "Which checks?"`; capture `02c-question`.
    `ab find role radio click --name "Full suite" --exact;
    ab find role button click --name "Send answer" --exact; ab wait --text "Answer: Full suite"`.
  - Result: the question closes and the answer appears. Capture `02d-answered`.
  - Phone: before answering, `ab set viewport 390 844`; capture `02e-phone-question` and record
    `ab eval "({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})"`.
    Both are 390; Full suite and Send answer remain reachable. Answer as above, capture the
    result, then widen to 1280×800. This short question does not prove long Markdown/options
    scrolling or a real phone's keyboard behavior.
- `stop`
  - Action: `ab fill '[aria-label="Message"]' "hold"; ab press Enter; ab wait '[aria-label="Stop"]';
    ab find role button click --name "Stop" --exact`
  - Result: `ab wait --fn "!document.querySelector('[aria-label=\"Stop\"]')"` passes; the audit has
    `prompt` `hold` then
    `{"command":"abort","sessionId":"verify-loose"}`. Capture `03-stopped`.
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
    keyboard sequence here. This checks text queues, not peer image or voice isolation.
- `archive-delete`
  - Action: `ab find role button click --name "Session menu for Loose session" --exact;
    ab find role menuitem click --name "Archive" --exact`
  - Result: toast `Session archived` (read `[data-sonner-toast]`); "Loose session" leaves
    navigation "Sessions". Capture `04-archived`. Delete is driven on the project home
    ([`project-home.md`](./project-home.md) `row-actions`). Both change the database; relaunch
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
- `remote` prerequisite (safe on the default launch)
  - Action: `ab open "$WEB_URL/m/not-configured/s/verify-plan";
    ab wait --text 'Machine unavailable'`; capture `22-peer-prerequisite`.
  - Result: Local recovery button, no Message composer and no fallback to the local session.
    `ab find role button click --name Local --exact` returns to Local. Report the remote
    conversation, session actions, Changes/files/rail, trust, memory, image and voice paths as
    `verified-unreachable`, naming this attempted route and the missing configured, reachable
    peer. An unknown-machine page is not a peer success check.
  - With that prerequisite available in an allowed run: Machine → peer → a session →
    Session information and actions offers Rename, Pin, project membership, Archive and Delete;
    the same peer session offers Changes and the desktop rail. Use that peer's throwaway data,
    capture before/after, and read back only its audit/files. Peer Projects routes and recipes
    are in [Projects index](./projects-index.md) and [Project home](./project-home.md).
- `machine-memory` (configured-peer prerequisite above)
  - Action: open `/m/<machine>/s/<id>`, switch to Local, reload, then Machine → that peer.
    Result: its previous session address and history return, not Local's. Repeat after a
    back/forward arrival on a different peer page; capture the arrival and switch-back.
    Starting in a peer directory and returning to its New page restores that directory;
    choosing a model there must not alter Local's choice at the same path.
  - Read-only evidence: `ab eval "({local:Object.keys(localStorage).filter(k=>k.startsWith('piano.machine.')), tab:Object.keys(sessionStorage).filter(k=>k.startsWith('piano.machine.'))})"`.
    `catalogs`, `lastDir`, `openGroups` use localStorage; `location`, `surface` use sessionStorage,
    under `piano.machine.<id>.`. Local's ID is `local`. A storage read is supporting evidence,
    not a substitute for switching. Never seed storage to make the journey pass.
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

## Gotchas

- Remote conversation, projects, session actions, Changes/files/rail, folder-trust and browser-memory
  isolation, and prepared image upload/refusal/cancellation require another Piano with its own
  database/history and a configured peer connection. Image previews are supported; managed app
  Preview remains on the peer's own Piano.
  The committed `test/browser/remote-session.mjs` covers those boundaries with main plus two
  independent peers under the [narrow run-limit exception](../SKILL.md#run-limits); run it alone
  and wait for owned cleanup. Settings and voice ownership checks run separately in
  `remote-inputs.mjs`, with the same isolated topology. The default manual launch has no peers: record that prerequisite instead of running the helper alone
  or borrowing the owner's Piano. An exe.dev peer additionally needs
  an authorized peer integration or VM-scoped token, as described in
  [Remote Pianos](../../../../docs/remote-piano.md#setup); direct exe.dev UI/link access needs a
  signed-in browser. Record the actual route attempted and the unmet prerequisite.
- Remote image thumbnails and full-image links use
  `/peer/<machine>/api/peer/image-preview?workspaceId=<id>&sessionId=<id>&hash=<hash>`;
  local image success does not prove peer scoping. Neither path carries a filesystem path.
- Opening a session can start a `probe` Pi for an uncached composer catalog; it is not a resend.
- "hold" must be the whole prompt for the fake Pi to keep running.
- Fake Pi supplies Session cost, not Session token totals (those remain `—`). After the seeded
  loose session's `second` reply, Response cost is `$0.0063` and Session cost `$0.0126`.
