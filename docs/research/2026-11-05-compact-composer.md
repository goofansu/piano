# Mobile pencil launcher: reuse the composer, avoid automatic collapse

November 5, 2026. Research only, against Piano **`d2e82418040886a8f6fcf1d8027b9faee1c57435`**.

**Clarified request:** mobile has less vertical space; can a pencil button open the full existing
composer, working as it does today? This supersedes the original unfocused/empty one-line-editor
idea.

**Implementation follow-up:** the user subsequently approved implementation, automatic collapse after
confirmed acceptance, and reuse of the session rail's **single-area** rule (available session width
below 849px, not device detection or the shell's 768px breakpoint). The accompanying implementation
keeps New/project home expanded, the existing mounted editor, usage/JumpTo, and a collapsed Stop
control. Queues, image feedback and working drafts keep the full editor visible. Only this view's
accepted input can auto-close an unchanged empty draft; later interaction cancels that permission.
The research below records the earlier recommendations and unresolved choices at that time;
its recommendation to defer auto-close is superseded by this follow-up. Verification belongs to the PR.

## Recommendation

**Yes: a mobile-only explicit launcher is a simpler, safer direction than restoring automatic
focus-driven collapse.** Open the existing in-place composer, not a second editor or a modal copy.
Keep it open until the user explicitly closes it. Do not collapse on blur, scroll, empty text,
attachment removal, keyboard dismissal or Send in the first iteration.

Piano tried automatic collapse twice: October 8's merged implementation was reverted to retain
visible model controls and avoid focus-driven layout changes; October 28's [PR #312][H4] was closed
unmerged after identifying lost clicks and shifted selections from resizing the transcript during
focus changes. Explicit open/close removes that automatic cause: layout changes follow an intentional
activation, not a mousedown-induced blur. It does **not** remove the need to check the resize itself,
virtual keyboard behavior, retained drafts, or ongoing work. [H1], [H2], [H3], [H4], [H5], [H6]

Proposed smallest scope: **existing-session Agent area on mobile**, with New and project home still
expanded. Starting a session is a writing task and those pages have directory/project controls
outside the shared editor; this scope is a recommendation, not a user decision. Use the app's narrow
layout breakpoint rather than coarse-pointer detection alone (a touch laptop is not necessarily a
phone); the exact breakpoint remains to choose. [C9], [C10]

```text
Mobile, resting:   [pencil: Compose]             [Stop, when available]
                  existing usage / JumpTo remains below
Mobile, opened:    existing composer, unchanged + Collapse composer
Desktop:          existing composer, unchanged
```

“Pencil only” describes the **idle entry affordance**, not permission to hide operational controls.
Recommend keeping the separate usage/JumpTo row visible initially. Recommend pencil + Stop while
running with an empty draft, derived from the existing Stop contract; an alternative is to keep the
composer expanded while running. The latter costs space but needs less action extraction. The user
has not chosen between them. Do not add an always-enabled Stop that bypasses stopping/read-only rules.
When running with draft content, the current primary becomes Queue/steer/follow-up, not Stop; simplest
first-slice fallback is to keep the full composer visible rather than invent a new busy action policy.

For the smallest safe implementation, also keep the full composer visible while there is queued
input, attachment reading/error feedback or an owned picker open. A queue could later be separated
from the editor, but hiding its Edit action is not an acceptable shortcut. Inline questions and
session notices must remain outside the collapsed region. These constraints reduce the situations
where a pencil is shown, deliberately; exact busy/queue policy needs review. [C1], [C2], [C3], [C4], [C5]

## Proposed state and transition table

Start with one mobile presentation flag, scoped to the session view; no persistent preference,
new draft store or server state. Content and session policy remain authoritative in their existing
modules. Preserve INV-01–05 and INV-07; keep evidence bounded under INV-08–09. See
[direction](../README.md), [invariants](../development-invariants.md), and [Quiet UI](../quiet-ui.md).

| Situation/event | Proposed result | Reason / remaining decision |
| --- | --- | --- |
| Desktop, any focus/draft | Existing expanded composer | Mobile-only requirement; no desktop regression. |
| Mobile session first shown, idle and empty | Pencil launcher | Starting default; no automatic textarea focus or keyboard. |
| Existing text/images/quotes on first show or return | Expanded | Do not silently conceal unsent work. User may explicitly tuck it away when safe. |
| Pencil tap / keyboard Space or Enter | Open existing editor; reveal, measure, then focus it | One activation; restore draft/caret; mobile keyboard is requested by that gesture. |
| Blur, scroll, empty draft, last attachment removed, keyboard dismissed | No presentation transition | Avoid both previous automatic-collapse approaches. |
| Explicit Collapse composer | Hide editing surface, preserve draft and model state; focus launcher | Never discard. Keep full view instead if queue, image read/error, open picker, or busy-with-content requires it in the first slice. |
| Explicitly closed with a retained draft | Launcher exposes “Edit draft” rather than “Compose” to assistive tech | Consider one quiet visible draft indication; exact icon/label treatment is unresolved, not a new mandatory badge. |
| Quote / Ask from Changes / other external draft insertion | Reveal the addressed draft before any editor focus | Existing quote focus effect cannot focus a hidden editor. Reveal need not force a phone keyboard for background restoration. |
| Image add/read/failure while hidden | Reveal feedback; retain original data | A late read result must not disappear behind a pencil. Native file-dialog return must not close the composer. |
| Queue Edit / known-unsent draft returned | Reveal restored draft, never resend | Keep newer edits too. Restoration is not an “empty” or “success” event. |
| Busy with no draft, collapsed | Preserve Stop using existing enabled/command policy | Pencil + Stop recommended; keeping expanded is the simpler alternative. |
| Accepted send | Stay open initially | Optional safe auto-close is a later decision, not required for useful space savings. |
| Breakpoint crossed / session changed | Desktop opens unchanged; do not transfer another session's closed state or focus | Reconcile actual draft and remeasure on reveal; avoid a global persisted mode. |

An explicit close can retain even a multiline draft: this is the user's choice to put it away,
not an automatic inference that hidden content is unimportant. Reopening must restore all lines,
images and quotes. This is distinct from squashing multiline content into a one-line textarea.

### Optional auto-close after send — defer initially

Only consider closing after authoritative acceptance of **that submission**, with no newer draft,
image read/error, quote, open picker or queue needing attention, and an accessible Stop path if work
starts. Never close because text became empty, a local send callback returned true, or the socket
accepted a frame. `drafts.submit` can clear a draft while remote delivery remains uncertain; later
`not_sent` restores it by input ID. [C4] [PIN-61][L2] and [PIN-132][L3] document real draft loss
at local transport and later host-refusal boundaries. A late acknowledgement must not close newer
editing or another session. Avoid this acceptance-race machinery in the first iteration.

## Why explicit open bypasses the previous hard part

The previous patches made focus loss change height. Mouse/touch press can change focus **before**
activation; #312 moved Scroll to bottom 46px between mousedown and mouseup and needed press-time
workarounds on both that control and queue Edit. A requestAnimationFrame delay is not a guarantee
that a held press has finished. CSS `:focus-within` instead of React state does not fix the ordering.

With the proposal, focus changes do nothing to the presentation flag. Pencil and Collapse act on
activation, not pointerdown; transcript clicks, text selection and picker focus do not collapse it.
No document-wide preventDefault, blur timer or scroll-driven resting state machine is needed.
Keep this boundary even if later adding animation; animation is not a fix for moving hit targets.

## Actual Piano history

| Date / pinned source | What it did | What the evidence does and does not establish |
| --- | --- | --- |
| Oct 5: research `a6d65462`; implementation [`140c66c5`][H0] | Non-wrapping model/effort toolbar, reserved action, mobile bottom docking on New, growth/cap and touch focus policy. **Not** a one-line resting composer. | The [implementation note](2026-10-05-mobile-composer-layout.md) reports nine viewport checks and draft/selection retention, not physical keyboard verification. It reports 390px footer reductions from 118→54px on New and 82→54px in-session. Those are historical fixture measurements, not current dimensions. |
| Oct 8: [`991f28ec`][H1], merged by [`e512fb8f`][H2] | Local `expanded` state; only editor focus expands, blur schedules a requestAnimationFrame collapse, React focus capture cancels it across portals. Same textarea; autosize switches to layout effect and clears height/scroll offsets when compact. Attach + input + primary action remain; settings hide. Nonempty and multiline drafts **do** collapse; attachments and queue stay above the entry. New unchanged. | The committed browser evidence checked editor/caret identity, portals, compact Send/Stop, queue/images and scrolling. This was not “only input and button,” nor a content-gated rule. Its then-current image/queue rules predate today's `composerControl`. |
| Oct 8: [`844d7f16`][H3] | Reverted the above three-file change, including its compact browser checks. | Commit message: “at user request; retain visible model controls and avoid focus-driven layout changes.” It does **not** establish a specific browser bug as the cause. |
| Oct 28: [#312][H4], head [`8434ef28`][H6] | Session-only `compact` opt-in in shared `DraftEditor`; `data-empty` requires no text, images, image busy/error, or quotes. CSS `:focus-within` plus open Radix-trigger state determines expansion. A grid repositions the same textarea/Attach/action and hides settings/delivery. | PR reports 102→56px internal height, preserved primary position, passing scratch checks and suites. It also reports its first version moved Scroll to bottom **46px between mousedown and mouseup**, reproduced by `open-session`; queue Edit had the same failure. Mouse-down default prevention was added to both. |
| Oct 28: [closing comment][H5] | #312 closed, **not merged** (`merged=false`, `merged_at=null`). | “...changing height on focus moves the transcript under the pointer (lost clicks, shifted selections) and needs press-time workarounds plus a fragile grid. Not worth the complexity.” Passing the listed checks did not settle the UX trade-off. |

The October 5 [reference note](2026-10-05-mobile-composer-references.md) distinguishes T3's mobile
unfocused/non-multiline collapse from desktop scroll-driven resting layout and recommends against
importing the whole state machine. Its T3 observations are pinned to `25d5c7ca`; they are **reference
product history, not Piano's implementation history**. The concrete Piano failure evidence is #312.
The old `/tmp/...` evidence locations are reported provenance, not durable attachments inspected here.
Older `test/browser-composer.mjs` scripts are no longer current journeys; [testing policy](../testing.md#browser-tests)
explains their replacement. Do not copy their commands into a current verification plan.

Git history and GitHub issue/PR searches for composer, compact, collapse and unfocused found #312
as the matching GitHub discussion. No standalone GitHub issue for this behavior was found in those
searches; unrelated usage issue #56 is not its origin. GitHub's commit-to-PR lookup returned no PR
for `991f28ec`; the merge and revert commits are the primary record for that earlier attempt.

## Current code map (pinned to inspected revision)

| File / boundary | Contract to preserve |
| --- | --- |
| [`DraftEditor.tsx`][C1] | `useDraftEditor` binds one draft key to text, images, quotes and the textarea ref. `DraftEditor` always renders image feedback, quote chips, optional queue panel, `SlashTextarea`, then Attach/model/actions. No compact prop or focus-collapse state. Quote-count increase focuses the editor. Owns model-open state and Mod+/ handling. |
| [`Composer.tsx`][C2] | Session actions/read-only decision, queue panel and Edit, delivery picker, one Send/Queue/Stop button. Separate usage/jump row below the card. `disabled` and `actionsDisabled` are distinct so reconnect need not prevent local drafting. |
| [`composerControl.ts`][C3] | Sole button/key command policy: busy with empty content → Stop; content → steer/follow-up (or queue during compaction); stopping disables repeat admission. Esc restores queue before Stop. Layout must consume this answer, not invent another. |
| [`messageDraft.ts`][C4] | Owns text/images/quotes and known-unsent restoration. `draftMessage` folds quotes into send text, so quote-only input is sendable. Busy image reads block sending; restoration can return images above ordinary addition limits and keep them editable. |
| [`Attachments.tsx`][C5], [`Quotes.tsx`][C6] | Native file picker, card drop/paste, reading/error feedback, remove actions; selection-based Add to chat preserves selection until activation and is desktop-only. Quote insertion is not a textarea input event. |
| [`SlashTextarea.tsx`][C7], [`slashCompletion.ts`][C8] | Native textarea plus noninteractive token mirror and portalled suggestion list; selection, accepted token, completion context and IME live here. Completion consumes keys before the page's send handler. Mirror follows textarea geometry via ResizeObserver. |
| [`NewSession.tsx`][C9], [`ProjectHome.tsx`][C10] | Both reach the shared draft editor via `NewSessionComposer`. New's desktop autofocus, coarse-pointer opt-out, initial-message controls and 288px cap must not accidentally inherit session-only compact behavior. |
| [`styles.ts`][C11], [`useAutoGrow.ts`][C12] | Input min-height 56px, CSS cap `min(12rem,30dvh)`; JS session cap 192px. Toolbar non-wrapping; primary 44px on phones, 36px at `md`. Autosize runs on text/max/ref changes, not focus or width alone. |
| [`ModelSelect.tsx`][C13], [`PianoPopover.tsx`][C14], [`pointerClose.ts`][C15] | Controlled model popup; keyboard Escape can return to editor. Pointer close generally suppresses Radix's trigger refocus. Do not assume all dismissals focus the trigger. |
| [`keys.ts`][C16], [`typeToFocus.ts`][C17] | Enter does not send on coarse pointers, during IME (`isComposing`/229), repeat or Shift+Enter. Type-anywhere avoids overlays, forms, inert editors and Space activation on controls (#436). |
| [`transcriptViewport.ts`][C18], [`useVirtualTranscript.ts`][C19] | One viewport owns bottom-follow, reader position and jumps; virtual transcript observes container resize. A height change can intentionally move bottom-pinned content. Stable `scrollTop` alone does not prove a click target or selection stayed at the same screen coordinate. |

## Remaining hard parts and smallest bypasses

### One mounted editor, but not merely display:none

Keep the same `DraftEditor` / `SlashTextarea` node, draft key, model state, selection and undo
history. Do not conditionally mount a compact clone or change its React key. Hidden content must be
absent from tab order and input handling; `useTypeToFocus` already excludes editors with no client
rects or under `inert`. Preserve that, and preserve Space/Enter activation on the pencil rather
than letting global typing add text. [C1], [C7], [C17] [PIN-125][L1], fixed by [PR #436][L4], records the
Space-stealing failure. An offscreen-but-focusable composer is not a safe collapsed state.

**Required reveal work:** `useAutoGrow` recalculates only for `[ref,text,max]`. A hidden editor can
measure zero or retain an old inline height; showing it with unchanged text does not retrigger the
hook. Explicitly remeasure on visibility/layout changes, after it is measurable, including viewport
width changes. Let the slash mirror resync with the same textarea's geometry. Do not indiscriminately
reset selection or textarea scroll offsets. This is presentation lifecycle plumbing, not a new editor.
Explicit multiline and soft-wrapped text both retain normal expanded autosizing. [C7], [C11], [C12]

### Focus, portals and the virtual keyboard

The pencil is a named touch-sized button (proposed accessible name **Compose**, or **Edit draft**
when content is retained), with `aria-expanded` and `aria-controls`. The explicit close control
is **Collapse composer**, not a destructive clear. Put it outside existing Send's hit target.
On open, reveal then focus the real textarea with scroll prevention and preserve its caret. Keep
that operation associated with the user activation: deferring focus arbitrarily can fail to raise
the iOS keyboard. Validate actual device behavior rather than assuming a React effect guarantees it.
On explicit close, move focus to the launcher and let the keyboard dismiss; do not trap focus in
hidden content. Reopening restored background input need not unexpectedly raise the keyboard.

Keep a picker open without closing the composer. Radix body portals do not belong to the editor's
DOM focus subtree, while React portal events follow the React tree. [F1], [F2] Current model Escape
can return focus to the editor, whereas pointer close generally suppresses trigger refocus. [C13], [C14], [C15]
Explicit presentation state sidesteps portal-based collapse detection. Disable/defer Collapse while
an owned popup is active, or close it and complete its focus transaction before hiding its anchor.
Do not leave a portalled menu open pointing at a hidden control. Slash and IME still own their keys:
Escape must dismiss completion before any page action; candidate Enter/229 must not send or close.
Mobile Enter remains newline, with Send as the action. [C7], [C8], [C16]

### External insertions, retained drafts and image feedback

`DraftEditor` currently focuses on quote-count increase. When closed, reveal **before** that
focus; likewise reveal queue restoration, Ask from Changes and known-unsent restoration without
replacing their draft data. Add to chat is currently desktop-selection-only, so mobile support for
that selection pill is **not** part of this proposal; an external quote already in a draft must
still appear. [C1], [C4], [C6]

Image picker, paste and drop keep their existing full-composer behavior when open. Do not assume
a hidden card still receives drop/paste or a hidden Attach remains reachable. If dropping onto the
launcher is desired, that is an additional explicit drop target, not free functionality. Native
file picking may leave the document temporarily; no blur close means that remains safe. Keep reading
and error feedback visible, including late results after an attempted close. Closing must never
clear text, images, quotes, held model/effort choices or input-recovery state. [C4], [C5]

### Exact surface boundary: not all of Composer can disappear

The current `DraftEditor` includes images, quote chips, the injected queue panel, textarea,
Attach/model controls and the primary/delivery actions. `Composer` renders usage/JumpTo **outside**
it. Hiding the editor wholesale therefore also hides Stop and queue Edit; hiding the entire Composer
additionally loses usage/jumps. Neither implements the clarified requirement safely. [C1], [C2], [C3]

For a first slice, retain usage/JumpTo and keep the existing full composer for the complicated queue,
image-feedback and busy-with-content cases described above. If collapsed-busy Stop is chosen, place
its control in the resting row using `composerControl`'s existing answer; keep only the active
presentation focusable, without adding a second input-action policy. Preserve stop-in-flight disable,
compaction, delivery mode, Escape's queue-first semantics, reconnect local drafting and read-only
notices. Extracting the queue or relocating usage is further scope, not a prerequisite.

### Mobile geometry and scroll anchoring

Expansion still changes transcript height, now deliberately after activation. Keep safe-area
padding, bounded textarea growth and existing primary touch targets. In short viewports the full
composer, queue and software keyboard may compete: reuse existing caps, rather than a new
full-screen sheet that changes interaction semantics. New's desktop autofocus must not leak into a
mobile launcher; external directory/project controls remain unchanged if New is later included.

`transcriptViewport` already owns bottom-follow, jumps and reader position; the virtual transcript
observes container resize. Use that owner, not composer-owned `scrollIntoView` or bespoke anchoring.
Observe bottom-pinned and history-reading positions separately. Stable scrollTop does not prove
selection or a target stayed at the same screen coordinate. Test portrait/landscape, narrow and
reduced-height geometry, plus actual iOS/Android keyboard/safe-area behavior if available. Emulation
is not physical-keyboard evidence. [C18], [C19]

## Superseded question: literal OR versus safer AND

This comparison records why the initial reading was risky; **neither rule drives the pencil
proposal**. Let A = interaction active, N = no images AND no quotes.

| A | N | Literal `!A \|\| N` | Safer `!A && N` |
| --- | --- | --- | --- |
| no | yes | collapsed | collapsed |
| no | no | collapsed, despite pending content | expanded |
| yes | yes | collapsed, even while editing | expanded |
| yes | no | expanded | expanded |

“Nothing attached/quoted” means neither, not `!images || !quotes`. Literal OR hides pending content
on blur and keeps a focused text-only draft collapsed. AND better expresses “resting and uncomplicated,”
but would need multiline (including soft wraps), image read/error, portals and active gestures to
block collapse. Empty-only was #312's narrower guard, and still did not solve pointer movement.
With explicit open/close, focus/content do not automatically close the editor; multiline drafts can
be retained behind a deliberate close without being squeezed into a misleading one-line preview.

## Minimal acceptance checks for a later implementation

These are proposed gates, **not checks run by this research**. Reuse current rule tests and journeys;
add only meaningful uncovered visibility/focus regressions, not a new broad composer suite.

1. **Scope/state:** mobile idle launcher, click open, explicit close, retained-draft reopen; desktop
   pixel/behavior unchanged; New/project home unchanged unless separately approved. Blur, scroll,
   emptying text, send and keyboard dismissal never auto-close. Check breakpoint crossings.
2. **Identity/reveal:** same editor DOM node, draft bytes, caret, selection, undo and model/effort
   across toggles. Close/reopen unchanged multiline and soft-wrapped drafts, resize while hidden,
   then check actual autosized height and slash mirror alignment. No hidden focus or typing capture.
3. **Inputs/recovery:** open picker/paste/drop images, reading/error/cancel, remove final image/quote,
   quote/Changes insertion, queue Edit and known-unsent restoration including newer edits. All remain
   inspectable; closing never sends or discards. Background restoration does not steal phone focus.
4. **Actions/keyboard:** Send/steer/follow-up/compaction, busy empty Stop and stopping guard remain
   reachable; queued input and questions are not concealed. Space/Enter on pencil/close, Tab,
   model/delivery portal Escape and outside close, IME Enter/229, slash acceptance and mobile newline
   preserve existing behavior. Hidden toolbar buttons are not keyboard stops.
5. **Historical regression/viewport:** click or select transcript content while the editor loses
   focus; no automatic height change or lost activation. Then intentionally open/close while pinned
   to bottom and while reading history. Check actual screen geometry at 320/390px, short viewport and
   orientation changes. Observe phone keyboard open/close and Send visibility on hardware if available.
6. **Evidence:** scratch only; eventual UI change runs typecheck/lint/tests, existing start/open
   journeys and before/after style shots. Apply [Quiet UI](../quiet-ui.md#checks) to Compose/Edit draft,
   Collapse composer and any retained-draft indication; take every action and screenshot its answer.
   Reuse ComposerControl/MessageDraft/DraftSubmission/Keys/SlashCompletion coverage for existing rules.

## Decisions still open

- Exact mobile breakpoint and whether New/project home also get a launcher (recommend not initially).
- Collapsed running state: pencil + existing-policy Stop, or keep expanded; keep queue visible by
  remaining expanded initially versus extracting its panel later.
- Retained-draft visible indication; usage/JumpTo remain visible initially versus separately redesigning
  them. No disappearing functions under a claim of “pencil only.”
- Auto-close after authoritative send acceptance (recommend defer; explicit close alone first).
- Per-session presentation state lifetime across navigation; avoid cross-session focus/state leakage.

## Research verification and limits

Inspected current files, relevant commit patches, PR #312 body/files/metadata and closing comment,
and official React/Radix documentation. Read October 5 research and implementation notes, glossary,
Quiet UI, testing policy and direction/invariants. Related Linear issue bodies [PIN-125][L1],
[PIN-61][L2], [PIN-132][L3] were read; they protect input and draft behavior, not evidence of an earlier
pencil launcher. A Linear composer search including archived issues found no direct compact-composer
issue. GitHub pencil/composer search found none. No claim that no private discussion ever existed.

Document/link review only. No source changes, app/model calls, builds, deployments or browser runs.
Historical check results are attributed reports, not fresh verification. The pencil design is not
prototyped. The user clarified mobile/explicit open; other recommendations remain unapproved.

Environment: existing dedicated worktree on exe.dev Linux; system date `2026-11-05`. Standard
`GH_HOST=github.int.exe.xyz gh pr/issue list --repo goofansu/piano ...` was blocked by a 403 from
`/api/v3/meta`; repository-scoped `gh api repos/goofansu/piano/...` and `search/issues` worked on
the same host. No credential or host change was needed.

## Sources

Current-code links below are immutable at the inspected revision; historical source links point
to their own commits. Framework documentation was read November 5, 2026.

[H0]: https://github.com/goofansu/piano/commit/140c66c57b9a1d95fccea772957c4f1a50c8a8c0
[H1]: https://github.com/goofansu/piano/commit/991f28ec0a1da3ec21e22c8b4cbf43d5d6664bf8
[H2]: https://github.com/goofansu/piano/commit/e512fb8ff8d81272127156f8a764d9d26946ea68
[H3]: https://github.com/goofansu/piano/commit/844d7f16614988617ddcfc137a351ce70d4442e7
[H4]: https://github.com/goofansu/piano/pull/312
[H5]: https://github.com/goofansu/piano/pull/312#issuecomment-6462295565
[H6]: https://github.com/goofansu/piano/commit/8434ef2844be8df308f950617608f7f7db43dc62
[C1]: https://github.com/goofansu/piano/blob/d2e82418040886a8f6fcf1d8027b9faee1c57435/web/src/components/DraftEditor.tsx
[C2]: https://github.com/goofansu/piano/blob/d2e82418040886a8f6fcf1d8027b9faee1c57435/web/src/components/Composer.tsx
[C3]: https://github.com/goofansu/piano/blob/d2e82418040886a8f6fcf1d8027b9faee1c57435/web/src/lib/composerControl.ts
[C4]: https://github.com/goofansu/piano/blob/d2e82418040886a8f6fcf1d8027b9faee1c57435/web/src/lib/messageDraft.ts
[C5]: https://github.com/goofansu/piano/blob/d2e82418040886a8f6fcf1d8027b9faee1c57435/web/src/components/Attachments.tsx
[C6]: https://github.com/goofansu/piano/blob/d2e82418040886a8f6fcf1d8027b9faee1c57435/web/src/components/Quotes.tsx
[C7]: https://github.com/goofansu/piano/blob/d2e82418040886a8f6fcf1d8027b9faee1c57435/web/src/components/SlashTextarea.tsx
[C8]: https://github.com/goofansu/piano/blob/d2e82418040886a8f6fcf1d8027b9faee1c57435/web/src/lib/slashCompletion.ts
[C9]: https://github.com/goofansu/piano/blob/d2e82418040886a8f6fcf1d8027b9faee1c57435/web/src/components/NewSession.tsx
[C10]: https://github.com/goofansu/piano/blob/d2e82418040886a8f6fcf1d8027b9faee1c57435/web/src/components/ProjectHome.tsx
[C11]: https://github.com/goofansu/piano/blob/d2e82418040886a8f6fcf1d8027b9faee1c57435/web/src/lib/styles.ts
[C12]: https://github.com/goofansu/piano/blob/d2e82418040886a8f6fcf1d8027b9faee1c57435/web/src/lib/useAutoGrow.ts
[C13]: https://github.com/goofansu/piano/blob/d2e82418040886a8f6fcf1d8027b9faee1c57435/web/src/components/ModelSelect.tsx
[C14]: https://github.com/goofansu/piano/blob/d2e82418040886a8f6fcf1d8027b9faee1c57435/web/src/components/PianoPopover.tsx
[C15]: https://github.com/goofansu/piano/blob/d2e82418040886a8f6fcf1d8027b9faee1c57435/web/src/lib/pointerClose.ts
[C16]: https://github.com/goofansu/piano/blob/d2e82418040886a8f6fcf1d8027b9faee1c57435/web/src/lib/keys.ts
[C17]: https://github.com/goofansu/piano/blob/d2e82418040886a8f6fcf1d8027b9faee1c57435/web/src/lib/typeToFocus.ts
[C18]: https://github.com/goofansu/piano/blob/d2e82418040886a8f6fcf1d8027b9faee1c57435/web/src/lib/transcriptViewport.ts
[C19]: https://github.com/goofansu/piano/blob/d2e82418040886a8f6fcf1d8027b9faee1c57435/web/src/lib/useVirtualTranscript.ts
[F1]: https://react.dev/reference/react-dom/createPortal
[F2]: https://www.radix-ui.com/primitives/docs/components/popover

[L1]: https://linear.app/goofansu/issue/PIN-125/let-space-activate-session-rail-and-preview-buttons-without-editing
[L2]: https://linear.app/goofansu/issue/PIN-61/preserve-existing-session-drafts-when-transport-rejects-before-sending
[L3]: https://linear.app/goofansu/issue/PIN-132/preserve-a-follow-up-draft-when-another-client-archives-the-session
[L4]: https://github.com/goofansu/piano/pull/436
