# Theme "Felt": Linear's motion discipline on Piano's ivory and warm charcoal

Branch `design/felt`. Reference product: Linear. The theme keeps Piano's palette family and
wins on motion, hierarchy and keyboard flow. Every state change is answered by motion that
explains what changed, at a tempo that never makes you wait.

## Tokens

Colour stays in the existing family; `web/src/index.css` is authoritative. The light palette
is unchanged. Night's sRGB approximations below describe the warm-charcoal refinement, not
an inversion of the light theme.

| Token | Day | Night | Role |
| --- | --- | --- | --- |
| `--surface-0` canvas | `oklch(0.967 0.006 85)` | `oklch(0.195 0.004 75)` ≈ `#161513` | sidebar and shell |
| `--conversation` sheet | `oklch(0.995 0.002 85)` | `oklch(0.225 0.005 75)` ≈ `#1D1B19` | the inset conversation sheet |
| `--surface-1` | `#FFFFFF` | `oklch(0.255 0.006 75)` ≈ `#252220` | composer and card surfaces |
| `--surface-2` | `#FFFFFF` | `oklch(0.28 0.007 75)` ≈ `#2B2825` | menus, popovers, the palette |
| `--surface-3` | `#FFFFFF` | `oklch(0.3 0.007 75)` ≈ `#302D2A` | dialogs and mobile navigation |
| `--ink` | `oklch(0.22 0.01 85)` | `oklch(0.91 0.012 85)` ≈ `#E5E1D9` | soft ivory text |
| `--ink-2` | `oklch(0.5 0.012 85)` | `oklch(0.78 0.012 85)` ≈ `#BBB7AF` | secondary text |
| `--ink-3` | `oklch(0.6 0.012 85)` | `oklch(0.725 0.012 85)` ≈ `#A9A69E` | tertiary text, glyphs |
| `--brand` felt green | `oklch(0.52 0.1 160)` | `oklch(0.75 0.09 160)` ≈ `#79C09A` | focus ring, send key, live state, selection and keys |

### Dark palette rationale

- **Warm, not sepia.** Very low-chroma charcoal replaces the blue-black foundation. Each
  elevated layer gets a little lighter, so the composer, menus and dialogs remain distinct
  without glaring borders. Lines, fills and inset highlights share the ivory hue.
- **Less glare, not less legibility.** Main text is softer than white. Secondary and tertiary
  inks are lifted to stay readable on raised and selected surfaces; hierarchy is deliberately
  gentler than by day. Hover/active fills are restrained rather than washing out small labels.
- **Colour stays purposeful.** Felt green is slightly desaturated. Status hues keep their
  established meanings with muted amber (working/warning), teal (done), sage (success), coral
  (error) and lilac (merged). Soft selection/error tints do not compete with the conversation.
  Filled warning surfaces use dark ink rather than light text on amber.
- **Shared tokens, not component exceptions.** The refinement lives in `.dark`; the light
  palette, component composition, layout and motion remain unchanged.

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

The shared layout refactor promotes the session sidebar's actual 300ms easing to layout tokens.
The previous 320ms token/documentation did not drive either sidebar: Settings used 200ms linear.
Both pages now use one width-bearing surface, one persisted width/collapse preference, and one
persistent inset main card. Content activation uses the same 200ms entrance without remounting
session content; the card's 360ms first-load entrance runs only when the shell mounts. Mobile
navigation retains the shared Sheet's 300ms entrance / 200ms exit and focus policy.

## Type

Tailwind's default `font-sans` for the interface and `font-mono` for anything verbatim
(commands, paths, branches, usage figures), without bundled fonts or custom family overrides.
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
with it. The conversation is an inset sheet with a 1px line and the layer-1 shadow. One felt-green
bar in the sidebar marks the selected session and slides between rows. Rows are 36px with a
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

## What changed and why

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

## Dark palette verification

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

## Original Felt evidence

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
