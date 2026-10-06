# Theme "Felt": Linear's motion discipline on Piano's ivory and ebony

Branch `design/felt`. Reference product: Linear. The theme keeps Piano's palette family and
wins on motion, hierarchy and keyboard flow. Every state change is answered by motion that
explains what changed, at a tempo that never makes you wait.

## Tokens

Colour stays in the existing family; the values below are the ones the theme ships. Hex values
are sRGB approximations of the oklch definitions in `web/src/index.css`.

| Token | Day | Night | Role |
| --- | --- | --- | --- |
| `--surface-0` canvas | `oklch(0.967 0.006 85)` ≈ `#F5F3EE` | `oklch(0.155 0.006 270)` ≈ `#16171B` | sidebar and shell |
| `--conversation` sheet | `oklch(0.995 0.002 85)` ≈ `#FEFEFC` | `oklch(0.185 0.006 270)` ≈ `#1E1F24` | the inset conversation sheet |
| `--surface-1` | `oklch(1 0 0)` `#FFFFFF` | `oklch(0.215 0.007 270)` ≈ `#25262C` | composer, prompt cards, code |
| `--surface-2` | `#FFFFFF` | `oklch(0.22 0.007 270)` ≈ `#26272D` | menus, popovers, the palette |
| `--ink` | `oklch(0.22 0.01 85)` ≈ `#2E2C27` | `oklch(0.93 0.005 85)` ≈ `#EBE9E4` | text |
| `--ink-2` | `oklch(0.5 0.012 85)` ≈ `#6E6A62` | `oklch(0.7 0.008 85)` ≈ `#A6A39D` | secondary text |
| `--ink-3` | `oklch(0.6 0.012 85)` ≈ `#8B877F` | `oklch(0.62 0.008 85)` ≈ `#8F8C86` | tertiary text, glyphs |
| `--brand` felt green | `oklch(0.52 0.1 160)` ≈ `#2F8A62` | `oklch(0.74 0.1 160)` ≈ `#6DC79B` | focus ring, send key, the working session, the selection bar, the keys |
| `--busy` / `--done` / `--ok` / `--err` | existing | existing | tool and host status dots |

Green means live and nothing else is green. Tertiary ink was moved further from secondary ink
(0.55 → 0.6 by day) so three text levels read as three.

Motion tokens, also in `index.css`:

| Token | Value | Use |
| --- | --- | --- |
| `--dur-hover` | 120ms | hover, press, colour |
| `--dur-enter` | 200ms | things appearing |
| `--dur-exit` | 150ms | things leaving |
| `--dur-layout` | 320ms | the selection bar, the sidebar width, the link pile |
| `--ease-enter` | `cubic-bezier(0.22, 1, 0.36, 1)` | every entrance |
| `--ease-exit` | `ease-out` | every exit |

## Type

Instrument Sans Variable for the interface, JetBrains Mono for anything verbatim (commands,
paths, branches, usage figures). Two running sizes: 16px for anything you read, 14px for anything
that labels; 12px only in the usage row and keyboard hints. Weights 400/500/600.

Considered and rejected: 15px transcript body. The brief allows it only if the measure stays
under 75ch; at the 48rem column the brief also asks for, 15px Instrument Sans runs to roughly
95ch, so the column would have to narrow to about 38rem to qualify, and the composer would then
feel cramped. The 16px body stays.

## Layout

```
┌──────────┬──────────────────────────────────────────────┐
│ ▮▮▮ piano│  ┌──────────────────────────────────────────┐ │
│ + New  ⌘⇧N  │   › prompt card                          │ │
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
- **Never wait.** Enter 200ms, exit 150ms, hover 120ms, layout 320ms. Interruptible CSS
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
| `⌘[` `⌘]` or `Alt+↑` `Alt+↓` | Previous or next session in sidebar order |
| `⌘B` / `Ctrl+B` | Toggle the sidebar |
| `⌘⇧N` / `Ctrl+Shift+N` | New session |

Shortcuts appear as `Kbd` hints in tooltips and palette rows. Chrome reserves `⌘⇧N` for an
incognito window and cannot be overridden there; the palette offers New session as well.

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
- **Keyboard flow.** A command palette (`CommandPalette`) on `⌘K`, `⌘B`, `⌘⇧N`, `⌘[` / `⌘]` and
  `Alt+↑/↓`, with a small `Shortcut` helper that writes keys the way the platform does.
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

## Evidence

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
