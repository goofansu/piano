# Theme "Moonstone": Lefos's warm palette on Felt's motion discipline

Moonstone makes Piano warm, cozy and friendly in the manner of Earendil's products (earendil.com,
lefos.com, pi.dev) while keeping the quiet UI. It replaces the earlier "Felt" palette (ivory, warm
charcoal and a felt-green accent) and keeps Felt's hierarchy and keyboard flow, described
below. Colours derive from the Lefos palette; `web/src/index.css` is authoritative.

## Palette

Lightness is set by contrast (WCAG 4.5:1 for text, 3:1 for glyphs and meaningful edges) and
chroma is capped so status hues stay earthy, following Earendil's theming principle.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--surface-0` canvas | moonstone `oklch(0.93 0.006 60)` ≈ `#EBE7E4` | midnight `oklch(0.215 0.022 257)` ≈ `#131A24` | sidebar and shell |
| `--conversation` sheet | warm white `oklch(0.962 0.004 75)` ≈ `#F4F2EF` | `oklch(0.25 0.022 257)` ≈ `#1B222C` | the inset conversation sheet |
| `--surface-1` | `oklch(0.978 0.004 75)` ≈ `#F9F7F5` | `oklch(0.285 0.024 257)` ≈ `#232B36` | composer, inputs, user prompts |
| `--surface-2` | `oklch(0.985 0.004 75)` ≈ `#FCFAF7` | evening blue `oklch(0.31 0.024 257)` ≈ `#29313D` | menus, popovers, the palette |
| `--surface-3` | `oklch(0.99 0.003 75)` ≈ `#FDFBFA` | `oklch(0.33 0.024 257)` ≈ `#2E3642` | dialogs and mobile navigation |
| `--line` / `--line-strong` | driftwood at 14% / 24% | parchment at 10% / 18% | edges |
| `--fill` / `-hover` / `-active` | driftwood at 6% / 8% / 10% | parchment at 4% / 6% / 8% | quiet fills, selected rows |
| `--ink` | warm black `oklch(0.2 0.007 60)` ≈ `#181513` | warm-10 `oklch(0.91 0.006 68)` ≈ `#E4E1DD` | text |
| `--ink-2` | warm-40 `oklch(0.44 0.012 62)` ≈ `#58514C` | `oklch(0.8 0.012 62)` ≈ `#C4BCB6` | secondary text |
| `--ink-3` | warm-30, darkened: `oklch(0.48 0.012 62)` ≈ `#635C57` | `oklch(0.76 0.014 60)` ≈ `#B8AFA8` | tertiary text, glyphs |
| `--brand` the one colour | evening blue `oklch(0.36 0.05 257)` ≈ `#2C3E57` | parchment `oklch(0.84 0.04 55)` ≈ `#E0C4B2` | focus ring, send key, live state, selection |
| `--busy` working | sunkissed `oklch(0.58 0.105 75)` ≈ `#9E7027` | `oklch(0.8 0.1 76)` ≈ `#E3B572` | working session |
| `--done` | tidal blue `oklch(0.5 0.06 232)` ≈ `#3E6980` | `oklch(0.75 0.06 232)` ≈ `#88B5CE` | finished, unseen |
| `--ok` idle/success | sage `oklch(0.5 0.07 118)` ≈ `#606939` | `oklch(0.76 0.07 112)` ≈ `#B2B682` | idle, success |
| `--warn` | ochre `oklch(0.52 0.11 62)` ≈ `#955816` | `oklch(0.78 0.11 62)` ≈ `#EAA76B` | warnings |
| `--err` | terracotta `oklch(0.48 0.12 33)` ≈ `#953F2E` | `oklch(0.74 0.11 33)` ≈ `#E7907D` | errors, destructive |
| `--merged` | dusk lilac `oklch(0.5 0.07 320)` ≈ `#75567C` | `oklch(0.76 0.07 320)` ≈ `#C5A3CD` | merged pull requests |
| `--scrim` | umber at 38% | midnight at 62% | behind dialogs and the phone sheet |

- **Light.** A moonstone canvas holds a warm-white sheet; layers 1–3 are warm near-whites that
  lighten as they rise, never pure white, so the composer and menus still separate from the
  sheet. Lines and fills are driftwood; shadows are umber-tinted rather than neutral grey.
- **Dark.** Lefos's dark mode: a midnight canvas, evening-blue layers and warm parchment ink.
  Elevation still adds lightness. Shadows deepen toward midnight; inset highlights are parchment.
- **The one colour.** Felt green is retired. The accent is Lefos's own light/dark pair: evening
  blue in light mode (lifted one step from `#252F3D` so it reads as blue beside warm-black ink) and
  parchment in dark mode (the warm light Lefos sets on evening blue). It still means "live": the send
  key, focus ring, selection, links and the streaming caret. `--brand-ink` is the opposite
  surface, so the send key reads in both modes (9.96:1 in light mode, 10.63:1 in dark mode).
- **States** keep Herdr's meanings with Lefos's earth accents. Light-mode lightness is dropped until
  every status passes 4.5:1 as text on canvas and sheet (busy, used only as a glyph, passes 3:1);
  dark-mode lightness keeps them well above that on every layer. `--warning-foreground` is now
  `--brand-ink` in both modes.
- **Theme switch.** Changing appearance swaps every colour in one frame: next-themes sets
  `disableTransitionOnChange`. A fade was tried and dropped: inherited text and controls with
  their own colour transitions faded on different clocks, so text washed out and faded twice.

### Contrast

WCAG ratios, computed from the tokens (alpha fills composited in sRGB). "Fill" is the lowest
ratio over any layer with `--fill-active` beneath the glyph, as in a selected row.

| Light | canvas | sheet | surface-1 | surface-2 | surface-3 | fill |
| --- | --- | --- | --- | --- | --- | --- |
| ink | 14.73 | 16.22 | 17.00 | 17.35 | 17.60 | 12.86 |
| ink-2 | 6.33 | 6.97 | 7.31 | 7.46 | 7.57 | 5.53 |
| ink-3 | 5.33 | 5.87 | 6.15 | 6.28 | 6.37 | 4.65 |
| brand | 8.83 | 9.73 | 10.19 | 10.40 | 10.56 | 7.71 |
| busy | 3.54 | 3.90 | 4.09 | 4.17 | 4.23 | 3.09 |
| done | 4.80 | 5.29 | 5.55 | 5.66 | 5.74 | 4.19 |
| ok | 4.79 | 5.28 | 5.53 | 5.64 | 5.73 | 4.18 |
| warn | 4.62 | 5.09 | 5.33 | 5.44 | 5.52 | 4.04 |
| err | 5.63 | 6.20 | 6.50 | 6.63 | 6.73 | 4.91 |
| merged | 5.05 | 5.56 | 5.82 | 5.94 | 6.03 | 4.41 |

| Dark | canvas | sheet | surface-1 | surface-2 | surface-3 | fill |
| --- | --- | --- | --- | --- | --- | --- |
| ink | 13.39 | 12.23 | 10.97 | 10.06 | 9.34 | 7.76 |
| ink-2 | 9.36 | 8.54 | 7.66 | 7.02 | 6.52 | 5.42 |
| ink-3 | 8.13 | 7.43 | 6.66 | 6.11 | 5.67 | 4.72 |
| brand | 10.63 | 9.70 | 8.71 | 7.98 | 7.41 | 6.16 |
| busy | 9.27 | 8.47 | 7.60 | 6.96 | 6.46 | 5.38 |
| done | 7.98 | 7.28 | 6.53 | 5.99 | 5.56 | 4.62 |
| ok | 8.26 | 7.54 | 6.77 | 6.20 | 5.76 | 4.79 |
| warn | 8.55 | 7.80 | 7.00 | 6.42 | 5.96 | 4.95 |
| err | 7.28 | 6.65 | 5.96 | 5.46 | 5.07 | 4.22 |
| merged | 7.93 | 7.25 | 6.50 | 5.96 | 5.53 | 4.60 |

Limitation: light-mode status colours drop below 4.5:1 as text over a selected (`--fill-active`) row;
they stay above 3:1 there, which is what their glyph use needs.

Motion has one token, `--ease-out` (see Motion).

## Type

Two system faces and no web fonts: Tailwind's default sans stack for the interface and body
(the transcript, controls, menus, titles), and its default mono stack for anything the machine
produced verbatim (code, commands, paths, branches, the model chip and the usage meta).

Moonstone first added two web fonts, after Earendil's pairing of an italic serif with Departure
Mono: Newsreader for headlines, titles and empty states, and Departure Mono in uppercase for
small labels. Four typefaces, two of them monospace, read as busy rather than warm, so both were
removed; the warmth now comes from the palette alone.

### Links and the selected row

Prose links keep the original style: brand colour with an underline at 35% brand, 0.15em below the
baseline, full brand on hover. The underline is continuous (`text-decoration-skip-ink: none`); the
browser's default skipped descenders and left gaps under p and g.

A selected row is no longer a brand tint (evening blue at 12% read as cool grey on the warm
canvas). `--selected` is parchment: solid `oklch(0.88 0.021 53)` ≈ `#E3D4CB` in light mode and the dark
brand (parchment) at 14% in dark mode. Selected sidebar sessions and the active Settings section use
it, with the title at weight 500. Text on it: ink 12.56 / 9.84, ink-2 5.40 / 6.87, ink-3 4.55 /
5.98, brand 7.53 / 7.81 (light / dark, over the canvas). It separates from the canvas by 1.17 /
1.36 against the hover fill's 1.11 / 1.14, and by hue: warm parchment beside driftwood grey.
Limitation: over surface-3 in dark mode, ink-3 on the selection drops to 4.13; the sidebar never sits
on surface-3, so no shipped pairing uses it.

Body text stays 16px, as does the mobile composer.
Shared UI labels (`text-sm`) are 16px below the shell's 48rem desktop breakpoint and 14px
at or above it; captions (`text-xs`)
are 14px / 12px respectively. This keeps mobile navigation, menus and controls as readable as
the composer without enlarging desktop chrome. Weights 400/500/600.

Considered and rejected: 15px transcript body. The brief allows it only if the measure stays
under 75ch. The 48rem column risks exceeding that measure at 15px, depending on the system
font, and narrowing the column would cramp the composer. The 16px body stays.

## Layout

```
┌──────────┬──────────────────────────────────────────────┐
│ ▮▮▮ piano│  ┌──────────────────────────────────────────┐ │
│ + New    │   › prompt card                          │ │
│          │  │   • reply …                              │ │
│ ▾ project│  │   ● Ran npm test                         │ │
│   ▌sess  │  │   ▮▮▮ ▏                 ← pending reply   │ │
│    sess  │  │                                          │ │
│ ▸ project│  │   [link pile]                            │ │
│          │  │  ┌ composer ───────────────── ▲ ┐         │ │
│          │  │  └───────────────────────────────┘ 4 msgs │ │
└──────────┴──────────────────────────────────────────────┘
```

Left-aligned throughout. The transcript column is centred at max 48rem; the composer lines up
with it. The conversation is an inset sheet with a 1px line and the layer-1 shadow. A parchment
fill marks the selected session. Rows are 36px with a
pointer and 44px on touch screens.

A session row is its title alone. Where it runs and which project it belongs to live in the session
header and the sidebar's groupings, not on every row.

The session header is one line, as Amp's is: the project crumb and the title with its menu
glued to it (`Project / Title ⋯`, a shadcn Breadcrumb), then where the session runs as `folder
⑂ branch` in the Directory picker's shape (no worktree segment: Worktrunk names a worktree after
its branch, and the full path is in the menu's details), and at its end its controls: preview,
pull request. The session's state is the sidebar row's (the keys while it works, a dot
otherwise); the header only announces it to screen readers, since a state is shown once. The
facts run at full length while they fit. When space runs out, folder and branch truncate down
to about 6rem each, then drop out whole from the right, branch first: the row may wrap, but
only its first line shows. The title group never drops and shrinks last. The crumb is hidden on
phones, where the sheet's project page covers it. The branch is in the menu's details beside
the path; the segments carry no tooltips, since they show their own text. The design is in
[session views](session-views.md).

The Surface area (Changes, open files) sits beside the Agent area under the one session header,
on the same sheet, split off by a hairline rather than floating as a second card; the Agent area
has no title. Its views are browser-style tabs on a darker strip, each a small icon, its name and
Close, outlined while pointed at; the shown view's toolbar is a row of its own beneath them, what
it shows on the left and its small-text actions on the right, so naming and closing never mix
with acting. A new view's tab joins the end, Changes included; opening one already open shows it
in place. Tabs that no longer fit scroll sideways. Views at the header's end opens Changes, or
shows it where it is already open. The Surface area's remembered width is a
preference, not a claim on the Agent area: the Agent area keeps at least 448px and the surface
shrinks first, down to 400px. Below 849px of session width (measured after the sidebar, not the
viewport) the areas take turns under Agent and Changes tabs, each at full width.

## Linear

Linear is the design guide: Codex and T3 Code remain references for the web harness around Pi.
What Piano takes from it, in Moonstone's palette:

- **Structure over ornament.** One header shape everywhere (a title with its context beneath,
  controls at the end), hairline dividers instead of spaced cards, small quiet controls (28–32px)
  at the row's end, and the one primary action of a page in its header. Settings pages are
  groups of hairline-divided rows with no intro line: the rows say what the page does. Piano takes Linear's structure and
  restraint, not its chrome: the palette, type and radii stay Moonstone's.
- **State at a glance, once** ([agent interaction guidelines](https://linear.app/developers/aig)
  §4): the sidebar row says whether Pi is working; a `StatusDot` names an app's state in the
  preview control and a webhook's last delivery, so one vocabulary covers every state: busy
  (breathing), ok, warn, err, muted. A state appears in one place. A header dot beside the sidebar
  row's was tried and removed, as the header mark playing beside the rows was before.
- **Instant, unobtrusive feedback** (§3): a dot breathes while something is in progress; a refresh
  control turns its own icon while it reads; a test delivery answers with a toast that names the
  HTTP status.
- **Self-evident, so fewer words.** A control says what it does and no more ("Details", "Add
  webhook", "Save"); the checks every added string passes are [quiet UI](../AGENTS.md#quiet-ui).
- **Confirm what cannot be undone.** Deleting a webhook asks first, as Delete session does.

## Mark

One mark everywhere: the app's logo tile, the small keys in sidebar rows and the transcript, the
favicon and the home-screen icons. `web/src/components/PianoMark.tsx` draws it in the app.

- **Construction.** Solid bars, like Pi's mark: a fallboard across the top and three keys hanging
  from it, left to right white, black, white, with the black key shorter. Read together it is a
  keyboard seen from above and a π with one more leg. A 1-unit gap separates the keys from the
  fallboard, so a pressed key visibly drops away from it. (It began as pixel blocks with 45%
  seams; next to Pi's favicon the seams and thinner keys read too light, so the bars are solid.)
- **Grid.** The logo glyph is 16×16: a 16×4 fallboard, keys 4 wide and 2 apart, white keys 11
  long, the black key 7. The `Keys` glyph for rows and the transcript gutter is about 3/4 of it: keys 3
  wide and 2 apart, a 3-unit fallboard, white keys 8, black key 5, a 13×12 glyph in a 14×12 box.
  (Halving it to 2-wide keys read too thin beside 14px text.) Boxes
  are rounded up to even sides so a centred glyph never lands on half pixels; the tile sizes the
  glyph to a whole multiple of 16px (`round(57.15%, 16px)`): 1× in the 24px footer and 28px
  tiles, 2× in the 48px empty-state tile. `shape-rendering: crispEdges` keeps edges sharp.
- **Colour.** In the app the mark is one colour from tokens: `currentColor` for the glyph (rows
  pass `text-brand`), `text-brand-ink` on `bg-brand` for the tile.
- **Favicon.** `favicon.svg` is the 16×16 glyph alone, edge to edge with
  no tile, as Pi's and Radius's favicons are bare marks (a padded tile left it about half their
  size in a tab strip). One colour follows the system theme: `#111`, or `#f6f6f6` under
  `prefers-color-scheme: dark`. A 16px favicon draws one unit per pixel. It stays the same while a
  session works; progress shows in the app, not the tab icon.
- **App icons.** The home-screen icons (`apple-touch-icon.png` 180, `icon-192.png`, `icon-512.png`,
  `icon-maskable-512.png`) need a background, so the glyph sits on a warm-black `#2c2825` tile at
  16 of 28 units, as in the app, in fixed earth tones: a terracotta `#b86b52` fallboard, sunkissed
  `#e1b06e` white keys and a sage `#a3a473` black key. The apple-touch and maskable icons are
  full-bleed squares; the 192 and 512 icons have a 6/28 corner radius.
- **Animation.** None for the icons; the keys in the app play (see the next section).

## The one memorable element: the keys play

The three-key mark is the instrument's live signal. Wherever Pi is working the keys play a
scale: each dips 1px below the fallboard and dims to 60% in turn, left to right, on a 1.2s cycle.
They rest under the fallboard when Pi finishes. In reduced motion they hold the pressed state
still. (See Motion.)

- In the sidebar row, the keys replace the yellow dot while that session streams.
- In the transcript, the keys are the glyph of the pending reply, with a caret beside them before
  the first token arrives, and stay the glyph while the reply streams.
- With the sidebar collapsed, where no rows are visible, the pane header's show-sidebar control
  carries a breathing busy dot while any session is working.
- The browser tab icon switches to a pressed-keys variant while the session on screen works.

This is the only ornament; everything else is structure.

Considered and rejected: playing the header mark whenever any session works while the sidebar is
expanded. The row already says so; two instruments playing at once is noise.

## Motion

Motion is being redesigned from nothing, a page at a time, each piece added back only with a
reason. It is opt-in: `index.css` ends with a reset that stops all animation and transition except
on an element marked `data-motion` (and spinners, Sonner's toasts and the overlay behind a moving
dialog). The upstream shadcn components in `components/ui/` keep their own motion classes; the
`Piano*` wrappers opt in and the `data-motion` rules retune them.

One curve, `--ease-out` `cubic-bezier(0.23, 1, 0.32, 1)`, for every entrance; exits are 120ms
`ease-out`. Reduced motion keeps the fades and drops the scale.

A dialog or popover exits showing what it showed while open. Closing usually changes the state its
content reads (a receipt settles, a listing stops, a session switches), so `useExitFace` in the
`DialogContent` and `PopoverContent` wrappers plays the exit on an inert copy of the last open face
while the live content hides. Callers keep their overlay mounted and drive `open` from state; they
need not hold their content for the exit. Menus and selects exit live, showing the choice just made.

| Surface | Motion | Why |
| --- | --- | --- |
| Menus, popovers, selects (`anchored`) | 150ms fade and scale 0.96 → 1 from the trigger, no slide | they open from a control; scaling from it says where they came from |
| Tooltips (`tooltip`) | 125ms, same shape; none when moving between tooltips (Radix `instant-open`) | after the first, the delay and the motion are both skipped |
| Dialogs (`dialog`) | 200ms fade and scale 0.96 → 1 from the centre, overlay fading with it | not anchored to a trigger |
| Command palette, model picker | none (`still`) | opened by Mod+K and Mod+/ many times a day |
| Send key (`press`) | scale 0.96 while held, 150ms back | press feedback, mostly for taps |
| Composer ring (`ring`) | border and shadow ease over 150ms on focus and file drag | a colour change of state |
| Attachment added (`enter`) | 150ms fade and scale 0.96 → 1 via `@starting-style` | shows where the image went |
| Composer and New session notices (`fade`) | 150ms fade in | a notice should not pop; scaling a full-width box looks wrong |
| Send ↔ Stop (`swap`) | the two faces cross-fade over 150ms, scale 0.75 ↔ 1 with a 2px blur | one control changing state in place; the blur hides two icons overlapping |
| Fold chevron (`turn`) | rotates over 150ms | confirms which way the fold went; the fold's content opens at once |
| Scroll to bottom (`enter`) | 150ms fade and scale in | otherwise it pops in while reading |
| Delivery picker and queued messages (`fade`) | 150ms fade in | they appear beside and above the composer as you send |
| Transcript, streaming output, fold content, loading placeholder, jumps | none | the transcript never moves under the reader; a jump always lands the message 16px under the top |
| Phone sidebar (`drawer`) | follows the finger 1:1; on release it settles at the finger's speed into a stop (120–420ms); a tap opens or closes it over 300ms on `--ease-drawer` `cubic-bezier(0.32, 0.72, 0, 1)` | a gesture should finish the way it was moving; a tap gets the iOS drawer feel |
| Desktop sidebar collapse (Mod+B or its button), sidebar rows, right sidebar | none | a keyboard shortcut and frequent navigation should answer at once |
| Status dot while in progress (`pulse`) | opacity 1 → 0.3 → 1 on the keys' 1.2s `--ease-in-out` loop; still under reduced motion | the one in-progress sign the preview control and deliveries share; opacity alone stays on the compositor |
| Refresh while reading | the control's own icon turns (`animate-spin`) | the answer arrives where the question was asked, with no second spinner |
| Settings: section switches, loading placeholders giving way to content, notices that replace them, the sign-in dialog's steps | none | navigation and content arriving answer at once, as in the transcript; Settings' folds share the turning chevron and its dialogs the overlay motion |
| Keys while Pi works (`key`) | each key dips 1px and dims to 60% in turn, a 1.2s loop on `--ease-in-out` `cubic-bezier(0.77, 0, 0.175, 1)`, keys 0.4s apart; a CSS animation; reduced motion holds them pressed and still | Piano's one ornament says Pi is alive; a still press could equally mean stuck. Only transform and opacity move, and a CSS animation keeps running smoothly while replies stream |
| New session page entrance | none | seen many times a day, often from the keyboard, with the composer focused to type at once |

One timing behaviour is not motion, because it decides when something shows, not how:

- **Grace period.** The reconnecting pill and loading placeholders (`.late-enter`) wait 600ms
  before appearing, so a quick load never flashes them; they then appear at once.

What the removed motion was is recorded under "What Felt changed and why" below.

## Keyboard flow

| Keys | Action |
| --- | --- |
| `⌘K` / `Ctrl+K` | Command palette: switch to any session (search title, project, branch), start a new session in a project, toggle the sidebar, change appearance |

The palette shortcut appears as a `Kbd` hint on the sidebar search button. The palette also
offers New session, per project, and the sidebar toggle without shortcuts of their own. `⌘B`,
`⌘⇧N`, `⌘[` / `⌘]` and `Alt+↑/↓` were tried and removed as too easy to hit by accident.

## What Felt changed and why

- **Motion tokens** (`--dur-*`, `--ease-enter`, `--ease-exit`) replace scattered durations so
  every control answers at the same tempo. Popovers, menus, tooltips and dialogs scale from
  their anchor at 96 → 100 with no slide; the phone sheet slides with its overlay in step.
- **`PianoMark` plays.** It takes a `playing` prop; a bare `Keys` variant sits in glyph gutters
  and rows. `data-playing` drives the CSS, so reduced motion holds the pressed state with no JS.
- **Sidebar.** Skeleton rows in the real row geometry while projects load; a staggered first
  reveal; one `selection-bar` that slides between rows; the keys replace the yellow dot while a
  session streams; row heights grow to 44px on touch screens; keyboard hints on the hide, search
  and New session controls. The header is the one header shape and no heavier: hide at its left on
  the rows' edge and where each pane's show control appears once the sidebar is collapsed (on desktop
  the sidebar column keeps the pane's frame, `--pane-frame`, and its header is the pane header's
  row, `paneHeaderRow`, so every leading glyph sits `--gutter` in), then search, View options
  and New session as the filled primary action at its end; no mark and no wordmark, so the one
  accent in the strip is the primary action. The mark sits in the footer beside Settings. Collapsed,
  the column is gone rather than a rail: the pane takes the width, and its header's show control
  brings the sidebar back.
- **Transcript.** A skeleton in the transcript's layout is on screen within a frame of a switch
  and cross-fades with the real transcript, which is keyed by session so scroll pinning starts
  fresh. The pending reply row shows the keys and a caret before the first token; the streaming
  reply keeps the keys as its glyph; the caret sits at the end of the last block. Transcript
  updates still never animate.
- **Composer.** It no longer remounts per session, so it never flashes; Send and Stop are one
  control whose face cross-fades; the key scales down on press.
- **Toasts.** Positioned by viewport width; a thin line drains over the toast's life and pauses
  while the stack is hovered.
- **Keyboard flow.** A command palette (`CommandPalette`) on `⌘K`, with a small `Shortcut` helper that writes keys the way the platform does.
- **Reconnecting** shows as a quiet pill after a 600ms grace period, so a blink of the socket
  never flashes it. Session not found says what probably happened.
- **Tab icon** is now the keys, with a pressed variant while the session on screen works.
- **Tertiary ink** moved further from secondary ink.

Considered and rejected:

- A real cross-fade between New and Session via the View Transitions API. It snapshots the whole
  page, including the sidebar, and the transcript's scroll pin runs after the snapshot is taken,
  so the old frame would show the top of the conversation. The sheet content fades and rises
  instead, which reads as a cross-fade against the sheet's own colour.
- Playing the header mark whenever any session works while the sidebar is open (see above).
- Bottom-right toasts on desktop (see Motion principles).
- 15px transcript body (see Type).
- A spinner anywhere a skeleton could stand in. The spinner remains only inside controls that
  are genuinely waiting on one request: model refresh, image reading, worktree creation, and
  the reconnecting pill.

## Tests

- `test/browser-ui-polish.mjs` now takes `PIANO_TEST_BACKEND_PORT` and `PIANO_TEST_WEB_PORT`
  (defaults unchanged at 7171/7172) so it can run beside other instances, and its reduced-motion
  caret check reads the caret where it now lives, at the end of the reply's last block.
- Known failures unrelated to this theme: three server tests (`RealPiProjection` ×2 and the
  `INV-07/08` worktree manifest test) fail identically on the base commit 9e0c7b4 in this
  environment, and `PiSessions` "catalog observations" failed once in a full run on a macOS
  `/private/var` vs `/var` path comparison and passed on three isolated reruns.

## Moonstone verification

Observed on branch `warm/1-foundation` with a scratch backend/UI on loopback 7191/7192, a scratch
SQLite registry seeded with a throwaway repository and two fixture sessions, and
`test/fake-host-pi.mjs` (no model calls; INV-07/09/11 untouched). agent-browser screenshots cover
a conversation, New session, Settings, the View options menu, the command palette and a sign-in
dialog, light and dark, at 1440×900 and 390×844. Switching Appearance from
the menu sampled the body background through intermediate oklab values for about 350ms; with
reduced motion the switch was immediate. Contrast figures above are computed, not measured from
pixels.

## Felt-era dark palette verification

This records the previous warm-charcoal dark palette, since replaced by Moonstone.


Verified on base `71698de` plus the dark-token changes, with Node 24.21.0 and headless
Chromium 154 on Linux. Scratch backend/UI: loopback 7171/7172, separate SQLite registry,
throwaway repository and `test/fake-host-pi.mjs`; no model calls or hosted-instance changes
(INV-07/09/11). Evidence: `/tmp/piano-dark-theme-GgJtU4/`.

- Agent-browser screenshots cover the transcript, selected sidebar row, model picker, command
  palette, deletion dialog (cancelled), Changes diff, appearance settings and mobile navigation/New.
  Checked 1440×1000 and 390×844; System appearance remained dark after reload with dark media.
- Browser-resolved colours, composited into sRGB, meet 4.5:1 for the ten ink/brand/status tokens
  across all five base surfaces with each individual neutral/selection/error fill. The lowest
  tertiary-ink pairing is 4.58:1. Sampled rendered text also passes, including the deletion
  button's actual translucent background (4.63:1) and selected model/palette metadata (5.17:1).
- `npm test`: 125 passed; `npm run typecheck` and `npm run lint`: passed. No new unit test for
  aesthetic token values; browser observation and contrast measurements address the changed risk.
- Source comparison confirms all non-dark CSS is unchanged, apart from comments. Light appearance
  was visually rechecked, not redesigned. Its existing contrast limitations remain out of scope.

These are bounded colour checks, not a whole-app accessibility certification. The automatic axe
scan had incomplete contrast checks, so it is not used as proof. Actual displays, other browser
engines, diagram-library palettes and every possible stacked transparency were not verified.

## Felt-era evidence

Observed against the scratch fixture on backend 7181 and Vite 7182 with agent-browser session
`piano-felt`. Everything is kept under the session scratchpad
`/private/tmp/claude-501/-Users-james--herdr-worktrees-piano-design-felt/2d980632-b31d-417f-a140-55a753c6346e/scratchpad/`:

- `shots/` numbered screenshots: baseline, session light/dark, working state with the keys and
  Stop, palette light/dark/filtered, session switch with the selection bar, loading skeletons
  with the reconnecting pill (backend paused), New page with directory and model pickers in both
  appearances, the collapsed sidebar, phone session/sheet/New/palette, session menu, rename and delete dialogs,
  creating a session from New.
- `evidence/ui-polish/` the browser polish run (screenshots, `commands.json`,
  `observations.json`) and `evidence/final-tests.txt` for typecheck and module tests.
- `evidence/ui-polish-base/` the same check against the base commit, showing the synthetic
  paste step fails identically on this host (headless Chromium on macOS does not paste on a
  synthetic Control+V), so the full run here skipped only that assertion.
