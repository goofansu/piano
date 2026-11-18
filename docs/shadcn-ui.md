# shadcn ownership and upgrades

`web/src/components/ui/` is upstream source, not Piano's design layer. The project uses the
Radix base and the Vega style (`radix-vega` in `components.json`, chosen on
[shadcn/create](https://ui.shadcn.com/create) for keeping Lucide, `rounded-md` and 36px controls).
Standard controls import from `ui/`; customized controls import the
app components below. App wrappers forward props and refs and compose caller event handlers.
The CLI also owns `web/src/hooks/use-mobile.ts`.

Always exclude upstream shadcn source from formatting, import sorting and general linting:
`ignorePatterns` in `.oxfmtrc.json`, while `components/ui/` keeps its own `.oxlintrc.json`;
[Formatting and lint](development.md#formatting-and-lint) says what that config checks. This includes generated hooks and other
dependencies outside `components/ui/`: add a specific exclusion whenever the CLI introduces another
upstream-owned path. Keep Piano-owned hooks and wrappers checked; do not exclude their whole
directories. Preserve upstream formatting as well as behavior.

`web/components.json` deliberately sets `rsc: true` to preserve upstream `"use client"` directives
in generated files. Piano is still a client-side Vite app: this CLI option does not enable React
Server Components, and those directives do not change its runtime behavior. Keep the directives
as generated rather than stripping them. This also avoids the order-dependent stripping observed
with the shadcn CLI's `rsc: false` transformer.

## Where customizations belong

Wrappers merge only Piano's changes, not copies of upstream class lists. Custom button/badge/alert
variants pass `variant={null}` to avoid inheriting an unrelated upstream variant's hover/dark rules.
Motion is opt-in: the reset at the end of `index.css` stops upstream motion except on elements a
`Piano*` wrapper marks `data-motion`, whose rules retune the upstream classes.

### Responsive ownership

Use [one-area-at-a-time and side-by-side](glossary.md) for session layouts, not device names.
Three independent signals retain distinct owners:

- `panelLayout.ts` owns capacity: the actual areas-container width after sidebar/insets.
- `viewportLayout.ts` owns the application's presentation query, `min-width: 48rem`, matching
  CSS `md`; `useNarrowViewport.ts` is its logical complement.
- Pointer capability owns touch sizing and input behavior, not either layout decision.

The stock provider and Settings tooltip still use upstream `hooks/use-mobile.ts`, whose
`isMobile` can disagree with CSS and the application at fractional widths or a non-default
browser font baseline. Neither upstream consumer owns session capacity.

### Stock sidebar shortcut

`ui/sidebar.tsx` carries one intentional patch in `ui/`, marked `Piano patch` in its source: an
optional `keyboardShortcut` provider prop (default `true`) that disables the stock listener
entirely. `AppLayout` passes `keyboardShortcut={false}`; Piano's one listener lives in
`useSidebarLayoutController`. It toggles on ⌘B alone: upstream also takes Ctrl+B, which on macOS
moves the caret back a character in text fields and elsewhere is the browser's or a field's own,
and takes ⌘ chords with Shift or Alt, which belong to the browser
([shadcn-ui/ui#11418](https://github.com/shadcn-ui/ui/pull/11418)). Stock `openMobile` is not
connected to Piano's reveal.

During a sidebar drag, do not update inherited motion variables per frame: that invalidates
styles across the transcript and navigation.

## Upgrade procedure

1. From `web/`, preview `npx shadcn@latest add <component> --dry-run`, then
   `npx shadcn@latest add <component> --dry-run --diff <file>`. Include transitive components,
   dependency and CSS changes in the review.
2. Take reviewed upstream source changes without carrying local component patches, except the
   [sidebar shortcut opt-out](#stock-sidebar-shortcut). Avoid
   overwriting `index.css`, app wrappers or unrelated dependencies as a side effect.
   The `--diff` for `sidebar.tsx` shows removal of the `keyboardShortcut` prop, its default and
   effect guard/dependency. These hunks revert Piano, not upstream changes: restore the opt-out
   after writing the file. Confirm `AppLayout` still disables the stock listener and only the
   application listener handles ⌘B. If upstream supplies an equivalent opt-out, adopt it and drop
   the patch without enabling two listeners.
3. Check changed props, slots and internal composition against app wrappers. In particular,
   upstream composites import their own `ui/` children: they do not automatically use Piano
   wrappers. `PianoCommand` composes its own dialog, and `PianoSidebarMenuButton` its own tooltip.
4. Before the change, capture the surfaces it touches with
   `node test/browser/style-shots.mjs <before-dir>` (transcript with open tool rows, model picker,
   session menu, palette, settings, phone layout, light and dark). After it, run the repository
   gates and `npm run test:browser`, capture again into a second directory and compare the pairs.
   Then observe the rest through `agent-browser` on a scratch instance: pointer and keyboard
   focus, Mod+K, ⌘B twice in wide and narrow viewports, including a 20px browser default font
   (48rem = 960px), and Ctrl+B, ⌘⇧B, ⌘⌥B leaving the sidebar alone; touch focus, the narrow sidebar reveal and finger tracking,
   cancellation and dismissal. Physical Safari browser-edge navigation still
   requires a device check.

Upgrades still need review: clean upstream files eliminate customization merges, not API or
visual regressions. Compare against CLI-generated source for this project's registry and aliases,
not raw registry templates with untransformed imports.
