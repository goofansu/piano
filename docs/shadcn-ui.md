# shadcn ownership and upgrades

`web/src/components/ui/` is upstream source, not Piano's design layer. The project uses the
Radix base and the Vega style (`radix-vega` in `components.json`, chosen on
[shadcn/create](https://ui.shadcn.com/create) for keeping Lucide, `rounded-md` and 36px controls).
Standard controls import from `ui/`; customized controls import the
app components below. App wrappers forward props and refs and compose caller event handlers.
The CLI also owns `web/src/hooks/use-mobile.ts`.

`web/components.json` deliberately sets `rsc: true` to preserve upstream `"use client"` directives
in generated files. Piano is still a client-side Vite app: this CLI option does not enable React
Server Components, and those directives do not change its runtime behavior. Keep the directives
as generated rather than stripping them. This also avoids the order-dependent stripping observed
with shadcn CLI 4.21.4's `rsc: false` transformer.

## Where customizations belong

| Concern | Owner outside `ui/` |
| --- | --- |
| Borderless/rail button variants | `PianoButton` |
| Underlined file-view toggles | `PianoViewToggle`, `PianoViewToggleItem` |
| Status badge and warning alert variants | `StatusBadge`, `PianoAlert` |
| Overlay surfaces, stacking and motion | `PianoDialog`, `PianoSheet`, `PianoSelect`, `PianoPopover`, `PianoDropdownMenu`, `PianoTooltip`; shared `lib/overlayStyles.ts` |
| Pointer-close focus; keyboard/hover tooltips | `PianoPopover`, `PianoDropdownMenu`, `PianoTooltip`; shared `lib/pointerClose.ts` |
| Search/option row heights, including touch and the palette dialog | `PianoCommand` |
| Settings sidebar tooltip policy | `PianoSidebarMenuButton` |
| Mobile sidebar reveal and partial scrim | `PianoSidebarReveal`; transient finger tracking in `useSidebarSwipe`, motion in `index.css` |
| Theme tokens and existing selected-sidebar styling | `index.css` |

Wrappers merge only Piano's changes, not copies of upstream class lists. Custom button/badge/alert
variants pass `variant={null}` to avoid inheriting an unrelated upstream variant's hover/dark rules.
Overlay wrappers neutralize upstream directional slides; they keep Piano's anchored scale motion.
The tooltip arrow stays inside the content's stacking context, so it needs no separate z-index patch.

Two internal-slot exceptions live in `index.css`: Dialog/Sheet backdrops have no content-level
styling prop, and Radix ScrollArea's inline `display: table` defeats truncation. Keep these rules
narrow. The scroll rule deliberately overrides inline display; the reduced-motion reset still
wins over all overlay motion. The sidebar's existing selected-row CSS already owns its color;
no duplicate class patch is needed.

### Stock sidebar shortcut

There are no intentional patches left in `ui/`. Keep Sidebar's built-in Mod+B listener alongside
Piano's Mod+K command palette. Its controlled `open` prop connects the shortcut to Piano's desktop
sidebar, including the saved collapsed preference. Piano's separate mobile reveal still uses its
layout controls; stock `openMobile` is not connected to that reveal. It composes the same Radix
modal primitive as Sheet, but exposes stationary navigation under a translated live page rather
than moving a sheet over it. The sidebar occupies 75% of the mobile viewport; only a claimed
horizontal drag anywhere on the main content overrides touch scrolling, with browser edges,
editing controls and horizontal scrollers excluded. Drag motion tracks the finger 1:1; settling
duration adapts to release speed and remaining distance, with a velocity-matched easing curve to
avoid a speed jump on release and stop gently at the endpoint. The moving surfaces have compositor
hints (the live page only on mobile). During a drag, `useSidebarSwipe` batches surface-only style
writes into animation frames; React owns mounting and the settled endpoint.
Do not update inherited motion variables per frame: that invalidates styles across the transcript
and navigation. Cancellation discards pending frames and returns the surfaces to CSS settling.

## Upgrade procedure

1. From `web/`, preview `npx shadcn@latest add <component> --dry-run`, then
   `npx shadcn@latest add <component> --dry-run --diff <file>`. Include transitive components,
   dependency and CSS changes in the review.
2. Take reviewed upstream source changes without carrying local component patches. Avoid
   overwriting `index.css`, app wrappers or unrelated dependencies as a side effect.
3. Check changed props, slots and internal composition against app wrappers. In particular,
   upstream composites import their own `ui/` children: they do not automatically use Piano
   wrappers. `PianoCommand` composes its own dialog, and `PianoSidebarMenuButton` its own tooltip.
4. Before the change, capture the surfaces it touches with
   `node test/browser/style-shots.mjs <before-dir>` (transcript with open tool rows, model picker,
   session menu, palette, settings, phone layout, light and dark). After it, run the repository
   gates and `npm run test:browser`, capture again into a second directory and compare the pairs.
   Then observe the rest through `agent-browser` on a scratch instance: pointer and keyboard
   focus, Mod+K and Mod+B, touch focus, the mobile sidebar reveal and finger tracking,
   cancellation, dismissal and reduced motion. Physical Safari browser-edge navigation still
   requires a device check.

Upgrades still need review: clean upstream files eliminate customization merges, not API or
visual regressions. Compare against CLI-generated source for this project's registry and aliases,
not raw registry templates with untransformed imports.
