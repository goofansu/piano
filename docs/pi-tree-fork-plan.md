# Pi tree/fork: stacked vertical-slice plan

Planning checkpoint, 2026-10-08. Rebased onto `origin/main` **a9041a0**; Pi remains pinned to
**1.1.0**. This plan applies the [tree/fork research](research/2026-10-08-pi-tree-fork-workflows.md)
within [ADR 0001](adr/0001-pi-rpc-workspace-workbench.md), the
[development invariants](development-invariants.md), and the daily-use priority in the
[roadmap](roadmap.md). No feature below is implemented by this document.

## Product goal

Find an earlier decision, explore another approach without deleting history, return with optional
findings, or give an alternative its own session. The tree is an on-demand control—not a permanent
graph—and conversation changes never imply filesystem rollback or a new worktree.

Every PR includes its browser surface, backend behavior, focused regression checks and observed
browser journey. There are **no infrastructure-only or documentation-only PRs in this stack**.
The existing research and this plan accompany PR 1. Each PR is useful when merged without its children.

## GitHub stack

| PR | Feature | Head branch | Base branch |
| --- | --- | --- | --- |
| 1 | Browse and search conversation history | `pi-tree-fork` | `main` |
| 2 | Bookmark conversation entries | `pi-tree-bookmarks` | `pi-tree-fork` |
| 3 | Continue or revise from an earlier point | `pi-tree-navigation` | `pi-tree-bookmarks` |
| 4 | Fork and duplicate sessions | `pi-session-forks` | `pi-tree-navigation` |
| 5 | Carry a summary when changing branches | `pi-tree-summaries` | `pi-session-forks` |

Build bottom-up. After a slice passes verification and review, commit/push it, create its PR against
the immediate parent, and branch the next slice from that verified head. Check for an existing PR
before creating one. Each PR body links its parent/children and records its own delta, invariant IDs,
proof and limitations; the feature diff must not include its ancestors' changes.

Use `GH_HOST=github.int.exe.xyz gh ... --repo goofansu/piano`. Use the repository's Summary / Evidence /
Merge Danger format, with the stack links in Summary. Capture before/after output or screenshots,
not merely a list of intended tests. Report actual PR URLs as they are created; none exist yet.

Do not auto-merge. Merge order is bottom-up. If a parent changes, rebase descendants in order and
rerun affected checks. After a parent is merged, retarget the next PR to `main`; for squash/rebase
merges, transplant only that child's commits onto the merged base rather than replaying the parent.
Update published branches with an explicit force-with-lease, never an unguarded force push.
Pushing or opening PRs does not authorize deployment.

## PR 1 — Browse and search conversation history

**Visible feature:** **Conversation tree** in the session menu and Mod+K's **Session commands**.
Open a searchable outline, identify the current position, and preview an entry without changing the
session. Find entries from abandoned branches and before compaction, not just the current transcript.

### Included

- A quiet, responsive, keyboard-accessible picker and preview, composed from shadcn/ui after registry
  search. No graph canvas or new global shortcut. Preserve the menu's existing focus behavior.
- Authoritative Pi entry/parent IDs, forest handling, current-path indication, existing Pi labels,
  and concise role/type previews. Hidden technical ancestors do not change the real tree.
- Search over the returned bounded projection, with its scope honest; don't promise full-content
  search if only previews are indexed. Entry details load on demand, with explicit truncation/limits.
- Live reads through `PiSessions`; inactive history through `SessionFiles` without starting Pi just
  to browse. Missing checkouts remain inspectable where their saved history is available.
- Bounded/redacted results, no bulk base64 images in the outline, cancellation of obsolete UI reads,
  and request/session correlation so late results cannot replace another session's tree.
- Menu/palette parity, loading/error/empty states, and “Show current position” independent of filters.

No navigation, bookmarking, fork buttons, disabled promises of future features, or Registry transcript
storage. Preview stays available during a running response; live freshness is refreshed on explicit
open/refresh and relevant finalized changes, not per token.

### Acceptance journey

1. Open a seeded session containing two branches, compaction and a labeled entry.
2. Open Conversation tree from both the menu and palette; find/preview each historical path.
3. Verify the active context and leaf are unchanged by preview/search; sending a prompt still uses
   the original position. Verify this through Pi facts, not only unchanged rendered chat.
4. Inspect an inactive session without starting a child; switch sessions while a slow read is pending.
5. Exercise narrow/mobile and desktop layouts, keyboard focus, empty search, and a failed history read.

**Regression focus:** true IDs, forests, hidden ancestors, stale read results, payload/redaction limits,
and live-versus-persisted leaf selection. **Contracts:** INV-01, INV-02, INV-05, INV-11–12.

## PR 2 — Bookmark conversation entries

**Visible feature:** add, rename and remove a **Bookmark** on a selected entry; find it using a
bookmarks filter/search. It survives reconnect/restart and appears in Pi's own tree.

### Included

- A small explicitly loaded Piano extension and capability/result handshake, introduced together
  with the useful bookmark feature—not as a separate transport PR.
- `pi.setLabel()` behind `PiSessions`, targeting an explicit entry ID. Do not copy the example
  extension's reverse scan of all history to guess which message the user meant.
- Correlated success/cancel/error/uncertain results. A missing or incompatible extension disables the
  mutation with an actionable reason; no unknown slash command may fall through to model input.
- A shared mutation admission rule: quiescent session, expected generation/position/revision,
  stale-request rejection and readback. Abort and dialog responses must never be locked out.
- Persist labels only in Pi. Label edits append a real entry at the active leaf, including when the
  target is on another branch; refresh the leaf while keeping model-visible context unchanged.
- Matching palette access for the menu's bookmark action, using the picker when a target is needed.

### Acceptance journey

Bookmark an entry on an abandoned branch; see the label without navigating to that branch. Rename it,
filter to it, reconnect, restart the scratch backend, and remove it. Confirm Pi's saved labels agree
and model-visible context has not moved. In two tabs, a stale label mutation must not overwrite a
newer operation unnoticed. With the extension missing, preview still works and no prompt is sent.

**Regression focus:** bridge capability/version, result correlation, global label resolution,
stale mutations and failed/uncertain delivery. **Contracts:** INV-01–05, INV-11–12.

## PR 3 — Continue or revise from an earlier point

**Visible feature:** **Continue from here** on an answer and **Revise prompt** on a user entry.
The transcript changes to that position; a new submission creates another path and the old path
remains browseable. Piano requests no summary in this slice; normal user extension hooks remain in effect.

### Included

- `ctx.navigateTree()` through the already verified extension interface. Respect native before/after
  hooks, cancellation and the same-leaf no-op; do not edit JSONL or mutate a separate SDK writer.
- User-entry selection moves to its parent and offers the selected prompt as a draft; an answer
  continues after that entry. No automatic submission. Technical entries stay read-only initially.
- Explicit handling of an existing draft and images: preserve the old draft or confirm replacement;
  restore supported original attachments, or clearly require reattachment before sending. Never
  submit a redacted preview or silently turn an expanded skill into the original command.
- Only the initiating tab receives a draft. All tabs receive the authoritative context/position;
  a stale tab's subsequent history-changing action must fail rather than execute on a surprise path.
- Clear tool/stream projections and obsolete readbacks on transition. Block navigation during runs,
  queued work, retries, compaction or unresolved dialogs rather than silently aborting or clearing them.
- A concise action-time explanation: “Conversation only; files stay as they are.”

### Persistence policy to implement and prove in this slice

After confirmed navigation, append a namespaced **non-context custom checkpoint through Pi**, then
read back the authoritative position. It is a real history entry, hidden from the default picker;
it is not an independent Registry leaf override. An existing conversation can persist even a move
before its first prompt this way. Never append a checkpoint on preview, veto or same-leaf no-op.

The operation is successful only after checkpoint/readback succeeds. If Pi moved but checkpoint or
readback failed, show partial/uncertain completion, reconcile, and prevent silent idle retirement or
blind retry. Do not pretend the operation rolled back.

Preserve Pi-native model/thinking behavior: live navigation does not restore historical selections;
reopen resolves Pi's recorded settings. Read the actual controls back after each transition/start.
The checkpoint guarantees the selected history position, **not** exact historical runtime or model
reproduction. Prove root and ordinary moves across retirement/restart before shipping this slice.
If Pi's supported extension interface cannot satisfy this policy, stop and revise the plan before
exposing navigation; do not compensate by modifying session files directly.

### Acceptance journey

Start with two completed prompt/answer pairs. Continue from the first answer, send a short different
prompt, and observe two paths. Return to the original answer. Revise the first prompt, preserve or
explicitly replace a draft containing an image, and confirm it is not sent automatically. Reload,
retire/reopen Pi and restart the backend: the selected path/context survives. Confirm a second tab
gets the new context but not someone else's draft; race it with a stale navigation request.

**Regression focus:** before-user/after-answer positions, root persistence, cancellation/no-op,
partial completion, drafts/attachments, stale frames and two-tab admission.
**Contracts:** INV-01–05, INV-07, INV-11–12.

## PR 4 — Fork and duplicate sessions

**Visible feature:** **Fork session** from a selected user prompt and **Duplicate session** at the
current position. The initiating tab follows the new session; the original remains in the sidebar
and is independently usable. Both run in the same workspace; no Git branch/worktree is implied.

### Included

- Native RPC `fork` and `clone` behind `PiSessions`, with one shared host-adoption implementation
  owned by `SessionHosts`. This PR contains the identity work because this feature needs it.
- Atomically adopt the child under Pi's new ID, establish a new observation generation, register the
  new reference in SQLite, and fence transition-time records. Never publish new-session work under
  the source ID. Other tabs remain on the source and can reacquire its host.
- Source and destination identity/lineage use session-scoped entry IDs. Keep Pi `parentSession`
  authoritative; store only small integration references needed for navigation/recovery in Registry.
- New forks retain the same workspace and outcome-project membership (or remain ungrouped).
  Do not inherit the source's PR link, explicit PR-discovery preference, evidence or approvals.
  Read names/models/thinking/stats from Pi, and do not sum copied history as newly spent cost.
- Fork-before-user returns a draft only to its initiator; duplicate includes the current leaf and
  starts with an empty new-session draft. Protect any existing local draft in both cases.
- Source claims coordinate prompt/fork/release/archive/delete, while allowing required abort/dialog
  handling. Veto leaves source/draft untouched; ambiguous delivery never automatically repeats a fork.

### Unsaved fork policy

A fork before the first prompt can have an ID/path but no file. Keep its live host out of normal idle
retirement until conversation content persists, or until the user explicitly discards it. Do not
add a fake prompt to force persistence, and do not stop/reopen it as if its file already existed.

If the process/backend is lost before persistence, distinguish an unavailable unsaved fork from an
ordinary resumable session. Preserve a small source reference and offer explicit recovery/recreation;
never silently open an unrelated empty session under the same registered ID or auto-fork on reconnect.
Native transcript durability starts when Pi actually creates the file. This limitation must be
observable when actionable, not hidden behind a successful registration.

### Acceptance journey

Fork before a middle user prompt: verify the new prefix, restored draft, new sidebar entry and usable
source. Duplicate the current leaf: verify it includes that position and has a distinct ID. Use two
tabs through both operations, submit independently, reload, and confirm one owner per session.
Exercise a before-first-prompt fork through idle retirement, first submission, and separately process
loss. A fake registry failure after Pi changes identity must show recoverable partial success without
a duplicate fork. Check outcome-project membership and absence of inherited PR metadata.

**Regression focus:** host identity/scope/observer transfer, source usability, SQLite failure,
concurrent actions, extension veto, unsaved-fork recovery and lineage.
**Contracts:** INV-01–05, INV-07, INV-11–12.

## PR 5 — Carry a summary when changing branches

**Visible feature:** optional **Carry a summary** on a navigation action, with additional focus text,
progress and cancellation. The user can explore a tangent, return to a bookmarked point and see the
summary that Pi added to the destination context.

### Included

- `summarize` and additional `customInstructions` on the existing navigation interface. Default off;
  no summary on preview and no automatic summary/model charge. Full instruction replacement is out.
- A session-owned operation lasting through summary, checkpoint and readback—not merely through a
  handled prompt acknowledgement. Keep progress/retry/cancel outcomes distinct and reconnect-safe.
- Honor extension veto/supplied summaries. Abort and dialog responses remain usable while other
  mutations are gated; no premature “idle” state or automatic replay after a timeout.
- Show the actual resulting summary in context/tree. Do not represent its file lists or omitted
  tool-result content as check evidence, code changes or cross-session merging.
- Use Pi's authoritative stats after completion. No inferred per-branch price, guaranteed billing
  completeness, or additive parent/fork totals.

### Acceptance journey

Explore a short tangent, select a bookmarked answer, enable Carry a summary, optionally focus it,
and return. Read the actual summary and the destination response to establish that context arrived.
Also navigate with the option off and observe no summary call. During a delayed summary, reconnect
and cancel; distinguish veto, provider failure, abort, successful empty/no-summary cases, and lost
acknowledgement without duplicating the operation.

Use a deterministic supplied-summary fixture for browser failure/race coverage and one short real
model journey for native summary generation. A fixture-only run is not acceptance of the paid path.

**Regression focus:** operation lifecycle, timeout versus cancellation, extension hooks, retry,
atomic resulting context, persistence and recorded usage. **Contracts:** INV-02–05, INV-09, INV-12.

## Shared implementation seams

- **PiSessions:** Pi command/extension transport, capability checks, projections, mutation admission,
  native outcomes and ordered state/events. Browser callers do not learn Pi's protocol or bridge text.
- **SessionHosts:** canonical ownership, retirement and source/destination host adoption. Deepen this
  module for forks instead of scattering identity transfer across React and WebSocket handlers.
- **SessionFiles:** read-only inactive-history projection. Never use file reads to override a live
  child's position. Share projection logic without exposing a second runtime writer.
- **Registry:** SQLite references, organization and small integration metadata only. No transcript,
  copied tree, summary or independently replayed leaf. Use Registry's transactional interface.
- **Wire/client:** session-scoped tree/draft/action outcomes, cursor/generation checks, quiet controls.
  Do not put filesystem paths in HTTP URLs. Actions visible in menu/header also exist in the palette.

Exact internal types can evolve within each slice. Do not add a general orchestration framework,
replace the Effect adapter, migrate to SDK hosting, or create parallel transport implementations.

## Verification and completion per slice

Use [evidence-based testing](testing.md). Before changing behavior, identify the claim and smallest
check that can falsify it. Test meaningful observable contracts through the module interfaces; don't
add tests for private helpers or merely require a larger test count.

For each code PR:

1. Add/extend focused fake-Pi/module cases for that slice's unprotected consequential failures.
2. Run `npm test`, `npm run typecheck` and `npm run lint` at its own head—not just the final stack tip.
3. Run the named browser journey through `npx agent-browser` on a scratch backend/UI, using pointer
   clicks for Radix menus. Retain command output, screenshots where useful, revision/environment,
   and limitations. Reuse deterministic fixtures; only short provider prompts where they prove
   something fixtures cannot.
4. Review Standards and Spec against the immediate parent; resolve findings before pushing/PR creation.
5. Commit and push the slice, report its PR URL and observed outcomes, then start the next branch.

Main now stores Registry in SQLite. Use **`PIANO_DB_PATH=<scratch>/piano.db`**, not retired
`PIANO_CONFIG`, with backend/UI bound to loopback on 7171/7172. Seed through the fixture/Registry
interface. Isolate Pi config/session storage and use only scratch repositories; stop only the PIDs
started for verification and remove created session/worktree fixtures. Leave the live database,
backend, built UI and deployment alone.

## Deferred from this stack

- Fork into a new worktree or snapshot/restore files; this needs a separately approved code-revision
  and concurrent-writer workflow under INV-06–10.
- Arbitrary-entry fork-at for older assistant answers; the extension supports it, but the first
  fork slice exposes the native before-user and current-leaf operations only.
- Cross-session summary transfer/merge, automatic branching or summaries, reviewer orchestration,
  permanent graph visualization, and branch-level cost accounting.
- Native upstream navigation RPC: prefer it when available, without blocking the pinned-release
  feature or maintaining speculative dual production implementations now.

## Planning evidence

Rebase of the research branch onto `origin/main` `a9041a0` completed without conflict. Reviewed the
current SQLite Registry, host/adapter assumptions, palette and focus changes against the research.
No code or dependency changed at this checkpoint. Document review confirmed five visible slices
with individual acceptance journeys; all 24 local link targets in the changed documents resolved,
`git diff --check` passed, and the rebased branch contains `origin/main`. The application suite was
not needed for this documentation-only checkpoint. Feature evidence and PR URLs will be added as
slices actually pass; this plan is not a completion report.
