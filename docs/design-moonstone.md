# Theme "Moonstone"

Colours derive from the Lefos palette; `web/src/index.css` is authoritative.

## Palette

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
  §4): the sidebar row says whether Pi is working; a `StatusDot` names an answered question's
  outcome and a webhook's last delivery, so one vocabulary covers every state: busy
  (breathing), ok, warn, err, muted. A state appears in one place. A header dot beside the sidebar
  row's was tried and removed, as the header mark playing beside the rows was before.
- **Instant, unobtrusive feedback** (§3): a dot breathes while something is in progress; a refresh
  control turns its own icon while it reads; a test delivery answers with a toast that names the
  HTTP status.
- **Self-evident, so fewer words.** A control says what it does and no more ("Details", "New
  webhook", "Save"); the checks every added string passes are [quiet UI](quiet-ui.md#checks).
- **Confirm what cannot be undone.** Deleting a webhook asks first, as Delete session does.

## The one memorable element: the keys play

Wherever Pi is working the three-key mark plays. This is the only ornament; everything else is
structure.

## Motion

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
