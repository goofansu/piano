# shadcn ownership and upgrades

`web/src/components/ui/` is upstream source, not Piano's design layer. The project uses the
Radix base and the Vega style (`radix-vega` in `components.json`, chosen on
[shadcn/create](https://ui.shadcn.com/create) for keeping Lucide, `rounded-md` and 36px controls).
Standard controls import from `ui/`; customized controls import the
app components below. App wrappers forward props and refs and compose caller event handlers.
The CLI also owns `web/src/hooks/use-mobile.ts`.

Always exclude upstream shadcn source from Biome formatting, linting and import organization
through `biome.json` → `files.includes`. This includes generated hooks and other dependencies
outside `components/ui/`: add a specific exclusion whenever the CLI introduces another
upstream-owned path. Keep Piano-owned hooks and wrappers checked; do not exclude their whole
directories. Preserve upstream formatting as well as behavior.

`web/components.json` deliberately sets `rsc: true` to preserve upstream `"use client"` directives
in generated files. Piano is still a client-side Vite app: this CLI option does not enable React
Server Components, and those directives do not change its runtime behavior. Keep the directives
as generated rather than stripping them. This also avoids the order-dependent stripping observed
with shadcn CLI 4.21.4's `rsc: false` transformer.

## Where customizations belong

| Concern | Owner outside `ui/` |
| --- | --- |
| Borderless button variants; icon button sizes by place (`header`, `list`, `row`, `inline`) | `PianoButton` |
| A row's revealed actions and the room made for them | `RowActions`; motion in `index.css` |
| Underlined file-view toggles | `PianoViewToggle`, `PianoViewToggleItem` |
| Status badge and warning alert variants | `StatusBadge`, `PianoAlert` |
| Status dot (session, preview, delivery state) | `StatusDot` |
| Settings page frame, groups and hairline lists | `SettingsSectionFrame`, `SettingsGroup`, `SettingsList`, `settingsRow` |
| Surface area column, view frame and its header | `SurfaceColumn`, `SurfaceFrame`, `PanelHeader` |
| Underlined navigation tabs (Agent / Changes) | `PianoTabs`, `PianoTabsList`, `PianoTabsTrigger` |
| Overlay surfaces and stacking | `PianoDialog`, `PianoSheet`, `PianoSelect`, `PianoPopover`, `PianoDropdownMenu`, `PianoTooltip`; shared `lib/overlayStyles.ts` |
| Pointer-close focus; keyboard/hover tooltips | `PianoPopover`, `PianoDropdownMenu`, `PianoTooltip`; shared `lib/pointerClose.ts` |
| Search/option row heights, including touch and the palette dialog | `PianoCommand` |
| Settings sidebar tooltip policy | `PianoSidebarMenuButton` |
| Mobile sidebar reveal and partial scrim | `PianoSidebarReveal`; transient finger tracking in `useSidebarSwipe`, surface styles in `index.css` |
| Theme tokens and existing selected-sidebar styling | `index.css` |

Wrappers merge only Piano's changes, not copies of upstream class lists. Custom button/badge/alert
variants pass `variant={null}` to avoid inheriting an unrelated upstream variant's hover/dark rules.
Motion is opt-in: the reset at the end of `index.css` stops upstream motion except on elements a
`Piano*` wrapper marks `data-motion`, whose rules retune the upstream classes (see
[Motion](design-moonstone.md#motion)). The dialog and popover content wrappers also own the closing
face: they exit on a copy of the last open face (`useExitFace`).
The tooltip arrow stays inside the content's stacking context, so it needs no separate z-index patch.

Two internal-slot exceptions live in `index.css`: Dialog/Sheet backdrops have no content-level
styling prop, and Radix ScrollArea's inline `display: table` defeats truncation. Keep these rules
narrow. The scroll rule deliberately overrides inline display; the motion reset still wins over
all upstream motion. The sidebar's existing selected-row CSS already owns its color;
no duplicate class patch is needed.

### Stock sidebar shortcut

There are no intentional patches left in `ui/`. Keep Sidebar's built-in Mod+B listener alongside
Piano's Mod+K command palette. Its controlled `open` prop connects the shortcut to Piano's desktop
sidebar, including the saved collapsed preference. Piano's separate mobile reveal still uses its
layout controls; stock `openMobile` is not connected to that reveal. It composes the same Radix
modal primitive as Sheet, but exposes stationary navigation under a translated live page rather
than moving a sheet over it. The sidebar occupies 75% of the mobile viewport; only a claimed
horizontal drag anywhere on the main content overrides touch scrolling, with browser edges,
editing controls and horizontal scrollers excluded. Drag motion tracks the finger 1:1; on release
the sheet comes to rest open or closed at once. The moving surfaces have compositor
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
   cancellation and dismissal. Physical Safari browser-edge navigation still
   requires a device check.

Upgrades still need review: clean upstream files eliminate customization merges, not API or
visual regressions. Compare against CLI-generated source for this project's registry and aliases,
not raw registry templates with untransformed imports.
