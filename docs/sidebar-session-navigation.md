# Desktop session navigation

For implementation work, start at [Developer navigation](#developer-navigation).

## Interaction contract

Alt+Up / Alt+Down chooses the previous / next eligible session in the sidebar model's
current grouping and sort: pinned once, ordinary sections, then Done where applicable.
**Revised at the user's request during implementation:** collapsed groups (including
Pinned) remain excluded, matching the original feature. Virtualization does not change
order. Existing disabled, history, archived and missing-checkout rules decide eligibility. There is no wrap. With
no selection in the displayed traversal (including an absent selection), Down chooses the first
and Up the last. Empty lists and boundaries make no selection/open request.

Selection uses the row-click lifecycle. Each repeat advances from the current intended
selection, not the last completed history load. Keyboard traversal does not expand
collapsed groups. Other selection paths retain the model's existing destination-only
expansion; unrelated group choices remain intact. Reveal uses the nearest edge, without animation,
centering or focus changes. The sidebar's virtualizer owns geometry, including rows that
are not mounted yet. A hidden sidebar stays hidden; showing it reveals the latest
selection. Manual scrolling or collapsing after a reveal is not continually undone.
Composer focus and per-session drafts survive navigation. Loading can temporarily disable
the editor; when it returns, restore its focus only if the chord came from it and the user
has not since chosen another focus or action. The latest conversation and row must win
delayed responses, including A → B → A before a render.

Dialogs, alert dialogs, menus, listboxes, palette, Settings, other editable controls,
IME composition, consumed keys and extra modifiers retain their existing exclusions.

Superseded read-only navigation must not exhaust client admission and leave the latest
destination unable to open. Admission stays bounded; mutations, creation, controls and
their explicit refusals are not silently retried or cancelled as navigation.

Cold navigation across directories also bounds automatic catalog/trust observations, not
only history selections. One observation may finish while the client retains just the
latest unsent focus and catalog revision. Trust is read after that directory's probe;
the latest directory eventually receives both facts, even after invalidation or reconnect.
A slow obsolete observation can delay a cold model picker, but never delays selection or
starts a probe for each intervening key. Explicit refreshes and trust decisions remain
independent. See [runtime input limits](runtime-input-limits.md).

## Verification plan (recorded before implementation)

Affected invariants: INV-01/02 (history and runtime ownership), INV-04/05 (control safety,
bounded delivery and latest selection), INV-08/09 (revision and bounded evidence).

Use isolated fake-Pi browser runs, Linux Chromium at 1280×900, Vite development, no
throttling or live model calls. A deterministic 1,001-session catalog has one pin and
1,000 ordinary sessions, identical timestamps, numeric titles and tiny saved histories.
Measure five batches of native browser Alt key repeats and five offscreen destinations;
capture browser timeline traces, key-to-selected-row-fully-visible (two animation-frame
paint opportunities), conversation readiness separately, mounted rows, outbound requests
and fake-Pi commands. Keep identical driver/fixture before and after outside Git.
Baseline failures are failures, not latency samples. Declare comparison budgets after
baseline measurements and before production edits. Use diagnostic budgets, not CI timers.

Separately reproduce cold history/admission pressure with 1,000 sessions holding 20
messages each (~42 KB text/session), 32 same-task synthetic chords and representative
native repeat cadence. Synthetic bursts are stress tests, not human cadence evidence.
Assert the final history, not only its optimistic URL or visible error summary.

Extend the open-session critical journey for changed interaction; use model tests for
ordering/eligibility/boundaries and deterministic dispatch tests for superseded pending
reads plus mutation/control safety. Run typecheck, lint and the full module suite.

### Predeclared measured budget

Baseline `e0636afc` (content-equivalent cherry-pick of `a056c8b0`) at
`/tmp/verify-piano-evidence/alt-perf-baseline`: 60/60 initially visible native chords
completed; median 83.3 ms, p95 129.9 ms, max 214 ms. Five 12-key batches consumed
1.988–2.692 s browser TaskDuration (median 2.169 s). These are whole-page tasks,
including async conversation work, not sidebar-only CPU. A 40-key repeat crossed
the viewport: only 18/40 revealed, 6.551 s tasks. All five offscreen reveals failed.
26 rows mounted. Traces and the exact driver are retained beside observations.

Before production edits, the budget is: 100% reveals; visible-case p95 ≤180 ms and
max ≤300 ms; new offscreen-case completion ≤250 ms; 40-key repeat p95 ≤180 ms and
max ≤300 ms. These are useful sub-200 ms typical responses, with two-frame sampling
and observed development-mode/host noise, not a promise of one-frame delivery.
Median 12-key TaskDuration ≤2.812 s (baseline ×1.25 +100 ms), repeat ≤8.289 s
(baseline ×1.25 +100 ms); offscreen median ≤450 ms total tasks. At most 40 mounted
rows in this fixture, no non-probe Pi commands, and at most one select per accepted
chord. The 25% CPU allowance exceeds the baseline batch spread around its median;
newly revealed windows may do real mount work. Conversation completion is checked
separately and must never be inferred from the URL. Failure to meet a budget calls
for investigation, not a changed threshold.

## Reference boundaries

The supplied research read T3 Code at
[`cb251b9`](https://github.com/pingdotgg/t3code/tree/cb251b9abc1403aa02e21e400d0b7f396a195e3c).
[`Sidebar.tsx` L493–554](https://github.com/pingdotgg/t3code/blob/cb251b9abc1403aa02e21e400d0b7f396a195e3c/apps/web/src/components/Sidebar.tsx#L493-L554)
uses a model order, but excludes most collapsed threads. The user chose to retain
Piano's existing skip-collapsed convention too.
[`routeReveal.ts` L15–59](https://github.com/pingdotgg/t3code/blob/cb251b9abc1403aa02e21e400d0b7f396a195e3c/apps/web/src/components/sidebar/routeReveal.ts#L15-L59)
separates route intent and nearest reveal without focus, but its rendered-row tests do
not establish virtualized reveal. The reference tests were read, not executed.

Linear's [sidebar documentation](https://linear.app/changelog/unpublished-collapsible-sidebar#collapsible-sidebar)
describes explicit visibility choices, not traversal implementation. Supplied observation
of the unauthenticated demo (Linux Chromium, 1440×900, 2026-11-15) found J/K item movement,
Enter opening, a first endpoint, nearest-edge list movement and hidden-sidebar preservation.
It did not establish sidebar group traversal, private algorithms, drafts or async races.
These references support separation and focus/layout restraint, not Piano's traversal domain.

## Developer navigation

This is the starting place for desktop session navigation: the Alt+Up / Alt+Down chord, the
reveal of the selected row, and the bounded reads a selection causes. The feature spans the
modules below, not one feature module. Preserve `web → shared ← server`: the browser decides which
row is next and reveals it; `select` is the one wire request that opens a session, the same one a
row click sends; the server admits selections as latest-value reads and never coalesces mutations.
[Quiet UI](quiet-ui.md#command-palette-and-shortcuts) owns the shortcut and its exclusions as the
user sees them, [runtime input limits](runtime-input-limits.md) the admission budgets, and
[browser storage](browser-storage.md#a-machines-memory) which groups stay open per machine.

Where to begin: which row a chord chooses, `adjacentSidebarSession` in
[`sidebarList.ts`](../web/src/lib/sidebarList.ts); which keys count, `sessionNavigationKey` in
[`keys.ts`](../web/src/lib/keys.ts); focus and drafts around a chord,
[`useSidebarSessionNavigation.ts`](../web/src/lib/useSidebarSessionNavigation.ts); reveal
geometry, [`useSidebarWindow.ts`](../web/src/lib/useSidebarWindow.ts); what a held key costs the
server, the `select` policy and selection drain in
[`ClientDispatch.ts`](../server/ClientDispatch.ts).

### Web ownership and interfaces

- [`keys.ts`](../web/src/lib/keys.ts) exposes `sessionNavigationKey(event)`: `-1`, `1`,
  `"modifier"` or `undefined`. IME keys, consumed keys and chords with Ctrl, Meta or Shift are
  not navigation; a modifier pressed alone is `"modifier"`, which the hook ignores without
  dropping the composer-focus intent of the chord before it.
- [`sidebarList.ts`](../web/src/lib/sidebarList.ts) exposes `createSidebarList` (the
  `SidebarList` both sidebars render: grouping, sort, and the open or collapsed state of each
  section, kept per machine) and `adjacentSidebarSession(list, current, direction)`: the next
  openable row in displayed order, Pinned when open, then the open sections and Done; no wrap;
  a collapsed or unlisted selection counts as none. A row is `disabled` where
  [`sessionCatalog.ts`](../web/src/lib/sessionCatalog.ts) says so (starting, or history
  unavailable); traversal skips it. [`useSidebarList.ts`](../web/src/lib/useSidebarList.ts)
  mounts the model over the real clock and storage.
- [`useSidebarSessionNavigation.ts`](../web/src/lib/useSidebarSessionNavigation.ts) exposes
  `useSidebarSessionNavigation(list, client, navigation)`, mounted once by
  [`App.tsx`](../web/src/App.tsx) over the list the sidebar renders. One window `keydown`
  listener applies the exclusions (Settings, the palette, open dialogs, menus and listboxes,
  editable controls other than the session composer), reads `client.getState()` at the key so a
  repeat advances from the latest intent rather than a render closure, calls `navigation.select`,
  and restores the session composer's focus after loading only for the chord that came from it
  and only while no other focus or pointer action intervened.
- [`navigation.ts`](../web/src/lib/navigation.ts) exposes `Navigation.select(cwd, sessionId)`,
  the path a sidebar row, a project-home row and a palette row use too: it leaves Settings,
  dismisses the mobile sidebar once and calls `Client.select`.
- [`client.ts`](../web/src/lib/client.ts) exposes `Client.select`, a no-op for the session
  already on screen or being fetched; otherwise it mints a `selectionId`, applies `selecting`
  synchronously (the pane switches before the server answers) and sends `select`. A reconnect
  re-sends the latest selection once; stale answers are dropped by `selectionId`. The same
  module keeps at most one automatic `directory` observation in flight per connection, retaining
  only the latest focus and catalog revision while it runs.
- [`useSidebarWindow.ts`](../web/src/lib/useSidebarWindow.ts) is internal to
  [`SidebarSessionList.tsx`](../web/src/components/SidebarSessionList.tsx): fixed-height windowed
  rows in the sidebar's one scroll viewport; it reveals the selected row by its nearest edge once
  per row and `selectionId`, including a row not mounted yet, without taking focus; a hidden
  sidebar keeps that intent until it is shown.

### Shared contracts

[`wire.ts`](../shared/wire.ts) defines `select { selectionId, cwd, sessionId, attemptId? }` and
its answers `selected`, `selection_rejected` and `selection_failed`, correlated by `selectionId`;
`act` reuses the current `selectionId` as its claim, so an action aimed at a superseded selection
is refused as stale. `directory { cwd, requestId }` is the automatic focus observation, answered
once by `directory` with the catalog and trust, or an error. A `select` carrying `attemptId` is a
read-only creation read-back, not navigation to a listed session; see
[failed creation and reconnect](runtime-ownership.md#failed-creation-and-reconnect).

### Server ownership and interfaces

- [`ClientDispatch.ts`](../server/ClientDispatch.ts) exposes `receive(request)`. A `select` is
  admitted as a claim in receive order, and read-only selections share one drain per connection:
  at most one read runs and one waits; a newer pending `select` replaces the older, releasing its
  lease without reading its history; a replacement that cannot fit the byte budget is refused and
  leaves the prior selection intact. Creation, prompts and other mutations are never coalesced,
  cancelled or replayed; a refusal is an explicit `selection_rejected` or `error`. `directory`
  takes one ordinary lease and answers by `requestId` on success, failure or refusal.
- [`ClientSessions.ts`](../server/ClientSessions.ts) exposes `select(selection)`: it claims the
  selection at once and returns the work that reads the session (`SessionHosts.read`, which never
  starts Pi) and sends `selected` only if that selection is still current. The latest claim wins:
  a newer claim ends the older selection's waits for a creation's outcome or for the session lock
  a starting Pi holds, so the drain moves on; a history read already holding the lock finishes
  first, unanswered.
- [`PeerScope.ts`](../server/PeerScope.ts)'s `peerVerdict` admits a peer's `select` only for a
  session it lists (or a registered directory for a read-back) and `directory` only for a
  registered directory; the browser's offers do not decide this.

### Tests and verification paths

Module checks are grouped by the contract they protect:

- Key policy: [`Keys.test.ts`](../test/Keys.test.ts) accepts only Alt+Up/Down, repeat included,
  rejects IME, consumed and extra-modifier keys, and treats a lone modifier as no action.
- Order and eligibility: [`SidebarList.test.ts`](../test/SidebarList.test.ts) walks every
  grouping and sort forwards and backwards, collapses Pinned and a project group, treats a
  collapsed or unlisted selection as none, and returns nothing for an empty list; it also covers
  which section a selection opens and that a refresh never reopens a collapsed one.
- Browser selection correlation: [`Client.test.ts`](../test/Client.test.ts) covers one re-select
  after a dropped connection or a delivery gap, `act` only on a ready attachment with its
  selection, A → B → A focus coalescing, observation only once the registry is known and no
  automatic retry of a refused observation; [`Navigation.test.ts`](../test/Navigation.test.ts)
  covers a selection dismissing the mobile sidebar once and a session URL waiting for the
  registry.
- Server admission: [`ClientDispatch.test.ts`](../test/ClientDispatch.test.ts) shows cold
  cross-directory focus unable to fill admission while saved selections advance, 32 superseded
  selections during startup ending with only the first and the latest shown while an unrelated
  mutation is refused explicitly and a ping still answers, a newer selection shown while the
  one it superseded still waits on a held creation or on a session whose Pi is starting, and
  saturation rejecting before any selection changes; [`ClientSessions.test.ts`](../test/ClientSessions.test.ts) shows a saved
  selection spending one discovery read without starting Pi, a lookup that finishes after a
  reselect showing nothing, and an act for a replaced selection refused as stale.
- Reveal geometry has no module test: `useSidebarWindow.ts` is proven only by the browser
  journey below.

The committed journey is [`open-session.mjs`](../test/browser/open-session.mjs), run by
`npm run test:browser` or alone with `node test/browser/open-session.mjs <evidence-directory>`.
Its `session-arrows` steps press Alt chords in one browser task before any render, restore the
composer's draft and focus, reveal an offscreen destination in an 80-row fixture, navigate with
the sidebar hidden, stop at collapsed groups and boundaries, and leave an open menu or palette
owning its keys; captures are named `sidebar-alt-*`. The verify-piano entry is the
`session-arrows` sub-feature of
[Open and continue](../.agents/skills/verify-piano/features/open-session.md): run the harness first, since the two-session seed cannot prove offscreen navigation. The
[measured budget](#predeclared-measured-budget) above is evidence tied to its revision, not a CI
gate; `npm run test:browser` asserts behavior, not latency.
