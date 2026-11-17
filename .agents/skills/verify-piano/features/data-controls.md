# Settings › Data controls

Data controls restores archived session references one at a time and archives stopped, unpinned
sessions in bulk without deleting their transcripts. Settings → Data controls and the palette open
`/settings/data-controls` on Local; a remote machine's data controls belong on its own Piano.

## Sub-features

- `archived-rows`: Sessions comes first, Archived sessions last. Each archived row shows its title,
  small folder name (full path in `title`) and an outline Unarchive button; no Unarchive all.
- `unarchive`: restores the reference and toasts Session unarchived. Reading its saved history
  does not start a user Pi; an uncached composer catalog can start a probe.
- `archive-all`: Archive all asks for confirmation with the eligible count and “Running and
  pinned sessions are kept. Transcripts are kept.” Its action is neutral, not destructive.
  Cancel/Escape changes nothing; confirmation at zero is disabled. The success count is the
  number actually archived, not a promise that the earlier count stayed current.
- `closed-folder`: Unarchive keeps a closed folder closed and says “Session unarchived · Folder
  remains closed”. A pin or project may still make the session visible.
- `layout`: one Settings column, matching text actions and readable titles/paths on desktop and
  narrow viewports; no helper descriptions beneath the groups.

## How to get to it (user POV)

- Sidebar Settings → Data controls.
- Mod+K → Data controls, including from another Settings section.
- Address bar: `/settings/data-controls`. Settings is local-only, not a peer-session action.

## Driving it with agent-browser

Preconditions: a fresh seeded default-fake launch, `. "$RUN/run.env"`, doctor passed;
`ab() { .agents/skills/verify-piano/scripts/ab.sh "$RUN" "$@"; }`. Keep the loose seed stopped
and unpinned, and the project seed available for Pin. Run the closed-folder check last; other
recipes need the folder open. Capture with `capture.sh` as in the skill body.

- `archived-rows` and `unarchive`
  - Action: `ab open "$WEB_URL/s/verify-loose"; ab wait --text 'Answer 4.'`;
    capture `01-before-archive`, then
    `ab find role button click --name 'Session menu for Loose session' --exact;
    ab find role menuitem click --name Archive --exact; ab wait --text 'Session archived';
    ab open "$WEB_URL/settings/data-controls"; ab wait --text 'Archived sessions'`.
  - Result: capture `02-archived`; the row has Loose session, repo and Unarchive. Read its full
    path with `ab eval "document.querySelector('main [data-slot=item-description]')?.title"`.
    Restore this row with
    `ab click 'main [data-slot=item]:has([title="Loose session"]) button';
    ab wait --text 'Session unarchived'`. Capture `03-unarchived`; open `/s/verify-loose` again
    and wait for Answer 4. The saved history returns, with no non-probe start for `verify-loose`
    in `$AUDIT`. A follow-up would invalidate that no-start check.
- `archive-all` (fresh seed after Unarchive)
  - Action: on `/s/verify-plan`, Session information and actions → Pin:
    `ab find role button click --name 'Session information and actions' --exact;
    ab find role menuitem click --name Pin --exact`. On `/new`, send exactly `hold` through
    First message and Send; `ab wait '[aria-label="Stop"]'`. Save its URL with `ab get url`.
    Return to `/settings/data-controls`; capture `04-before-bulk`.
  - Confirmation: `ab find role button click --name 'Archive all' --exact;
    ab wait --text 'Running and pinned sessions are kept. Transcripts are kept.'`.
    Capture `05-confirm` and read `ab eval "document.querySelector('[role=dialog]').innerText"`.
    The fresh seed has one eligible reference, Loose session. Cancel once with
    `ab find role button click --name Cancel --exact`, reopen Archive all, then confirm with
    `ab click '[role=dialog] button[data-variant=default]'`.
  - Result: capture `06-archived` with the toast's actual count and the archived row. Verify the
    pinned seed and Working session remain, and no abort/shutdown reached the live fake Pi.
    Reopen Archive all: `ab wait --text 'Archive 0 sessions?'`; record
    `ab eval "[...document.querySelectorAll('[role=dialog] button')].map(b=>({text:b.textContent,disabled:b.disabled}))"`.
    Archive all is disabled. Escape closes the confirmation.
  - Restore/finish: Unarchive Loose session as above; `ab wait --text 'No archived sessions yet'`
    on the fresh seed. Capture `07-empty`. Open the saved hold URL, wait for Stop, capture the
    still-working session, then click Stop and wait for Send. Do not leave a hold running after
    the preservation check.
- `layout` and palette
  - Action: from `/settings/webhooks`, `ab press Control+k; ab wait '[cmdk-input]';
    ab fill '[cmdk-input]' 'data controls'; ab wait '[cmdk-list][aria-busy="false"]';
    ab find role option click --name 'Data controls' --exact;
    ab wait --url '**/settings/data-controls'` (Meta+k on macOS).
  - Result: capture desktop and `ab set viewport 390 844` views alongside Webhooks. Record
    `ab eval "({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})"`:
    both are 390. Widen to 1280×800 before the folder menu steps. Viewport emulation does not
    establish real-device scrolling or transient busy-spinner behavior.
- `closed-folder` (last)
  - Action: archive Loose session again through its row menu. In View options → Group by Date →
    Folder, choose Folder; wait for menu animation before choosing a submenu item, as in the
    skill's Gotchas. Then `ab find role button click --name 'Folder menu for repo' --exact;
    ab find role menuitem click --name Close --exact; ab wait --text 'Close this folder?'`.
    Capture `08-close-confirm`; `ab find role button click --name Close --exact`.
  - Result: on `/settings/data-controls`, Unarchive Loose session with the scoped row selector
    above; `ab wait --text 'Session unarchived · Folder remains closed'`. Capture `09-closed`;
    `curl -s "$API_URL/api/folders"` confirms the folder did not reopen. Do not infer that a
    pinned or project-member session must disappear from every sidebar group.
- Local-only prerequisite
  - Action on a default launch: `ab open "$WEB_URL/m/not-configured/s/verify-plan";
    ab wait --text 'Machine unavailable'`; capture the attempted route.
  - Result: report peer Settings absence as `verified-unreachable`, not verified by local CRUD.
    A configured, reachable peer is required. Follow [Open a session](./open-session.md#gotchas)
    for the isolated remote journey and its run-limit exception; when stricter limits prohibit
    it, retain that prerequisite rather than starting another instance.

## Gotchas

- Use `[role=dialog]` for the confirmation, not `alertdialog`. Scope Unarchive to its row when
  more than one session is archived. A toast can cover controls; wait for it to leave before
  the next menu action.
- “Running” includes Ready/idle Pi, not just Working. Archive all preserves execution owners,
  starting sessions and held locks; this fake-Pi recipe proves the Working and pinned cases,
  not app-runtime survival or stale-write races.
- The [Data controls contract](../../../../docs/data-controls.md#verification) links module checks
  for app owners, startup/locks, stale writes and peer refusal. `test/PeerScope.test.ts` checks
  both mutations and the count through `/ws/peer`; label it module-only evidence.
- Closing the only seeded folder intentionally invalidates doctor's original one-folder check.
  Finish the closed-folder evidence, then Cleanup; do not treat that changed fixture as a server
  failure or continue unrelated recipes on the closed-folder baseline.
- Keep the observed count, audit and captures with the tested revision. Fake Pi demonstrates
  Piano's process handling, not a model. Capture busy labels/spinners separately if that
  transient behavior is the claim being verified.
