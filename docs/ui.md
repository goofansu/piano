# UI

How Piano looks and how its components are built. The rules for wording and behavior are in
[UX](ux.md).

## Theme "Moonstone"

Colours derive from the Lefos palette; `web/src/index.css` is authoritative.

### Palette

Lightness is set by contrast (WCAG 4.5:1 for text, 3:1 for glyphs and meaningful edges) and
chroma is capped so status hues stay earthy. Roles: `--layer-0` sidebar and shell,
`--conversation` the sheet, `--layer-1` composer, inputs and user prompts, `--layer-2` menus
and popovers, `--layer-3` dialogs and mobile navigation; `--busy` working, `--done` finished
and unseen, `--ok` idle or success, `--warn`, `--err` errors and destructive, `--merged`.

- **The one colour.** `--brand` means "live": the send key, focus ring, selection, links and the
  streaming caret. `--brand-ink` is the opposite surface.
- **Theme switch.** next-themes sets `disableTransitionOnChange`. A fade was tried and dropped:
  inherited text and controls with their own colour transitions faded on different clocks.

Limitation: light-mode status colours drop below 4.5:1 as text over a selected (`--fill-active`)
row; they stay above 3:1 there, which is what their glyph use needs.

### Type

Two system faces and no web fonts: Tailwind's default sans stack for the interface and body
(the transcript, controls, menus, titles), and its default mono stack for anything the machine
produced verbatim (code, commands, paths, branches, the model chip and the usage meta).

### Linear

Linear is the design guide: Codex and T3 Code remain references for the web harness around Pi.
What Piano takes from it, in Moonstone's palette:

- **Structure over ornament.** One header shape everywhere (a title with its context beneath,
  controls at the end), hairline dividers instead of spaced cards, small quiet controls (28–32px)
  at the row's end, and the one primary action of a page in its header. Settings pages are
  groups of hairline-divided rows with no intro line: the rows say what the page does. Piano takes Linear's structure and
  restraint, not its chrome: the palette, type and radii stay Moonstone's.
- **State at a glance, once** ([agent interaction guidelines](https://linear.app/developers/aig)
  §4): the sidebar row says whether Pi is working; a `StatusDot` names an answered question's
  outcome and a webhook's last delivery, so one vocabulary covers every state: busy
  (breathing), ok, warn, err, muted. A state appears in one place. A header dot beside the sidebar
  row's was tried and removed, as the header mark playing beside the rows was before.
- **Instant, unobtrusive feedback** (§3): a dot breathes while something is in progress; a refresh
  control turns its own icon while it reads; a test delivery answers with a toast that names the
  HTTP status.
- **Self-evident, so fewer words.** A control says what it does and no more ("Details", "New
  webhook", "Save"); the checks every added string passes are [quiet UI](ux.md#checks).
- **Confirm what cannot be undone.** Deleting a webhook asks first, as Delete session does.

### The one memorable element: the keys play

Wherever Pi is working the three-key mark plays. This is the only ornament; everything else is
structure.

### Motion

Motion is opt-in: `index.css` ends with a reset that stops all animation and transition except
on an element marked `data-motion` (and spinners, Sonner's toasts and the overlay behind a moving
dialog). The upstream shadcn components in `components/ui/` keep their own motion classes; the
`Piano*` wrappers opt in and the `data-motion` rules retune them. Each piece is added only with
a reason.

One curve, `--ease-out`, for every entrance; exits are 120ms `ease-out`. Reduced motion keeps the
fades and drops the scale.

| Surface | Motion | Why |
| --- | --- | --- |
| Command palette, model picker | none (`still`) | opened by Mod+K and Mod+/ many times a day |
| Transcript, streaming output, fold content, loading placeholder, jumps | none | the transcript never moves under the reader |
| Desktop sidebar collapse (⌘B or its button), sidebar rows, right sidebar | none | a keyboard shortcut and frequent navigation should answer at once |
| Refresh while reading | the control's own icon turns (`animate-spin`) | the answer arrives where the question was asked, with no second spinner |
| Settings: section switches, loading placeholders giving way to content, notices that replace them, the sign-in dialog's steps | none | navigation and content arriving answer at once |
| New session page entrance | none | seen many times a day, often from the keyboard |

A spinner never stands in where a skeleton could: it remains only inside controls that are
genuinely waiting on one request.


## shadcn ownership and upgrades

`web/src/components/ui/` is upstream source, not Piano's design layer. The project uses the
Base UI base and the Vega style (`base-vega` in `components.json`, chosen on
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

### Where customizations belong

Wrappers merge only Piano's changes, not copies of upstream class lists. Custom button/badge/alert
variants pass `variant={null}` to avoid inheriting an unrelated upstream variant's hover/dark rules.
Motion is opt-in: the reset at the end of `index.css` stops upstream motion except on elements a
`Piano*` wrapper marks `data-motion`, whose rules retune the upstream classes.

#### Responsive ownership

Use [one-area-at-a-time and side-by-side](../GLOSSARY.md) for session layouts, not device names.
Three independent signals retain distinct owners:

- `panelLayout.ts` owns capacity: the actual areas-container width after sidebar/insets.
- `viewportLayout.ts` owns the application's presentation query, `min-width: 48rem`, matching
  CSS `md`; `useNarrowViewport.ts` is its logical complement.
- Pointer capability owns touch sizing and input behavior, not either layout decision.

The stock provider and Settings tooltip still use upstream `hooks/use-mobile.ts`, whose
`isMobile` can disagree with CSS and the application at fractional widths or a non-default
browser font baseline. Neither upstream consumer owns session capacity.

#### Base UI conventions

- Compose with `render`. A link that looks like a button is a `PianoLinkButton` or `IconLink`,
  not a `Button` rendering an anchor: Base UI's Button gives a non-button element `role="button"`.
- A closed overlay returns focus through `finalFocus`. Piano returns it only after a keyboard
  close, using `keyboardFocusReturn` or `focusReturn`. Base UI focuses whatever a `finalFocus`
  function returns even when focus has already moved, so a custom one checks `focusMovedOn()`.
- Base UI tooltips are visual only: they add no `role="tooltip"` and no `aria-describedby`. Give
  the trigger an accessible name that carries what the tooltip says.
- A single-choice `ToggleGroup` is a group of pressed buttons, not a radio group. Keep one item
  pressed by ignoring the empty value Base UI reports when the pressed item is pressed again.

#### Patches in `ui/`

Each is marked `Piano patch` in its source and must be restored after an upgrade overwrites the
file.

**Popover Positioner props.** Base UI positions an overlay on its `Positioner`, which the stock
wrappers do not expose. `ui/popover.tsx` forwards two of its props. `anchor` places a popover that
has no trigger: the slash-command list against the composer and the quote pill against a text
selection. `collisionPadding` keeps the full-width model picker and usage list centred on a
phone; without it they sit 5px from one screen edge. Drop the patch when upstream forwards them.

Menus, tooltips and selects are stock and use Base UI's defaults: a 5px collision padding and
the `z-50` layer. A popup opened from inside a dialog or the sidebar reveal still lands on top
because its portal is added to the page later.

**Unused import.** `ui/scroll-area.tsx` ships `import * as React` without using it, which fails
`noUnusedLocals`; the line is removed.

#### Stock sidebar shortcut

`ui/sidebar.tsx` carries the third patch, marked the same way: an
optional `keyboardShortcut` provider prop (default `true`) that disables the stock listener
entirely. `AppLayout` passes `keyboardShortcut={false}`; Piano's one listener lives in
`useSidebarLayoutController`. It toggles on ⌘B alone: upstream also takes Ctrl+B, which on macOS
moves the caret back a character in text fields and elsewhere is the browser's or a field's own,
and takes ⌘ chords with Shift or Alt, which belong to the browser
([shadcn-ui/ui#11418](https://github.com/shadcn-ui/ui/pull/11418)). Stock `openMobile` is not
connected to Piano's reveal.

During a sidebar drag, do not update inherited motion variables per frame: that invalidates
styles across the transcript and navigation.

### Upgrade procedure

1. From `web/`, preview `npx shadcn@latest add <component> --dry-run`, then
   `npx shadcn@latest add <component> --dry-run --diff <file>`. Include transitive components,
   dependency and CSS changes in the review.
2. Take reviewed upstream source changes without carrying local component patches, except the
   [patches in `ui/`](#patches-in-ui). Avoid
   overwriting `index.css`, app wrappers or unrelated dependencies as a side effect.
   The `--diff` for a patched file shows the patch being removed: for `sidebar.tsx`, the
   `keyboardShortcut` prop, its default and effect guard/dependency. These hunks revert Piano,
   not upstream changes: restore them after writing the file. Confirm `AppLayout` still disables the stock listener and only the
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
