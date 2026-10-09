# Message actions and natural branch navigation

Researched **2026-10-09** against Piano
`024b4b96cbeeaf0f336c248e47698bc4af8e79e7` and installed **Pi 1.1.0**
(upstream tag `abe508e1b89912adde45528136c3221eb69acdd7`).
This is a source-backed interaction recommendation, **not implemented behavior**.
It sharpens the [earlier research](2026-10-08-pi-tree-fork-workflows.md) for message-level
restarts and natural in-session switching. The published **in-session redesign** on
`pi-tree-redesign` is also relevant; its composer-mode plan is not yet this main
checkout's older popup-based [stack plan](../pi-tree-fork-plan.md). [R1]

## Short answer

Use **branches within one session tree** for related alternatives, not a new session
for every revision. “Switch trees” should usually mean **switch branches**; switching
independent sessions is a separate operation. Pi stores entry/parent links in one
session file (potentially a forest), and only the selected path supplies active
context, subject to compaction/context edits. Other paths remain stored. [P1, P2]

Piano currently lets you **inspect** that tree, not navigate it. Recommend **Tree mode
in the existing composer area**, with **Revise prompt** / **Continue from here** as
message shortcuts and **Switch branch** for returning to an existing continuation.
Keep the transcript visible; do not expand the current popup inspector into the main
workflow. This follows Pi's actual selector placement and the published redesign,
while the message shortcuts and branch-tip view are web-specific recommendations. [L1, P8, R1]

## Define “start over” precisely

| Intent | Proposed action | Context boundary |
| --- | --- | --- |
| Correct an earlier instruction | **Revise prompt** on a user message | Before that user entry; recover its text into a draft |
| Keep an answer and explore a different next step | **Continue from here** on an answer | After that assistant entry |
| Replace an unwanted answer | **Revise prompt** on the user instruction that led to it | Excludes that instruction and its later answers until resubmission |
| Resume an existing alternative | **Switch branch** to its stopping point | Existing destination path, not the common prefix |
| Give work independent identity/lifecycle | **Fork session** / **Duplicate session** | New session, not same-tree navigation |

Pi 1.1.0 `navigateTree` selects a user's **parent**, returning text rather than
resubmitting it; assistant selection uses the selected entry itself. Same-leaf
selection is an early no-op. `custom_message` also has before-entry/text behavior,
so the guide's broad “another entry” description is not a universal rule. [P3]
Initially expose message actions for user prompts and completed answers only;
leave tool/technical/custom entries inspectable, without promising safe “restart
from absolutely any row.” An assistant tool-call entry is not necessarily a complete
answer boundary. Piano folds tool results under calls and hides some empty rows. [L2]

Example: `U1 → A1 → U2 → A2` and `A1 → U2′ → A2′`.
To revise U2, move before U2 and edit its recovered draft. To explore after A1,
select A1 and compose a new prompt. To return to the original work, select **A2**
(or the appropriate actual stopping entry), **not U2 or A1**. Selecting U2 invokes
revision semantics; selecting A1 only recreates the shared-prefix context. [P2, P3]
Do not regenerate the original conversation to “switch back.” Navigation selects
existing history; another submission appends a new continuation. [P2, P4]

## How to do it in Pi today

In a standalone Pi TUI session, run **`/tree`**, search or move with arrows, select an
earlier user prompt or assistant answer, then choose **No summary** for a clean
alternative. Edit/compose and send. To return, open `/tree` again and select the
original path's stopping point. **Shift+L** labels a selected tree entry; **Ctrl+L**
filters to labeled entries (defaults, configurable). A label is a bookmark on an
entry, not a Git branch or an automatically advancing named conversation branch. [P1, P4, P9]

The selector replaces the editor area, not the transcript. Highlighting does not
navigate; Enter confirms. The TUI restores user text only when the editor is empty;
an existing draft wins. Optional summarization brings findings from the path being
left into the destination; it is not needed just to switch. Do not open a second
TUI writer on a Piano-owned live session to use this workaround. [P8, L8]

## Recommended in-session interaction — not implemented

```text
Transcript remains visible
  User prompt       [⋯ Revise prompt]
  Assistant answer  [Copy] [⋯ Continue from here]
  At a divergence   [‹ 1 of 2 ›]       only when alternatives exist

Input area: Compose ↔ Tree
  [Search history…]  [Branches / All history]  [Back to message]
  current path / alternate stopping points / optional bookmarks
  [Revise prompt | Continue from here | Switch branch]
```

- **Start where the user is looking.** A small message menu opens the same Tree
  action flow with that exact entry selected. Support focus and touch, not hover
  alone. Keep Copy and normal text selection; avoid double-click-to-rewind. Show
  “Revising this prompt” versus “Continuing after this answer” at the action boundary.
  No automatic submission. These are proposed web shortcuts, not Pi TUI features. [L2, P8]
- **Tree lives in the input area.** Exact local `/tree`, the session menu, and Mod+K
  should enter this same mode. Preserve drafts/images, keep Stop available, and
  restore focus on cancel/complete. Intercept the command locally; do not send it
  to the model. Use matching **Tree** menu/palette names when replacing the existing
  **Conversation tree** entry. No dialog, sheet, new page, or permanent graph. [P5, R1]
- **Browse before committing.** Search/highlight only changes selection. Enter or
  the visible action commits. Escape clears search first, then returns to Compose.
  Start on the active path; keep linear turns flat and indent actual divergences,
  like Pi, rather than indenting every successive message. [P8, R1]
- **Switch to the existing continuation.** A Branches view lists meaningful
  stopping points with a distinguishing prompt/answer snippet and any Pi label.
  Selecting an alternative resumes its saved tail, not the fork point. Mark the
  active selection, not an invented permanent “main branch.” If there are nested
  alternatives, ask which endpoint rather than guessing the newest descendant.
- **Local alternatives are a shortcut, not another model.** A small `‹ 1 of 2 ›`
  control may switch corresponding continuations at a real divergence. Preserve
  the shared transcript's scroll position, then focus the composer after confirmation.
  Keep this optional until the global Tree workflow is sound.
- **Do not equate raw leaves with human branches.** Traverse authoritative ancestry
  across technical entries. Ignore metadata-only checkpoint offshoots when deriving
  visible alternatives, but retain context-affecting summaries/edits. The current
  2,000-entry preview window cannot prove complete branch counts: compute bounded
  endpoint lists from full server-side history, with explicit limits/pagination. [L3, P4]
- **Handle unfinished endpoints honestly.** Native navigation to a user-only tip
  rewinds before it; `custom_message` behaves similarly. Offer **Revise prompt**
  there, not a misleading **Switch branch** that silently drops the last message.
  Exact at-entry resume for these endpoints needs a separately proven supported
  operation. Metadata after an answer can be the actual target while the answer
  supplies its display label. Current-leaf selection is a no-op. [P3]
- **Summary is opt-in.** Default to no summary for revisions and routine switching.
  Offer **Carry a summary** for “explore, then bring findings back,” with cost/progress
  and cancellation at the action. It appends new destination context; it is not a
  lossless merge, proof of work, or a required toll on every branch switch. [P3, P6]

Compose these surfaces from existing shadcn controls; search the registry before
implementation. No new global shortcut. Ship **revise → alternate continuation →
return** as one complete useful journey, not another read-only inspector/bookmark
prerequisite. Fork/clone are distinct workflows, not prerequisites for same-session
branching. The published redesign retains them as its next core slice. [R1]

## What the audited Piano source implements

- [ConversationTree.tsx](../../web/src/components/ConversationTree.tsx) is a searchable
  outline and detail preview. Row selection changes local `selected` only; **Show
  current position** selects a preview, not Pi's leaf. There are no mutation buttons.
- [SessionView.tsx](../../web/src/components/SessionView.tsx) mounts it per session,
  refreshing via finalized message-array changes; menu and palette expose it. [L5]
- [ConversationHistory.ts](../../server/ConversationHistory.ts) returns real Pi IDs,
  parent IDs, current-path flags, and globally resolved labels. The window is up to
  2,000 recent entries, substituting an older live leaf when necessary. Preview text
  is capped at 280 characters; detail at 32,000. Images and tool arguments are omitted;
  known-secret redaction happens before text truncation. This is not full-content search.
- [PiSessions.ts](../../server/PiSessions.ts) reads live `get_entries`, including its
  leaf; [SessionHosts.ts](../../server/SessionHosts.ts) uses that live owner when present.
  Inactive reads use [SessionFiles.ts](../../server/SessionFiles.ts)'s parser and
  in-memory manager, without starting Pi or repairing the source file.
- [wire.ts](../../shared/wire.ts) exposes `conversation_tree`/`conversation_detail`
  actions/results, but no navigate, label, fork, clone, branch-switch or draft-recovery
  action. Tree results lack an expected-generation/position mutation contract.
- [MessageList.tsx](../../web/src/components/MessageList.tsx) has copy/disclosure
  controls, but no navigation callbacks. The read-only browser is implemented;
  bookmark editing and plan slices 3–5 are not implemented by these source paths.

This supersedes the previous note's baseline-specific claim that full-history
projection still needs adding. The read-only projection now exists; safe mutations
and message-to-entry identity remain missing. [L1–L4]

## Critical gap: display IDs are not entry IDs

`RenderMsg` contains `id`, but no authoritative `entryId` or `parentId`. `PiRecords`
assigns `m0`, `m1`, etc. during context reconstruction, `e1`, `e2`, etc. to finalized
stream events, and `pending` while streaming. `RawMessage` has no entry identity.
`PiSessions` constructs the transcript from `get_messages`, whereas its tree uses
`get_entries`. `SessionFiles.peekSession` has the same display-ID limitation. [L4]

Recommendation: carry a separate session-scoped source-entry reference through
finalized render projections and action requests. Never use array indexes, DOM
anchors, text matching, or a timestamp heuristic as mutation targets. Compaction,
context edits, redaction, repeated prompts and streaming reconstruction defeat
those shortcuts. Pi's `buildSessionProjection` exposes source entries, but wiring
that correspondence across the RPC boundary remains implementation work. [P2, L4]
One implementation route is a correlated projection inside the live extension using
Pi's `buildSessionProjection().entries`, which pairs `sourceEntry` with projected
messages. An exported read-only builder over a coherent live entries/leaf snapshot
is another option; neither requires SDK runtime hosting or another file writer.
Use Pi's projection, not a raw tree walk that loses compaction/context edits. Streaming
placeholders become actionable only after their finalized source identity is known. [P4]
Until then, actions on authoritative Tree rows can work, but per-message actions
must not guess. Keep a UI render ID separate from the source-entry reference.

## Necessary implementation and safety boundaries

1. **Native operation, narrow bridge.** Pi 1.1.0 has history/fork/clone RPC commands,
   but no native tree-navigation RPC. Use verified extension command-context
   `navigateTree` behind PiSessions; do not send TUI `/tree` as a prompt. RPC's
   command-context binding returns only `cancelled`, discarding editor text and
   richer navigation results. A correlated result/draft protocol is still needed;
   normal user/project hooks, vetoes and same-leaf behavior must survive. [P3, P5]
2. **Shared selected position.** Admit mutations only while quiescent, checking
   expected host generation and leaf/revision. All tabs share one execution branch;
   reject stale actions and replace context coherently, clearing obsolete pending
   tool/stream state. Current snapshot sequencing is not a navigation admission
   protocol. Keep abort/dialog handling available. [L4, L6]
3. **Durable position.** Native branch/reset changes only the in-memory leaf;
   reopening rebuilds it from the last appended entry. Piano retires idle hosts.
   The published plan requires a Pi-owned non-context checkpoint after a confirmed
   move, followed by readback. The isolated probe reconfirmed storage behavior,
   not a production bridge or restart-safe browser workflow. Never checkpoint
   preview, veto, or same-leaf no-op. Failed checkpoint/readback after a move means
   partial/uncertain success, not rollback or permission to retry blindly. Root
   moves need the same care. [P4, L6, R1]
4. **Drafts and attachments.** Preserve or explicitly replace the current local
   draft, and send recovered content only to the initiating tab. Current drafts
   are session-keyed, not branch-keyed; generic extension editor suggestions are
   broadcast state and therefore not a private navigation-result channel. [L7]
   Recover supported original images separately or explicitly require reattachment.
   Tree detail omits images; rendered attachment URLs and redacted previews are not
   the original send payload. Expanded skills must not silently become reconstructed
   slash commands. Never resubmit preview text as authoritative original input. [L3, L4]
5. **Conversation only; files stay as they are.** Explain this at action time.
   Navigation is not filesystem rollback, replay, or verification. Live navigation
   refreshes context/tools but does not restore historical model/thinking selection;
   read actual controls back. Optional summaries add context, can cost money, and
   remain lossy—not file snapshots or evidence. [P3, P6, L8]

## Why session fork is different

Same-tree alternatives retain one identity and one active position. Native `fork`
creates a separate session before a selected user prompt; `clone` copies the active
path through the current position. Runtime replacement needs subscription rebinding.
Piano's fixed `spec`, cursor identity and host key do not yet implement adoption of
that new identity; simply dispatching fork would misattribute later activity. [P5, P7, L4, L6]
A fork before the first prompt can remain unsaved until conversation content exists;
a custom checkpoint alone does not create a conversation-free session file. [P4]
Neither operation creates a Git worktree. Use independent sessions for independent
work, and a separately designed workspace policy for concurrent writers. [L8]

## Verification needed before implementation is accepted

Protect **INV-01–05, INV-07 and INV-11–12**: Pi-owned history, one live selection,
ordered context, private drafts, workspace identity and tested compatibility. Use
INV-09 when summaries are involved; a summary is not evidence. [L8]

The smallest useful browser journey is: from two completed prompt/answer pairs,
revise the second user prompt, submit an alternative, switch back to the original
final answer, then switch to the alternative again. Assert Pi's leaf/context as well
as the visible transcript. Repeat via a message shortcut and Tree; preserve a draft
with an image, exercise cancel, first-prompt revision, same-leaf no-op, and nested
alternatives. Reopen after retirement/restart; a second tab receives context but not
the recovered draft, and its stale submission is rejected. Keep incomplete/tool
boundaries read-only unless their continuation semantics have separate evidence.

## Research evidence and limits

An independent background source audit supplied the initial Piano gap analysis.
The primary review also inspected the exact v1.1.0 navigation, storage, RPC binding and
TUI source, plus the published redesign at `27e57fa4d42f66bbc61d3e9370a38430c367e37d`.
Web discovery found [upstream issue #9780](https://github.com/earendil-works/pi/issues/9780),
a request for per-message double-click rewind, marked **not planned / no-action**;
it is related demand, not evidence that Pi ships that gesture.

A credential-isolated **Node v24.21.0 / Pi 1.1.0** SDK probe used synthetic history
and the actual `AgentSession.navigateTree`, without prompting a provider:

```text
PASS user revision: parent context, text-only draft, old paths retained
PASS switch answer tips: each complete existing continuation restored
PASS earlier answer: prefix only; leaf move lost on reopen until checkpoint append
PASS first user: before-root selection
PASS current leaf: no-op; another user-only tip: rewind, not at-entry resume
PASS custom_message: before-entry/text behavior
```

Script and output: `/tmp/piano-message-branches-20261009/navigation-probe.mjs`
and `navigation-probe.log`; background report: `agent.log`. Exit 0; six assertion
groups passed. Scratch session/config fixtures were removed in `finally`. The SDK
was used only as a research probe, not proposed as Piano's runtime. The background
research agent used the configured model for source analysis; the probe made **zero
provider calls**. No real registry, user history, backend, worktree or deployed UI
was changed. Unrelated concurrent working-tree changes were left alone.

Not verified: browser usability, a production extension bridge, paid summaries,
provider behavior after tool-boundary navigation, or complete concurrency/restart
handling. Those remain implementation gates. Document review resolved all **25 local
link targets, 11 tagged Pi source/doc targets and two pinned Piano branch targets**;
output is in `document-check.log` beside the probe. `git diff --check` passed.
This documentation-only change required no new regression test or application suite.

## References

- **L1:** [ConversationTree](../../web/src/components/ConversationTree.tsx).
- **L2:** [MessageList](../../web/src/components/MessageList.tsx).
- **L3:** [ConversationHistory](../../server/ConversationHistory.ts).
- **L4:** [PiRecords](../../server/PiRecords.ts), [PiSessions](../../server/PiSessions.ts), [wire](../../shared/wire.ts), [SessionFiles](../../server/SessionFiles.ts).
- **L5:** [SessionView](../../web/src/components/SessionView.tsx), [SessionHeader](../../web/src/components/SessionHeader.tsx), [CommandPalette](../../web/src/components/CommandPalette.tsx).
- **L6:** [SessionHosts](../../server/SessionHosts.ts), [tree/fork plan](../pi-tree-fork-plan.md).
- **L7:** [SessionView draft/editor handling](../../web/src/components/SessionView.tsx).
- **L8:** [Development invariants](../development-invariants.md), especially INV-01–05, 07, 09, 11–12; [development direction](../README.md).
- **P1:** [Pi v1.1.0 sessions](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/sessions.md).
- **P2:** [Pi v1.1.0 session format](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/session-format.md).
- **P3:** [Pi v1.1.0 AgentSession.navigateTree](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/agent-session.ts).
- **P4:** [Pi v1.1.0 SessionManager](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/session-manager.ts), `branch`, `resetLeaf`, `_buildIndex`, `_persist`.
- **P5:** [Pi v1.1.0 RPC commands](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/rpc-commands.md), [RPC binding](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/modes/rpc/rpc-mode.ts).
- **P6:** [Pi v1.1.0 compaction/branch summaries](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/compaction.md).
- **P7:** [Pi v1.1.0 SDK lifecycle](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/sdk.md).
- **P8:** [Pi v1.1.0 InteractiveMode](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/modes/interactive/interactive-mode.ts), `showSelector`, `showTreeSelector`; [tree selector](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/modes/interactive/components/tree-selector.ts), `flattenTree`, `recalculateVisualStructure`.
- **P9:** [Pi v1.1.0 keybindings](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/keybindings.md), Tree Navigation.
- **R1:** [Published in-session redesign plan](https://github.com/goofansu/piano/blob/27e57fa4d42f66bbc61d3e9370a38430c367e37d/docs/pi-tree-fork-plan.md) and [TUI interaction study](https://github.com/goofansu/piano/blob/27e57fa4d42f66bbc61d3e9370a38430c367e37d/docs/research/2026-10-08-pi-tui-tree-fork-interaction.md). These are pinned branch documents, not an implementation claim about this checkout.
