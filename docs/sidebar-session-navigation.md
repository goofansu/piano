# Desktop session navigation

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
