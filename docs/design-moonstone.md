# Theme "Moonstone"

Colours derive from the Lefos palette; `web/src/index.css` is authoritative.

## Palette

Lightness is set by contrast (WCAG 4.5:1 for text, 3:1 for glyphs and meaningful edges) and
chroma is capped so status hues stay earthy. Roles: `--surface-0` sidebar and shell,
`--conversation` the sheet, `--surface-1` composer, inputs and user prompts, `--surface-2` menus
and popovers, `--surface-3` dialogs and mobile navigation; `--busy` working, `--done` finished
and unseen, `--ok` idle or success, `--warn`, `--err` errors and destructive, `--merged`.

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

Limitation: light-mode status colours drop below 4.5:1 as text over a selected (`--fill-active`)
row; they stay above 3:1 there, which is what their glyph use needs.

## Type

Two system faces and no web fonts: Tailwind's default sans stack for the interface and body
(the transcript, controls, menus, titles), and its default mono stack for anything the machine
produced verbatim (code, commands, paths, branches, the model chip and the usage meta).

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
- **Self-evident, so fewer words.** A control says what it does and no more ("Details", "New
  webhook", "Save"); the checks every added string passes are [quiet UI](quiet-ui.md#checks).
- **Confirm what cannot be undone.** Deleting a webhook asks first, as Delete session does.

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
| Desktop sidebar collapse (⌘B or its button), sidebar rows, right sidebar | none | a keyboard shortcut and frequent navigation should answer at once |
| Status dot while in progress (`busy` tone) | opacity 1 → 0.3 → 1 on the keys' 1.2s `--ease-in-out` loop; still under reduced motion | the one in-progress sign the preview control and deliveries share; opacity alone stays on the compositor |
| Refresh while reading | the control's own icon turns (`animate-spin`) | the answer arrives where the question was asked, with no second spinner |
| Settings: section switches, loading placeholders giving way to content, notices that replace them, the sign-in dialog's steps | none | navigation and content arriving answer at once, as in the transcript; Settings' folds share the turning chevron and its dialogs the overlay motion |
| Keys while Pi works (`key`) | each key dips 1px and dims to 60% in turn, a 1.2s loop on `--ease-in-out` `cubic-bezier(0.77, 0, 0.175, 1)`, keys 0.4s apart; a CSS animation; reduced motion holds them pressed and still | Piano's one ornament says Pi is alive; a still press could equally mean stuck. Only transform and opacity move, and a CSS animation keeps running smoothly while replies stream |
| New session page entrance | none | seen many times a day, often from the keyboard, with the composer focused to type at once |

One timing behaviour is not motion, because it decides when something shows, not how:

- **Grace period.** The reconnecting pill and loading placeholders (`.late-enter`) wait 600ms
  before appearing, so a quick load never flashes them; they then appear at once.

What the removed motion was is recorded under "What Felt changed and why" below.

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
