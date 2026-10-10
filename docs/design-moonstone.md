# Theme "Moonstone": Lefos's warm palette on Felt's motion discipline

Moonstone makes Piano warm, cozy and friendly in the manner of Earendil's products (earendil.com,
lefos.com, pi.dev) while keeping the quiet UI. It replaces the earlier "Felt" palette (ivory, warm
charcoal and a felt-green accent) and keeps Felt's motion, hierarchy and keyboard flow, described
below. Colours derive from the Lefos palette; `web/src/index.css` is authoritative.

## Palette

Lightness is set by contrast (WCAG 4.5:1 for text, 3:1 for glyphs and meaningful edges) and
chroma is capped so status hues stay earthy, following Earendil's theming principle.

| Token | Day | Night | Role |
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

- **Day.** A moonstone canvas holds a warm-white sheet; layers 1–3 are warm near-whites that
  lighten as they rise, never pure white, so the composer and menus still separate from the
  sheet. Lines and fills are driftwood; shadows are umber-tinted rather than neutral grey.
- **Night.** Lefos's night: a midnight canvas, evening-blue layers and warm parchment ink.
  Elevation still adds lightness. Shadows deepen toward midnight; inset highlights are parchment.
- **The one colour.** Felt green is retired. The accent is Lefos's own day/night pair: evening
  blue by day (lifted one step from `#252F3D` so it reads as blue beside warm-black ink) and
  parchment by night (the warm light Lefos sets on evening blue). It still means "live": the send
  key, focus ring, selection, links and the streaming caret. `--brand-ink` is the opposite
  surface, so the send key reads in both modes (9.96:1 by day, 10.63:1 by night).
- **States** keep Herdr's meanings with Lefos's earth accents. Day lightness is dropped until
  every status passes 4.5:1 as text on canvas and sheet (busy, used only as a glyph, passes 3:1);
  night lightness keeps them well above that on every layer. `--warning-foreground` is now
  `--brand-ink` in both modes.
- **Theme switch.** Changing appearance fades the shells' background, text and border colours
  (body, sidebar, conversation sheet, composer) over `--dur-theme` 350ms with Earendil's
  `cubic-bezier(0.333, 0, 0.667, 1)`, shorter than Earendil's 900ms so the app never makes you
  wait. next-themes no longer sets `disableTransitionOnChange`, so controls with their own colour
  transitions follow at their own tempo; everything else switches at once. Reduced motion disables
  the fade with every other transition.

### Contrast

WCAG ratios, computed from the tokens (alpha fills composited in sRGB). "Fill" is the lowest
ratio over any layer with `--fill-active` beneath the glyph, as in a selected row.

| Day | canvas | sheet | surface-1 | surface-2 | surface-3 | fill |
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

| Night | canvas | sheet | surface-1 | surface-2 | surface-3 | fill |
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

Limitation: day status colours drop below 4.5:1 as text over a selected (`--fill-active`) row;
they stay above 3:1 there, which is what their glyph use needs.

Motion tokens, also in `index.css`:

| Token | Value | Use |
| --- | --- | --- |
| `--dur-hover` | 120ms | hover, press, colour |
| `--dur-enter` | 200ms | things appearing |
| `--dur-exit` | 150ms | things leaving |
| `--dur-layout` | 300ms | shared desktop sidebar width |
| `--ease-layout` | `cubic-bezier(0.32, 0.72, 0, 1)` | shared desktop sidebar width |
| `--ease-enter` | `cubic-bezier(0.22, 1, 0.36, 1)` | every entrance |
| `--ease-exit` | `ease-out` | every exit |
| `--dur-theme` | 350ms | light/dark colour fade on the shells |
| `--ease-theme` | `cubic-bezier(0.333, 0, 0.667, 1)` | light/dark colour fade |

The shared layout refactor promotes the session sidebar's actual 300ms easing to layout tokens.
The previous 320ms token/documentation did not drive either sidebar: Settings used 200ms linear.
Both pages now use one width-bearing surface, one persisted width/collapse preference, and one
persistent inset main card. Content activation uses the same 200ms entrance without remounting
session content; the card's 360ms first-load entrance runs only when the shell mounts. Mobile
navigation retains the shared Sheet's 300ms entrance / 200ms exit and focus policy.

## Type

Four roles, as tokens in `index.css`:

| Role | Token | Family | Use |
| --- | --- | --- | --- |
| sans | `--font-sans` | Tailwind's default system stack | interface and body: transcript, controls, menus |
| serif | `--font-serif` | Newsreader Variable (`@fontsource-variable/newsreader`, opsz + wght, roman and italic), Georgia fallback | the voice: headlines, page and dialog titles, empty states |
| label | `--font-label` | Departure Mono, self-hosted in `web/src/assets/fonts/departure-mono/` with its OFL licence, `ui-monospace` fallback | small uppercase chrome, 0.05–0.08em tracking |
| mono | `--font-mono` | Tailwind's default mono stack | machine output verbatim: code, commands, paths, branches |

Both new faces are OFL and load with `font-display: swap`. The `static` theme block emits the
variables so plain CSS can use them. Earendil's PlantinNow is licensed and is not used.

### Where each role lives

The serif and the label face are accents, not a font swap: session titles, chat prose, menu
items, buttons and inputs stay sans; code, tool rows, paths and branches stay in the code mono.
The rules sit in the "Type roles, applied" section of `index.css`, unlayered so they replace the
family, size and weight that shadcn's slots set with utilities; no file under `ui/` changed.

| Role | Where | How |
| --- | --- | --- |
| serif, roman | New session headline ("What should we work on?" or the project name): 28px phone / 40px desktop, weight 400, -0.01em, balanced | `voice` class in `NewSession.tsx` |
| serif, italic | New session subtitle (tagline or project goal), 18px, ink-2 | `voice italic` in `NewSession.tsx` |
| serif, 500 | Settings page titles (`SettingsHeader`), 22px | `voice` class |
| serif, 500 | Dialog titles, 20px / 1.25 | `[data-slot="dialog-title"]` |
| serif, 500 / italic | Empty states: `EmptyTitle` 20px; `EmptyDescription` italic at the slot's own size, with `font-size-adjust: 0.5` so Newsreader's smaller x-height matches the sans (sidebar "No sessions yet", Session not found, No changes, folder picker) | `[data-slot="empty-title"]`, `[data-slot="empty-description"]` |
| label | Sidebar date headings (Today, Yesterday…), ink-3 | `chrome-label` class in `Sidebar.tsx` |
| label | Command palette and picker group headings, ink-3 | `[cmdk-group-heading]` |
| label | Settings section labels ("Use in Pi"), ink-2 | `chrome-label` in `RadiusSettings.tsx` |
| label | The composer's model · effort chip and the usage meta ("2 messages", "1k"), ink-2 | `chrome-label` in `ModelSelect.tsx`, `JumpTo.tsx`, `Composer.tsx` |
| label | Keyboard hints (`Kbd`, `Shortcut`); ⌘ and ⇧ fall back to the system mono | `[data-slot="kbd"]` |

The label face is uppercase with `--tracking-chrome` 0.06em, weight 400 with `font-synthesis:
none` (Departure Mono has one weight; no faux bold), tabular figures, at `--type-chrome`: 11px on
desktop, Departure Mono's native grid, and the caption size (14px) on phones. Its colours pass
4.5:1 as text: ink-3 on canvas 5.33 / 8.13 (day / night) and on surface-2 6.28 / 6.11; ink-2 on
the sheet 6.97 / 8.54 and on surface-1 7.31 / 7.66.

Not given the label face, by judgement:

- **User-provided names.** Folder and project group headers in the sidebar stay sans in their
  own case. Uppercasing a name changes what it says (`piano` vs `Piano`, a project called
  "iOS"), and a name truncates better in a proportional face.
- **The Settings and Piano titles** at the top of the sidebar stay sans as the app's wordmark.
- **The delivery chip** beside the model chip stays sans: it only appears while Pi works, and
  it names a mode rather than a value.

The model chip uppercases the model id for display only (`ALPHA · OFF`); its title and
accessible name keep the id verbatim, and the model list itself stays in the code mono.

### Links and the selected row

The brand is close to ink (1.67:1 by day, 1.26:1 by night), so prose links are told by their
underline: a solid underline at 70% brand, `max(1px, 0.075em)` thick and 0.2em below the
baseline, thickening to `max(2px, 0.12em)` at full brand on hover.

A selected row is no longer a brand tint (evening blue at 12% read as cool grey on the warm
canvas). `--selected` is parchment: solid `oklch(0.88 0.021 53)` ≈ `#E3D4CB` by day and the night
brand (parchment) at 14% by night. Selected sidebar sessions and the active Settings section use
it, with the title at weight 500. Text on it: ink 12.56 / 9.84, ink-2 5.40 / 6.87, ink-3 4.55 /
5.98, brand 7.53 / 7.81 (day / night, over the canvas). It separates from the canvas by 1.17 /
1.36 against the hover fill's 1.11 / 1.14, and by hue: warm parchment beside driftwood grey.
Limitation: over surface-3 at night, ink-3 on the selection drops to 4.13; the sidebar never sits
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

## The one memorable element: the keys play

The three-key mark is the instrument's live signal. Wherever Pi is working the keys play: a
staggered, gentle press and release (each key dips 2px and dims, 1.2s cycle, eased), stopping on
a clean rest when Pi finishes.

- In the sidebar row, the keys replace the yellow dot while that session streams.
- In the transcript, the keys are the glyph of the pending reply, with a caret blinking beside
  them before the first token arrives, and stay the glyph while the reply streams.
- In the collapsed rail, where no rows are visible, the mark plays when any session is working.
- The browser tab icon switches to a pressed-keys variant while the session on screen works.

In reduced motion the keys hold a static pressed state. This is the only ornament; everything
else is structure.

Considered and rejected: playing the header mark whenever any session works while the sidebar is
expanded. The row already says so; two instruments playing at once is noise.

## Motion principles

- **Answer the action.** Motion exists to show what changed. Nothing animates on its own except
  the keys while Pi works and the caret while text streams.
- **Never wait.** Enter 200ms, exit 150ms, hover 120ms, layout 300ms. Interruptible CSS
  transitions and `animate-in/out`, no JS timelines.
- **One orchestrated first load.** Sidebar skeleton rows (glyph + line, the real row geometry)
  appear at once; when projects arrive the real rows fade in with a 20ms stagger capped at eight
  rows and the main sheet rises 10px. There is never a spinner in the middle of an empty screen.
- **Switching sessions.** A transcript skeleton that mirrors the row layout (a prompt card, a
  reply with three lines, a tool row) is on screen within one frame; the real transcript fades in
  over it as it fades out. The composer stays mounted and never flashes; its draft follows the
  session.
- **New ↔ Session.** The sheet content fades and rises 8px. The sidebar selection bar slides to
  the new row; the rows themselves do not move.
- **Send.** The arrow scales down on press; the prompt lands pinned at the bottom with the keys
  and caret already in the pending row. Stop and Send are one control whose face cross-fades.
- **Overlays.** Popovers and menus scale from their anchor (96 → 100) in 160ms; the phone sidebar
  sheet slides with its overlay fading in step.
- **Toasts.** Top-right on desktop, top-centre on phones, with a thin progress line showing the
  time left. The brief asked for bottom-right on desktop; the composer's Send/Stop key lives at
  the bottom right of the column, and the existing browser check asserts a notification must not
  cover Stop, so toasts stay above the work. Recorded as a deliberate deviation.
- **Transcript updates never animate.** Streaming text, tool rows and results append without
  motion so scroll pinning keeps working.
- **Reduced motion** disables every animation and transition and holds the keys pressed; the
  existing browser check asserts zero running animations.

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
  and New session controls. The collapsed rail carries the mark and plays it when any session
  is working.
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
dialog, light and dark, at 1440×900 and 390×844. Both faces were loaded through `document.fonts`
(status `loaded`, display `swap`) and rendered in a temporary overlay. Switching Appearance from
the menu sampled the body background through intermediate oklab values for about 350ms; with
reduced motion the switch was immediate. Contrast figures above are computed, not measured from
pixels.

## Felt-era dark palette verification

This records the previous warm-charcoal night palette, since replaced by Moonstone.


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
  appearances, the rail, phone session/sheet/New/palette, session menu, rename and delete dialogs,
  creating a session from New.
- `evidence/ui-polish/` the browser polish run (screenshots, `commands.json`,
  `observations.json`) and `evidence/final-tests.txt` for typecheck and module tests.
- `evidence/ui-polish-base/` the same check against the base commit, showing the synthetic
  paste step fails identically on this host (headless Chromium on macOS does not paste on a
  synthetic Control+V), so the full run here skipped only that assertion.
