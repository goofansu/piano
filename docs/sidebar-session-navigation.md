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

## Developer navigation

Start at `adjacentSidebarSession` in `web/src/lib/sidebarList.ts` and
`web/src/lib/useSidebarSessionNavigation.ts`; the server side is the `select` drain in
`server/ClientDispatch.ts`.

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
