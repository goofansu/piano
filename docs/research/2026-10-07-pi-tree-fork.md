# Supporting Pi tree navigation and fork in Piano

**Follow-up:** [Taking full advantage of tree/fork on Pi 1.1.0](2026-10-08-pi-tree-fork-workflows.md)
refreshes this version checkpoint and the recommended workflows/delivery order, and qualifies runtime
restoration, summary inputs and checkpoint persistence. The 1.0.2 evidence below remains historical.

Researched 2026-10-07 against Piano `4354c22495756dfad436d6ed3abe5f03eaf4af5a`,
installed/locked Pi **1.0.2**, and its tagged source
`cd32f7725fdbddbaecdff5b1e68491563394e0ca`. This is an implementation recommendation,
not a completed feature or an architectural decision. No production session was inspected or changed.

## Recommendation

**Keep RPC. Add an on-demand conversation-tree picker, then explicit navigation and fork actions
behind PiSessions. Do not send `/tree` or `/fork` as ordinary prompts.**

- Tree **reading**, fork and clone already have native RPC commands in 1.0.2.
- Tree **navigation** does not. For support on the pinned release, use a small, explicitly loaded
  Piano extension calling `ctx.navigateTree()`. Prefer a native RPC command upstream in the longer
  term; do not migrate Piano to the SDK just for this operation.
- The substantial Piano work is ownership and synchronization, not drawing a tree: native fork
  replaces the child's current session, whereas Piano currently assumes its identity never changes.
- Ship read-only tree browsing independently if useful. Do not present a working navigation button
  until cancellation, drafts, retirement and restart semantics are settled. [P1–P6, L1–L4]

Relevant contracts: **INV-01** (Pi-owned history), **INV-02** (one live owner), **INV-03–05**
(operation/dialog outcomes and ordered views), **INV-07** (conversation versus code identity),
**INV-11–12** (safe projection and tested Pi compatibility). This fits roadmap milestone 4 and the
current daily-UX priority; it does not require a new workspace model. [L5]

## What Pi actually does

| Operation | Pi 1.0.2 interface | Semantics |
| --- | --- | --- |
| Inspect full history | `get_entries { since? }` | All entries, including abandoned branches and pre-compaction history; returns `leafId`. `since` excludes the cursor entry; unknown cursor fails. |
| Inspect tree | `get_tree` | A forest of `{ entry, children, label?, labelTimestamp? }`, plus `leafId`; multiple roots are valid. |
| Choose fork prompt | `get_fork_messages` | `{ entryId, text }` candidates. Implementation scans **all** entries, not just the active branch; textless/image-only user messages are omitted. |
| Fork before a user prompt | `fork { entryId }` | Creates and **switches to** a new session containing the ancestors before that user entry. Returns `{ text, cancelled }`; selected prompt is an editable draft, not yet submitted. |
| Duplicate current position | `clone` | Fork at the current leaf, including that entry. Returns `{ cancelled }`; empty leaf is rejected. |
| Navigate inside the same session | `AgentSession.navigateTree()` / command-context `ctx.navigateTree()` | Changes the active position without deleting other branches. **No corresponding stdin RPC command.** |

Sources: documented commands [P1], complete RPC command union/dispatch [P2], actual fork and tree
implementations [P3–P5]. The documentation's “active branch” wording for `fork` is narrower than the
1.0.2 implementation: the isolated RPC probe successfully forked from an abandoned branch.
Treat that as version-specific observed behavior, not a promise for every CLI override.

### Navigation is not transcript scrolling

Selecting a user entry moves the leaf to its **parent**, returning its text for editing. Selecting
an assistant/other entry generally places the leaf **at** that entry. Custom-message entries also
use parent-plus-editor-text semantics. Selecting the existing leaf is an early no-op, even when it
is a user entry. A subsequent prompt creates a new path; the old path remains. [P4]

`get_messages` is the active, compacted/context-edited model projection, **not** the complete tree.
Piano currently renders that projection. Tree previews may show raw historical content that is no
longer in model context; simply scrolling Piano's current messages cannot recover abandoned or
compacted history. Use actual persisted entry IDs, not content matching or message indexes. [P1, P5, L1]

### Navigation can call a model or be vetoed

`navigateTree(targetId, { summarize, customInstructions, replaceInstructions, label })` can summarize
the abandoned path into a `branch_summary` on the destination path. This is potentially paid model
work, with retry, failure and abort behavior. `session_before_tree` can cancel even when summarization
is off; extensions can supply a summary or modify instructions/labels. `session_tree` notifies
extensions after navigation. Fork/clone can be vetoed by `session_before_fork`. [P3, P4, P7]

Do not wait for `agent_settled` to declare an idle navigation complete: it need not start an agent
run. `session_tree` is an extension lifecycle event, not an ordinary RPC session event. Read back
`get_entries`/`get_tree`, `get_messages`, `get_state` and stats after a confirmed operation. Pi rejects
navigation during streaming/compaction; Piano should also reject it during queued, retrying,
dialog-blocked or otherwise uncertain work rather than silently aborting or clearing queues. [P2, P4, P8, L1]

### Two persistence traps

1. **A leaf-only move is in memory.** `SessionManager.branch()` and `resetLeaf()` do not append to
   the file. Reopening reconstructs the leaf from the last appended entry. Navigation with a summary,
   label, or a later prompt can persist a new path; navigation without any append does not. A file
   peek can therefore disagree with the live child. Piano retires quiescent children after 30 minutes
   by default, so this is a product issue, not just a server-crash edge case. [P4, P5, L2]
2. **A fork before the first prompt can have no file yet.** Pi assigns a new ID/path, but only writes
   a fresh file once there is a user or assistant message. Forking to a setup-only prefix has the
   same concern. “Fork succeeded, now stop and reopen the new file” is not a safe universal strategy.
   The source file is unchanged and the new session header tracks `parentSession` once persisted. [P3, P5]

For navigation, choose a policy before implementation:

- Preserve exact Pi behavior and retain the child while a leaf-only selection is unpersisted.
  This survives browser reconnect, **not** server/process restart. Do not claim restart persistence.
- Or explicitly persist successful Piano navigation using a small non-context custom entry through
  **Pi's extension interface**, after the move. This keeps state in Pi's store and avoids a registry
  leaf override. It changes history by adding a checkpoint and needs compatibility tests, particularly
  for root moves, summaries and extension hooks. Never append on preview or cancelled navigation.

The second is a plausible Piano policy, not an existing Pi guarantee or a tested part of this research.
Do not rewrite JSONL, add a fake user message, manufacture a summary, or store an independently
replayed conversation tree in the registry to hide the problem. [P5, P6, L5]

## Filling the navigation gap

### Preferred on pinned Pi: a narrowly scoped extension bridge

Load a packaged Piano-owned extension explicitly with `--extension <absolute-path>` while retaining
normal user/project resources. Register a namespaced command that validates a request and calls
`ctx.navigateTree()`. This interface is bound in RPC mode today, and the isolated probe confirmed
that it moves the live leaf without a model request when `summarize: false`. [P2, P6, P9]

The bridge needs more than a one-line slash command:

- **Capability check before dispatch.** Verify command discovery/source and bridge version. If it
  is missing, fail closed: an unknown slash command can become model input. Revalidate after reload
  or runtime replacement; support or explicitly reject `PIANO_PI_CLI` overrides. [P4, P9, L6]
- **A correlated terminal result.** `ctx.navigateTree()` exposes only `{ cancelled }` through the
  command context; RPC discards the SDK's `editorText` and `summaryEntry`. Furthermore a throwing
  command handler still yields `prompt` disposition `handled`, with a separate `extension_error`.
  Neither `handled` nor unchanged `leafId` proves success/cancellation. [P2, P4, P6]
- **Explicit bridge transport.** One possible adapter uses a versioned, request-ID-bearing machine
  payload in a supported `ctx.ui.notify()` record, intercepted privately by PiSessions instead of
  displayed as a toast. The probe used notification transport only to demonstrate the seam; a
  production adapter must validate it, distinguish success/cancel/error, handle absence/timeouts,
  and leave ordinary extension notifications untouched. Don't scrape human-readable notification
  text or append result messages to model context. An explicit private channel is another option,
  but adds lifecycle complexity; don't build both speculatively. [P6, P10]
- **Busy/abort lifecycle.** Track navigation as an in-flight operation until the bridge result and
  readback finish. Keep stdout draining and dialog responses/abort enabled. Summary work can exceed
  Piano's 30-second RPC acknowledgement timeout; timeout is not cancellation. Define an operation
  deadline/cancellation policy rather than treating a late result as an invitation to retry. [P4, L1]
- **Draft result only for the initiator.** Read the target entry before moving; return its text and
  explicit attachment handling through Piano's action result, not a broadcast editor replacement.
  Do not auto-submit. Both native fork and navigation editor text omit image content. Preserve the
  existing draft or ask before replacing it; don't silently resend `[REDACTED]` previews as original
  prompt content. [P3, P4, L1]

### Better long-term: upstream native navigation RPC

A proposed `navigate_tree` command could expose the existing operation and return cancellation,
editor text and authoritative resulting leaf. Matching typed client methods/docs/tests would remove
the private bridge transport. It would **not** by itself solve Piano's host ownership, draft,
retirement or leaf persistence problems. This command is a proposal, not available functionality.

The refreshed upstream checkout at `eb326d265ae0b88489a6d10319307780df827cdf` still has no such command;
its RPC types/dispatch were unchanged from v1.0.2. This is a source checkpoint, not a compatibility
claim for an unpinned newer release. Search results also surfaced historical extension-session work;
the installed/tagged code, rather than that older issue, determines the recommendation. [P2, P11]

Rejected shortcuts: embedding the whole SDK conflicts with the existing process-isolation decision;
opening a second TUI/SDK writer risks duplicate ownership; editing the session file bypasses live
context/tool restoration and extension hooks. `SessionManager.forkFrom()`/CLI `--fork` are also not
substitutes for native “fork before this entry”: the former copies source history across cwd rather
than implementing the interactive runtime fork transition. [P3–P5, L5]

## Piano implementation shape

### 1. Tree inspection without a competing history

Add browser-vocabulary `SessionAction` / result variants for reading the conversation tree and
performing navigation/fork, leaving all Pi commands and bridge details in `server/PiSessions.ts`.
Return a bounded, flat projection: entry ID, parent ID, kind/role, timestamp, short redacted preview,
optional label, active-leaf/path information and allowed actions. Preserve underlying ancestors when
filtering visible rows. Fetch full entry details only when needed; don't send every tool result or
base64 image to render a picker. [L1, L3]

Prefer on-demand `get_entries` for a flat projection, or flatten native `get_tree` server-side; don't
recursively expose the entire native forest as a browser protocol. Initial reads can be large,
so measure payloads against Piano's 8 MiB delivery limit. `since` is an append cursor, **not** a
navigation cursor: an empty delta can still carry a changed `leafId`. Invalidate/refetch after known
mutations and at settled boundaries while the picker is open; no per-token polling. [P1, L1, L3]

Piano's `RenderMsg.id` values are generated display IDs (`m0`, etc.), not Pi entry IDs. Start with a
separate tree picker using authoritative IDs. Inline “Fork from here” actions need a reliable
source-entry mapping, including context edits/compaction; never infer it from matching text. [L1]

For inactive sessions, a read-only `SessionFiles` projection can inspect persisted history. Starting
an action acquires the canonical live host and refreshes from it first. Do not file-peek a running
child to determine its selected leaf. Keep the registry's explicit session-selection model. [L2, L4]

### 2. Navigation is a serialized session mutation

Include a request identity and expected host generation/leaf or tree revision in mutation requests.
Validate under an operation gate shared with prompt/model/history-changing actions, not just a
browser-side disabled state. Two tabs must not both act successfully on an obsolete branch selection.
Do not hold a gate that also blocks the dialog answer or abort needed to finish the operation.
Broadcast one consistent refreshed context/state/tree position; discard pre-navigation readbacks and
clear obsolete pending/tool projections. Preserve generation/sequence guarantees. [L1–L3, L5]

### 3. Fork is a host-ownership transition, not just another RPC case

Currently `PiSession.spec`, cursor identity and `SessionHosts`' canonical map key are fixed when the
child opens. `refreshState()` reads file/model/name but does not adopt a new `sessionId`. Simply
adding `child.request({ type: "fork" })` would leave a child operating on the fork while Piano routes
it, caches stats and publishes frames under the original session. [L1, L2]

A safe transition should:

1. Claim the source operation and prevent competing prompts/fork/release/archive/delete; continue
   supported dialog and abort handling. Fence outgoing records/readbacks during runtime replacement
   so new-session extension events cannot be published under the old identity.
2. Ask Pi to fork. On `{ cancelled: true }`, retain the old host/registry identity and draft.
3. On success, read Pi's new ID/file/state. Adopt the same child under the new canonical session key,
   reset its session projection and observation generation, and register the **Pi-created** identity.
   Extend the host's registration policy: its existing `create` path only permits server-generated IDs.
4. End the old session attachment with an explicit transition outcome, not an apparent crash. The
   source remains registered and its file is untouched. Other tabs stay on/reload that original
   session; only the initiating tab follows the fork and receives its editable prompt.
5. Transfer the child scope/observer ownership atomically; don't duplicate, prematurely kill, or
   indefinitely associate the child with both keys. Model/thinking/name/stats are read back, not
   inherited optimistically from the source cache.

This likely needs an internal runtime/attachment distinction inside PiSessions plus a coordinated
SessionHosts transition. Keep that complexity behind those modules, not in React or raw RPC handling
in WsClient. A retire-and-reopen shortcut needs separate handling for unsaved forks and re-executes
startup/extension lifecycle; it should not be the default. [P2, P3, L1–L4]

If Pi changes identity but registration/readback fails, report **partial/uncertain success** and
reconcile the actual child before accepting more actions. Never automatically repeat a fork after
timeout or reconnect. A first-prompt fork's unpersisted header also needs a deliberate retirement/
shutdown policy; don't pretend a file is durable merely because `get_state` supplies a path. [P3, L5]

Store only session references and small relationship metadata in the registry. Pi's `parentSession`
is authoritative for file ancestry; any cached source ID/entry and shared workspace relationship
must be identified as integration metadata, not copied transcript. A conversation fork does not
create a Git branch/worktree or restore edited files. Creating an isolated checkout is a separate
Worktrunk action and requires an explicit concurrent-writer policy. [P5, L5]

### 4. Quiet UI

- Add **Conversation tree** to the session menu and the View group in Mod+K. Use an on-demand
  searchable outline, not a permanently visible graph.
- Preview selection is read-only. Explicit actions distinguish **Continue from here** (same session)
  and **Fork session** (new session). Keep the current position visible, with technical entries
  collapsed/filtered but available when needed.
- Offer **Summarize branch being left** explicitly rather than spending model credits on every move.
- Put “Same worktree; files are unchanged” at the action decision, not as a permanent transcript warning.
- Defer clone, label editing and cross-worktree fork orchestration unless the workflow needs them.
  Add corresponding palette rows whenever menu/header actions ship. [P7, L5, L7]

## Suggested delivery and verification

1. **Read-only tree:** authoritative IDs/leaf, forest handling, filtering, compacted and abandoned
   history, bounded/redacted payloads. No claim that selection changes the model context.
2. **Navigation bridge:** capability/result handshake, cancellation and paid-summary behavior,
   state replacement, two-tab stale-action rejection, draft/attachment handling, persistence policy.
3. **Fork ownership:** successful and vetoed transitions, before-first-prompt unsaved fork, concurrent
   actions, failed registry writes and lost acknowledgements; source remains usable and exactly one
   child owns each canonical identity. Reuse this transition later for clone if wanted.

Order fork before navigation if separate-session alternatives are the immediate need; it does not
need the bridge, but it still needs the ownership work. These are separate, reviewable slices.

For implementation, test observable contracts through PiSessions/SessionHosts, with fake Pi for
race/failure coverage. Run `npm test` and `npm run typecheck`, plus scratch `agent-browser` journeys:
open tree after compaction, preview without mutating, navigate and send a different short prompt,
return to the other branch, fork and revisit the source, reconnect from two tabs, then exercise
retirement/restart. Include cancellation and a draft with an image. Use one short real-model prompt
only where model-context behavior needs confirmation. Existing tests do not establish these new
contracts just because ordered delivery is already covered. [L5]

## Evidence and limitations

Source/document review plus an isolated **real Pi 1.0.2 RPC probe**, Node **v24.21.0**, Linux.
Command: `node /tmp/piano-tree-research-4WuBh7/probe.mjs`.
Final output retained at `/tmp/piano-tree-research-4WuBh7/output-final.log`; probe and minimal
extension remain beside it. Scratch session/config/workspace directories were removed in `finally`.
No credentials, model requests, Piano registry, live backend or worktrees were used.

```text
PASS: leaf-only branch changes memory; reopen restores last appended entry.
PASS: get_tree reads the active leaf; get_fork_messages includes abandoned-branch user messages.
PASS: direct navigate_tree rejected: Unknown command: navigate_tree
PASS: extension navigation handles without model work; selecting another user message moves to its parent.
PASS: live navigated leaf differs from read-only file view before another append.
PASS: failed extension navigation still returns prompt disposition=handled plus extension_error.
PASS: fork accepts abandoned-branch entry, changes child identity, copies only ancestors, and stores parentSession.
PASS: fork before first user has a new ID/path but no file until conversation content is appended.
ALL RESEARCH PROBES PASSED; no model requests, no Piano server, no user registry.
```

The first probe incorrectly expected the last user entry to remain the leaf after CLI startup;
Pi appended startup metadata. The corrected probe compares with the actual authoritative leaf.
The initial failure is retained in `output.log`; it was a fixture assumption, not a Piano defect.

Not verified here: browser UX, production bridge transport, model-generated summaries, extension
veto/race behavior, image restoration, durable custom checkpoints or host adoption. Those are
implementation gates, not results of this research. Document review checked source accuracy;
all 18 local links and 20 pinned upstream source paths resolved, and `git diff --check` passed.
No application run or code test suite was needed for this documentation-only change.

## Sources

Pi links are pinned to v1.0.2 unless explicitly noted. Installed `dist` implementations were read
alongside the docs and checked against the matching source symbols.

- **P1:** [RPC commands](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/rpc-commands.md), especially Session; [sessions](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/sessions.md).
- **P2:** [RPC command types](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/src/modes/rpc/rpc-types.ts); [RPC dispatch and extension bindings](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/src/modes/rpc/rpc-mode.ts), `rebindSession` (navigation binding at L329), fork/clone/tree cases at L611–652.
- **P3:** [AgentSessionRuntime](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/src/core/agent-session-runtime.ts#L262), `fork`, runtime teardown/replacement and hook dispatch; [SDK runtime example](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/examples/sdk/13-session-runtime.ts).
- **P4:** [AgentSession](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/src/core/agent-session.ts), `navigateTree` (L3915), `getUserMessagesForForking` (L4112), `_tryExecuteExtensionCommand` (L2069), abort and compaction state.
- **P5:** [SessionManager](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/src/core/session-manager.ts), `_buildIndex` (L1103), persistence (L1166), `branch`/`resetLeaf` (L1579–1593), `createBranchedSession` (L1632), `forkFrom`; [session format](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/session-format.md).
- **P6:** [Extension contracts](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/extensions.md); [command-context types](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/src/core/extensions/types.ts), `ExtensionCommandContext`; [bookmark example](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/examples/extensions/bookmark.ts).
- **P7:** [Compaction and branch summarization](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/compaction.md), Branch Summarization and `session_before_tree`.
- **P8:** [JSON event stream](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/json.md); [RPC mode](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/rpc.md).
- **P9:** [CLI options](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/cli.md), explicit extensions, session selection and offline mode; [environment](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/environment-variables.md).
- **P10:** [RPC extension UI](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/rpc-extension-ui.md), notification/editor limits; [SDK](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/sdk.md), authoritative SessionManager and runtime replacement.
- **P11:** [Upstream RPC types at inspected HEAD](https://github.com/earendil-works/pi/blob/eb326d265ae0b88489a6d10319307780df827cdf/packages/coding-agent/src/modes/rpc/rpc-types.ts); search discovery: [official releases](https://github.com/earendil-works/pi/releases), [historical extension switchSession issue #1187](https://github.com/earendil-works/pi/issues/1187) (background only, not current-interface evidence).
- **L1:** [PiSessions](../../server/PiSessions.ts), `openSession`, `refreshState`, `refreshContext`, `currentState`, `act`; [PiRecords](../../server/PiRecords.ts), `serializeMessages`; [wire vocabulary](../../shared/wire.ts).
- **L2:** [SessionHosts](../../server/SessionHosts.ts), keyed ownership, `reference`, `open`, retirement; [server main](../../server/main.ts), `IDLE_MS`.
- **L3:** [WsClient](../../server/WsClient.ts), selection/attachment/action routing and delivery limits; [browser store](../../web/src/store.ts), selection/cursor and action-result handling; [DisplayProjection](../../server/DisplayProjection.ts).
- **L4:** [SessionFiles](../../server/SessionFiles.ts), read-only context projection and file discovery; [Registry](../../server/Registry.ts).
- **L5:** [ADR 0001](../adr/0001-pi-rpc-workspace-workbench.md), [invariants](../development-invariants.md), [roadmap](../roadmap.md), [testing policy](../testing.md).
- **L6:** [PiCli](../../server/PiCli.ts), locked default CLI and explicit overrides.
- **L7:** [Project instructions](../../AGENTS.md), quiet UI/palette rules; [SessionActions](../../web/src/components/SessionActions.tsx), [CommandPalette](../../web/src/components/CommandPalette.tsx).
