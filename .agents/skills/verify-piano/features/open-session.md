# Open and continue a session

A saved session opens from the sidebar, a project home or the Mod+K palette at `/s/<sessionId>`
with its Pi history, its project/title header, and its usage in the
"Context usage" popover. The user sends follow-ups in the "Message" box and stops a running reply
with "Stop". The row's "Session menu for <title>" archives or deletes it.

## Sub-features

- `open-from-sidebar`: click the session's row in navigation "Sessions".
- `sidebar-layout`: Hide sidebar / Show sidebar, the palette's Hide sidebar / Show sidebar row and Cmd+B toggle
  the sidebar. Cmd+B is `Meta+b` even on Linux, not Control+B. A narrow viewport uses a sheet;
  opening or dismissing that sheet preserves the desktop column preference on widening.
- `history`: the saved user message and reply render; "Jump to message" lists them.
- `header`: on desktop, one line: the project crumb ("Project: <name>", only for a member session) and the
  title with "Session information and actions" beside it; at its end "Changes" / "Hide changes" then
  "Show session rail" / "Hide session rail". An observed app URL adds "Open preview in new tab" in every layout.
  Where the session runs is in the session rail and, when shown, the sidebar row; the
  pull request is read in Changes. The session's state is the sidebar row's; the header only
  carries it as screen-reader `role=status` text ("Ready", "Not running").
- `phone-menu`: one area at a time, the header shows folder and branch (or a ten-character detached commit) below the title;
  "Session information and actions" opens the "Session" sheet. It holds the linked "Pull request
  #222", Rename, Pin, Move to project (Add to project for a loose session), Messages only,
  Archive and Delete. Preview appears only when one is known and pushes a pane in the same sheet:
  Back, status/hostname, Open preview in new tab (dismisses the sheet), Preview details and Stop
  preview (confirmation). The app is never embedded. This also applies on wide viewports when the
  measured session area is too narrow for side-by-side. It has no Outputs, Links,
  Environment copy menus or session ID. Escape returns focus to its trigger; widening closes it
  and narrowing again does not reopen it.
- `artifacts`: when the session has confirmed Radius publications, the header's "Artifacts: <n>"
  button lists their titles as new-tab links. Updating an artifact keeps one entry with its latest
  title. The palette's "Artifacts" opens the same menu; plain URLs are not publications.
- `view-options-phone`: on a narrow viewport, View options is one scrollable menu with inline
  Group by, Sort by, Show and Appearance sections; there are no side-opening submenus.
  Desktop keeps the submenus. These choices belong to the browser, across machines.
- `row-details`: View options → Show → "Folder and branch" (off by default, remembered per
  browser; the palette's "Show folder and branch" / "Hide folder and branch") adds a line under
  each sidebar row with its folder and branch (only the branch where the group names the folder).
- `cost`: "Context usage" opens "Token and cost breakdown" with the selected response's tokens
  and cost (latest by default). "Response history" switches between tokens and cost and offers
  an "Inspect response" slider; the Session column remains the session totals.
- `inline-question`: the browser fake's `question` prompt shows Which checks?, Quick checks /
  Full suite and Send answer; the answer appears in the transcript.
- `unavailable-history`: a missing Pi history disables the sidebar and project-home title,
  omits the session from palette results, and makes `/s/<id>` show "History unavailable" /
  "Restore the Pi session file to open it." The disabled sidebar row keeps its recovery menu
  on phones too: Rename is disabled, but Archive and Delete remain available while connected.
- `remote`: a configured Machine opens its own catalog and `/m/<machine>/s/<id>` conversation.
  It offers its Projects index/home and project CRUD, session Rename / Pin / project membership /
  Archive / Delete, Changes (including pull requests), files and the desktop session rail.
  Remote New uses that machine's open registered folders/worktrees, with Directory trust where
  needed, but no Browse… or worktree creation. Settings, folder management and managed Preview
  stay on the remote's own Piano; a peer's transcript link is not a locally managed app.
- `machine-memory`: switching machines restores each one's last page, also after reload and
  back/forward navigation. Model catalogs, last-used directory and open sidebar groups are
  remembered per machine; page location and Surface tabs belong to this browser tab. Drafts
  and question replies last only for the page load. Removed machine IDs are forgotten on load.
- `follow-up`: "Message" plus Enter sends to the same Pi session. Image controls are shared
  with New; see [Start a session](./start-session.md) `images`.
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
- Address bar: `/s/<sessionId>`, or `/m/<configured-machine>/s/<sessionId>` for a peer.
  The Machine picker requires a configured peer; a default launch lists only Local.

## Driving it with agent-browser

Preconditions: a seeded launch, `. "$RUN/run.env"`, doctor passed;
`ab() { .agents/skills/verify-piano/scripts/ab.sh "$RUN" "$@"; }`. Run the harness journey first.

- Harness
  - Command: `node test/browser/open-session.mjs "$EVIDENCE/open-session/harness"`
  - Result: exit 0 and `PASS open-session ...` (sidebar, long-history jumps, cost, follow-up,
    inline questions, stop, streaming scroll anchoring and persistent tool disclosure).
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
- `view-options-phone`
  - Action: `ab set viewport 390 844; ab find role button click --name 'Show sidebar' --exact;
    ab wait '[role=dialog]'` (omit Show sidebar if its sheet is already open). Wait for the
    sheet's animations as in `unavailable-history`, then
    `ab find role button click --name 'View options' --exact; ab wait '[role=menu]'`.
  - Result: Group by, Sort by, Show and Appearance are inline sections; Date / Folder / Project /
    None, Activity / Name, Folder and branch, Light / Dark / System are directly reachable.
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
  independent peers; it cannot run under this skill's one-instance limit. Its imported
  `voice-input.mjs` helper also needs those peers. Record that unmet prerequisite rather than
  running the helper alone or borrowing the owner's Piano. An exe.dev peer additionally needs
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
