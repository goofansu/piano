# shadcn ownership and upgrades

`web/src/components/ui/` is upstream source, not Piano's design layer. The project uses the
Radix/new-york registry. Standard controls import from `ui/`; customized controls import the
app components below. App wrappers forward props and refs and compose caller event handlers.

## Where customizations belong

| Concern | Owner outside `ui/` |
| --- | --- |
| Borderless/rail button variants | `PianoButton` |
| Status badge and warning alert variants | `StatusBadge`, `PianoAlert` |
| Overlay surfaces, stacking and motion | `PianoDialog`, `PianoSheet`, `PianoSelect`, `PianoPopover`, `PianoDropdownMenu`, `PianoTooltip`; shared `lib/overlayStyles.ts` |
| Pointer-close focus; keyboard/hover tooltips | `PianoPopover`, `PianoDropdownMenu`, `PianoTooltip`; shared `lib/pointerClose.ts` |
| Trailing radio check | `PickerRadioItem`, composed from Radix because shadcn exposes no indicator slot |
| Search/option row heights, including touch and the palette dialog | `PianoCommand` |
| Skeleton fill | `PianoSkeleton` |
| Settings sidebar tooltip policy | `PianoSidebarMenuButton` |
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

### The one retained patch

`ui/sidebar.tsx` omits the built-in Mod+B listener and its constant. Upstream has no opt-out prop.
Preserve the `piano:` comment and omitted listener; do not intercept browser keyboard events to
cancel it. Mod+K remains Piano's only global shortcut.

## Upgrade procedure

1. From `web/`, preview `npx shadcn@latest add <component> --dry-run`, then
   `npx shadcn@latest add <component> --dry-run --diff <file>`. Include transitive components,
   dependency and CSS changes in the review.
2. Take reviewed upstream source changes; preserve only the sidebar shortcut patch. Avoid
   overwriting `index.css`, app wrappers or unrelated dependencies as a side effect.
3. Check changed props, slots and internal composition against app wrappers. In particular,
   upstream composites import their own `ui/` children: they do not automatically use Piano
   wrappers. `PianoCommand` composes its own dialog, and `PianoSidebarMenuButton` its own tooltip.
4. Run the repository gates and the affected scratch-browser journey. For picker/overlay changes,
   `node test/browser-command-palette.mjs <evidence-directory>` checks desktop/mobile palette
   navigation, row sizing, light/dark pickers, trailing checks, pointer/keyboard focus, Mod+B,
   touch focus, sheet timing and reduced motion. It uses fake Pi and no paid model calls.

Upgrades still need review: clean upstream files eliminate customization merges, not API or
visual regressions. Formatting and `"use client"` differences in legacy files are not product
customizations.
