# Session and Settings: one layout, one motion contract

Date: 2026-10-09 (environment UTC). Source: `94d8472d38cbfde91dbc55b90846df5938ba656b`.
The findings below describe that baseline. The implementation and verification follow-up is recorded
at the end; no deployment is included.

## Finding: matching endpoints, different layout engines

Settings copies the session card's appearance, but not its behavior. The session uses a custom
resizable `<aside>` in [App.tsx][app]; Settings uses the installed shadcn [Sidebar][primitive]
and `SidebarInset` in [SettingsPage.tsx][settings]. Sharing the outer `SidebarProvider` does **not**
make the custom aside use its state or transitions.

| Concern | Session | Settings |
| --- | --- | --- |
| Desktop motion | Width transitions **300ms**, `cubic-bezier(0.32,0.72,0,1)`; disabled during dragging. | Separate spacer width and fixed panel `left/right/width` transitions, **200ms linear**. Applying a class only to `Sidebar` targets the panel, not the spacer. |
| Width/resizing | Default **288px**, rail **48px**; drag clamps to **208–480px**, release below **160px** collapses; double-click resets. Width and collapse persist in `piano.sidebarWidth` / `piano.sidebar`. | Fixed **288/48px** overrides; no drag resizing. Provider has independent `open` state, initially true; writes `sidebar_state` cookie but this app does not read it back. |
| Rail lifecycle | Collapse immediately replaces/unmounts expanded `Sidebar` with a different `SidebarRail`. Expanded contents have a fixed inner width and clip during expansion. Remounting restarts sidebar reveal state and loses DOM-local state such as scroll. | Navigation remains mounted as the panel shrinks. Piano label hides immediately; padding changes and menu-button width/height/padding transition. Providers remains an icon action. |
| Card/view entry | `sheet-enter`: **360ms**, fade + 10px rise. Inner `view-enter`: **200ms**, fade + 8px rise, keyed by `state.view.kind`, not session ID. | Same conversation background, 8px desktop top/bottom/right margins, 16px radius, border and shadow, but **neither entrance class**. |
| Mobile geometry/focus | Full-width, `h-dvh` left Sheet. Explicit initial focus on Sheet content; records/restores opener via `showSidebar`. Palette toggle bypasses that capture. | Sidebar's **18rem** left Sheet, inherited `h-full`; generic title/description and default autofocus. `SidebarTrigger` is an ordinary button, not a `SheetTrigger`; explicit return-focus handling is absent. Cleanup closes mobile navigation when Settings unmounts. |
| Mobile animation | Both already use [ui/sheet.tsx][sheet]: panel slide + overlay fade, **300ms enter / 200ms exit**, `--ease-enter` / `--ease-exit`. Different travel distances and focus/lifecycle can still feel different. | Same primitive and timing, not a second mobile animation implementation. |
| Reduced motion | Explicit width-transition opt-out, plus global reset. | No local width opt-out, but covered by the **same global reset**. Neither is supposed to animate with reduced motion enabled. |

Owners: [App][app], [session sidebar and rail][sidebar], [Settings][settings],
[shadcn sidebar implementation][primitive], [Sheet][sheet], [CSS][css].

Two important qualifications:

- **Mounted is not the same as animation-preserved.** Settings hides the session main using
  `display:none` while retaining React state. On showing it again, CSS entrance animations on it
  and its descendants restart under the [CSS Animations specification][animation-spec]. This explains
  asymmetric Settings entry versus return-to-session motion without a React remount. Likewise,
  `.reveal-row` always has an animation; its 700ms reveal flag only controls stagger indices.
- **The design document is intent, not current timing evidence.** [Felt][felt] and [CSS][css] define
  layout **320ms** and entrance easing `cubic-bezier(0.22,1,0.36,1)`. Neither desktop sidebar uses
  that layout token today. Reduced motion globally sets animation/transition to `none !important`
  and scrolling to `auto`, including pseudo-elements; retain this stronger policy, consistent with
  [MDN's reduced-motion guidance][reduced-motion].

## Recommendation: one small, real `AppLayout.tsx`

Extract a shared **behavioral shell**, consumed by both the session/New view and Settings—not
just a class string, a Settings-only wrapper, or another provider around the existing two engines.
Compose the installed shadcn `SidebarProvider`, `Sidebar`, `SidebarInset` and Sheet machinery;
move session navigation onto that same shell. Keep domain navigation and provider-fetch/login
logic outside it. Its small public surface should be navigation, compact navigation, accessible
navigation title, content, and active/visibility state; expose show/hide/toggle through one context.

The module should own:

1. **Desktop geometry and state.** One persisted desktop width/collapse preference, sourced from
   existing session keys, shared across both destinations; one separate mobile-open state. Retain
   resize bounds, drag-to-collapse and reset. Drive both shadcn spacer and panel from the same width
   variable; suspend both transitions during dragging. The installed shadcn `SidebarRail` is a
   toggle button, **not** Piano's resize implementation, despite its resize cursor.
2. **One motion contract.** To satisfy “use the same animation” with the least session change,
   promote the current session **300ms / cubic-bezier(0.32,0.72,0,1)** to shared layout tokens in
   `index.css`, and reconcile Felt's currently unused 320ms claim in the implementation change.
   Apply those tokens to every moving desktop shell dimension. Keep the already-shared mobile
   Sheet entrance/exit contract; desktop resizing and mobile overlays need not have identical tempos.
3. **One rail lifecycle.** Keep expanded navigation mounted at its expanded width, clipped while
   collapsing; use the same compact-slot visibility policy for both views. Hidden navigation must
   be non-interactive/inert, not merely transparent. Preserve session rail activity/Settings actions
   and Settings' Providers action; identical mechanics do not require identical navigation contents.
   Do not replay the session list's first-load stagger on every expansion.
4. **One mobile/focus policy.** Use full-width dynamic-height navigation for both, retaining the
   session behavior. Add only the narrow mobile-content/focus customization needed to the installed
   Sidebar primitive; do not retain a parallel custom mobile branch in App. Focus the Sheet itself
   on opening; restore a valid visible opener on ordinary dismissal and focus the destination on
   navigation. Handle palette opening, route changes and breakpoint changes explicitly. Keep Radix
   modality, Escape, focus trapping and accessible titles; do not rebuild them.
5. **One inset surface and entrance owner.** Move card tokens into the shared `SidebarInset`
   composition. Keep the outer surface stable; use a shared content-activation entrance for
   Session/New/Settings, rather than one page animating its entire card on return and the other not
   animating. Preserve the session subtree/draft while Settings is active (existing INV-02 guardrail),
   and never key/remount the conversation or animate streaming updates to obtain a transition.
   Gate first-load versus reactivation animation explicitly instead of relying on `display:none`.

The [official shadcn Sidebar docs][shadcn-sidebar] support controlled state, width variables and
composition; they do not supply Piano's resize persistence or content-lifecycle policy. The local
source is authoritative for installed behavior. [Sheet docs][shadcn-sheet] and [Radix Dialog][radix]
provide the accessibility foundation; Radix's documented return target is its **Dialog.Trigger**,
so an unrelated button calling a setter must not be assumed to provide that contract.

[CommandPalette.tsx][palette] currently selects between two toggle implementations correctly;
route it through the shared shell rather than retaining that split. Keep Mod+K as the only global
shortcut, not upstream Sidebar's documented Mod+B.

## Smallest useful implementation checks

The existing [browser Settings journey][test] checks **settled** 288/48px card geometry, styling,
mobile navigation and draft preservation; it does not establish equal motion or focus restoration.
Extend that journey, not class-string unit tests: compare computed transition timing for both views,
rapidly reverse collapse, resize/reopen, preserve sidebar scroll and composer identity/draft, and
check mobile Escape/selection/palette focus with no orphan overlay. Observe both directions of
Settings navigation. Repeat with reduced motion and assert zero running layout/entrance animations.
Keep Settings full-page and session chrome hidden. Use scratch `agent-browser`; run required
code-change gates only when implementing. Relevant guardrails: [INV-02 and INV-09][invariants].

Research verification: source and existing test inspection; shadcn CLI `info --json` and
`docs sidebar sheet` from `web/` (Vite, Tailwind v4, Radix/new-york); fetched official docs/examples,
MDN and W3C; local-link and whitespace review. Node `v24.21.0`. Findings describe source-defined
behavior, not measured frame timing or a reproduced browser focus failure.

## Implementation decision and verification

The implementation chooses a single width-bearing `<aside>` in
[`AppLayout.tsx`](../../web/src/components/AppLayout.tsx), rather than driving two stock shadcn
spacer/panel elements. Both pages now use this same shell. The installed shadcn provider, navigation
primitives and Radix Sheet remain the composition foundation; the shell owns the custom resize
policy that those primitives do not provide. This is a deliberate refinement of the proposal above,
not two styled wrappers around the old engines.

`useAppLayout` owns shared persisted width/collapse, mobile state, focus return and drag cleanup;
`AppLayout` owns one stable main card and navigation surface; `LayoutView` owns content activation
without remounting the session. `LayoutHeader` and `LayoutRail` share control placement. The command
palette calls the same toggle as the visible controls. Expanded navigation stays mounted and inert
while the rail is active. The [Felt tokens][felt] now describe the actual shared desktop transition.

Verified on baseline `94d8472` plus this working-tree change, Node `v24.21.0`, Worktrunk `0.80.0`,
Chromium through `agent-browser`, fake Pi, isolated registry and loopback backend/UI on **7191/7192**:

- `npm test`: **102 passed**; `npm run typecheck` and `npm run lint`: **passed**.
- `PIANO_TEST_BACKEND_PORT=7191 PIANO_TEST_WEB_PORT=7192 node test/browser-slash-completion.mjs
  /tmp/piano-layout-unification/browser-final`: **passed**.
- Actual `transitionrun` observations for both pages: **0.3s**, **cubic-bezier(0.32, 0.72, 0, 1)**.
  A collapse reversed at an observed intermediate width and returned to the expanded endpoint.
- Actual page `animationstart` observations: **0.2s**, **cubic-bezier(0.22, 1, 0.36, 1)** in both
  directions; the main card did not re-enter or change DOM identity. Composer DOM/drafts survived.
- Desktop card geometry/style parity, collapse/expand, retained expanded navigation, resizing to
  400px across page changes/reload, reset to 288px, full-width mobile navigation, Escape focus
  restoration and reduced-motion zero-running-animation checks passed.
- Existing OAuth resume/cancel and fake-Pi composer journeys remained green. Completed external
  sign-in and real model execution were not exercised for this layout-only change.

Logs, measured motion and screenshots are retained under `/tmp/piano-layout-unification/`.
An initial run encountered occupied scratch ports; a later run exposed a test selector matching the
hidden desktop navigation instead of the mobile dialog. The final run uses isolated ports and a
modal-scoped selector; neither earlier failure is represented as a pass.

[app]: ../../web/src/App.tsx
[sidebar]: ../../web/src/components/Sidebar.tsx
[settings]: ../../web/src/components/SettingsPage.tsx
[primitive]: ../../web/src/components/ui/sidebar.tsx
[sheet]: ../../web/src/components/ui/sheet.tsx
[css]: ../../web/src/index.css
[palette]: ../../web/src/components/CommandPalette.tsx
[test]: ../../test/browser-slash-completion.mjs
[felt]: ../design-moonstone.md
[invariants]: ../development-invariants.md
[shadcn-sidebar]: https://ui.shadcn.com/docs/components/radix/sidebar
[shadcn-sheet]: https://ui.shadcn.com/docs/components/radix/sheet
[radix]: https://www.radix-ui.com/primitives/docs/components/dialog
[reduced-motion]: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
[animation-spec]: https://www.w3.org/TR/css-animations-1/#animations
