# Taking full advantage of Pi's tree and fork in Piano

Researched **2026-10-08** against Piano `71a5ed17c030d24144f7b350cb6b0224d90df9b6`,
its exact Pi **1.1.0** dependency, and upstream tag
`abe508e1b89912adde45528136c3221eb69acdd7`.
This extends the [Pi 1.0.2 feasibility note](2026-10-07-pi-tree-fork.md), refreshing its
version checkpoint and product recommendations. It is research, **not implemented behavior or a new ADR**.
The [stacked implementation plan](../pi-tree-fork-plan.md) applies these findings to five visible,
individually verifiable feature PRs on the rebased SQLite-registry baseline.

## Recommendation

**Make the conversation tree a practical way to revise, explore and return—not a permanent graph.**
Use branches inside one session for related alternatives; use forks for alternatives that deserve
independent sessions. Preserve Pi's RPC process boundary.

The highest-value complete journey is:

> Find an earlier decision → preview it → revise or explore from there → return to the original
> path, optionally carrying a summary → continue without losing either history.

Follow that with **Fork session** and **Duplicate session** for independent work/model comparisons.
Add a separate worktree choice only when Piano can establish the intended code revision and writer
ownership. **Conversation history is not a filesystem snapshot.** These recommendations fit the
current daily-use priority and INV-01–05, INV-07–09 and INV-11–12. [L1]

## 1. Which operation serves which workflow?

| User goal | Recommended Piano action | Pi semantics / limit |
| --- | --- | --- |
| Find an old answer, including a compacted or abandoned path | **Conversation tree** → preview | Read `get_entries` or `get_tree`; do not move the active leaf merely to inspect history. |
| Correct an earlier instruction without deleting the first attempt | **Revise prompt** | Navigate to a user entry: Pi selects its parent and returns text for an editable draft. Submitting creates another path in the same file. |
| Try another approach after an answer | **Continue from here** | Navigate to an assistant entry and continue after it. No summary is the clean alternative. |
| Investigate a tangent, then return with what was learned | **Continue from here** + optional **Carry a summary** on return | Pi summarizes the path being left and appends a `branch_summary` at the destination. This is the distinctive advantage over simply truncating chat. |
| Give an alternative its own sidebar presence and lifecycle | **Fork session** | Native `fork` starts a new session **before a selected user prompt** and returns that prompt as a draft. |
| Continue independently from the current stopping point | **Duplicate session** | Native `clone` copies the current active path **including the current leaf** into a new session. Useful before changing models or starting a separate review. |
| Split into a session after an older assistant answer | **Fork from here**, later | Extension `ctx.fork(entryId, { position: "at" })` supports it; native RPC `fork` only exposes the before-user form. Avoid navigation-then-clone as an invisible two-step source mutation. |
| Remember a useful decision/return point | **Bookmark** | `pi.setLabel(entryId, label)` persists a Pi label, visible to other Pi interfaces. Not a code checkpoint or verification result. |
| Run two writing alternatives concurrently | Separate sessions **and separate worktrees** | Pi fork/clone changes conversation identity only. Worktrunk and Piano must separately establish the checkout and code starting point. |

The operation semantics are Pi-owned; names and delivery order above are recommendations. Native
fork/clone **switch the existing RPC child into the new session**; they do not spawn a second child
or leave it attached to the source. A tree has one live selected leaf, shared by every browser tab;
it is not parallel execution of multiple branches. [P1–P5, L1]

### Concrete journeys

- **Recover from a wrong approach:** bookmark the current answer, revise the earlier instruction,
  submit a different approach without a summary, and later inspect both paths. Keep the source
  prompt's images or explicitly ask to reattach them: Pi's draft return is text-only. Nothing undoes
  files already edited by the rejected approach. [P2, P4]
- **Investigate and return:** bookmark the main stopping point, explore a question, then navigate
  back with summary focus such as “Preserve findings, rejected options, relevant paths and remaining
  uncertainty.” Read the resulting summary before relying on it. This transfers conversation context,
  not code changes or proof that checks passed. [P6, L1]
- **Compare models:** duplicate a common stopping point, explicitly choose another model and submit
  the same next instruction. Use read-only work or equivalent isolated checkouts for a meaningful
  comparison. Forking the conversation alone does not equalize files, tools or external state.
  A clone also retains prior answers; use a fresh session against a fixed candidate for an independent
  review rather than assuming a new session ID removes that influence. [P2–P5, L1]
- **Promote an alternative:** keep it in the same tree while exploring; fork it when it becomes
  independent work. Inherit the outcome-project grouping only as an explicit Piano policy; preserve
  workspace identity. Do not automatically inherit a PR association or verification approval. [L1, L4]

There is no native cross-session conversation merge. A branch summary transfers context **within
one session tree**. Bringing findings from an independent fork back to its source needs an explicit
reviewed message/summary handoff; don't present that as native tree navigation. [P2, P6]

## 2. What Pi 1.1.0 actually exposes

| Capability | Available route | Important distinction |
| --- | --- | --- |
| Full history and active position | RPC `get_entries { since? }`, `get_tree` | Includes pre-compaction/abandoned entries. `since` is append order; the leaf can change without any new entries. A tree may have multiple roots. |
| Current model context | RPC `get_messages` | Compacted/context-edited active projection, not the full history. |
| Fork candidates | RPC `get_fork_messages` | Implementation scans **all entries**, including other branches; it omits textless user messages. The docs' “active branch” wording is narrower than observed behavior. |
| Before-user fork; current-position copy | RPC `fork`; `clone` | Both replace the runtime/session identity and can be vetoed by extensions. |
| Same-session navigation | Command-context `ctx.navigateTree()` | Still **no native `navigate_tree` RPC**. Supports summary, custom focus, instruction replacement and label options. |
| Bookmarks; arbitrary-entry fork | `pi.setLabel()`; command-context `ctx.fork(..., { position: "at" })` | Extension APIs, not native label/arbitrary-position RPC commands. |
| Copy saved history into another cwd | CLI `--fork` / `SessionManager.forkFrom()` | Copies **all saved non-header entries**, not just one path; includes abandoned branches and uses the saved leaf. No Git operation. |

Sources: RPC docs/dispatch, navigation/runtime and storage implementations [P1–P5]. The RPC source,
SessionManager, runtime fork and branch-summary implementation are unchanged from v1.0.2 to v1.1.0.
The refreshed upstream main checkpoint `ce950d78f424dcaf9f5d6a03ce80ab141130eb1d` also has no native
navigation command; that is an unpinned source observation, not a release compatibility promise. [P10]

**Do not send `/tree`, `/fork` or `/clone` as ordinary prompts.** These are TUI built-ins, not RPC
prompt commands. A missing extension command can fall through to model input. [P1]

### Navigation is not full runtime rollback

In 1.1.0, `navigateTree()` replaces the projected messages and restores the declared tool loadout,
subject to currently registered tools and current restrictions. It **does not restore the historical
model or thinking level**. Those live selections remain unless an extension changes them. Fork/reopen
recreates the runtime and resolves branch settings, subject to startup overrides, availability and
fallbacks. Piano should read the resulting state, not infer it from the selected row. [P2, P3, P5]

Neither operation restores tool implementations, arbitrary extension variables, files or external
services. Extensions must handle `session_tree` to reconstruct branch-sensitive state; fork instead
tears down/restarts the extension runtime. Pi 1.1.0's tool pattern/MCP activation restrictions also
apply to restored declarations. Never describe this as replaying the exact historical environment. [P2, P3]

### Summaries are useful, deliberately lossy context

- The summary covers the old path back to, **excluding**, its common ancestor with the selected
  target—not the entire tree or destination path. The selected user prompt can itself be that excluded
  ancestor even though navigation then moves to its parent. [P2, P6]
- Built-in preparation favors recent messages within a token budget. It **skips tool-result bodies**;
  assistant tool calls and existing summaries can contribute. It operates on raw collected entries,
  so `context_edit` omissions are not a guarantee that omitted material stays out of the summary.
  Images are not carried as image inputs by the text serialization. [P6]
- Model-generated summaries can spend credits, retry, fail or be aborted. They use the current
  summarization model resolution, not the destination's historical model. An extension can veto
  navigation or supply a summary. A successful handled-command acknowledgement is not enough to
  establish the navigation outcome. [P2, P6, P7]
- Default to **no summary** for a clean alternative. Make carrying findings an explicit choice with
  optional additional focus. Advanced `replaceInstructions` is unnecessary in the first UI; ordinary
  custom focus augments the default prompt rather than replacing it. [P6, P8]
- Pi's session usage includes all branches and successful recorded summaries. Forks copy historical
  usage entries, so adding source and fork totals double-counts shared history. Do not advertise
  those totals as incremental fork cost or promise a cheaper request/cache hit after navigation. [P2, P4]

Summary content is not evidence, a complete file inventory, or a security redaction boundary.
Keep check artifacts/revision identities separate under INV-08–09. [L1]

## 3. Recommended Piano surface

Use an on-demand **Conversation tree** in the session menu and Mod+K's **Session commands** group
(the old note's proposed “View group” no longer matches the palette). Keep the normal conversation
view focused on the active context. [L5]

1. A searchable outline of prompts, answers, summaries and bookmarks, with preview beside/below it.
   Default to useful conversation entries; offer prompts-only, bookmarks and technical details on
   demand. Preserve true parent IDs when hiding intermediary rows.
2. Keep **current position** distinct from **previewed entry**. Previewing, searching and opening a
   bookmark never changes the model context. Provide “Show current position” independent of filters.
3. Show only actions valid for the selected entry: **Revise prompt**, **Continue from here**,
   **Fork session**. Put **Duplicate session** at session level. Add matching palette rows for
   menu/header actions; no new global shortcut.
4. Preserve the existing composer draft before replacing it; return the recovered prompt only to
   the initiating tab, never broadcast an editor overwrite. Do not auto-submit recovered text or
   mistake display-redacted/expanded skill text for the original composer input.
5. At the action decision, say **“Conversation only; files stay as they are.”** No permanent warning
   banner. Keep summary choice off by default and show operation progress/cancellation only while
   there is actual work.
6. Bookmarks should target an explicit entry ID or the active path. The shipped bookmark example
   scans all entries backward and can mark an abandoned branch; don't copy that selection policy.
   Labels are resolved across the whole file, and labeling appends at the current leaf—even when
   labeling another branch—so it is a serialized session mutation. [P4, P8, L2, L5]

Do not begin with a large graph, automatic branching of every prompt, automatic summaries,
branch-specific cost dashboards, or an autonomous reviewer system. The browser advantage is easy
inspection and deliberate alternatives, not a replica of every TUI control. [L1]

## 4. Implementation consequences that cannot be skipped

The earlier note describes the adapter mechanics in more detail. These are the decisive constraints
for the current code, not just UX polish.

### A. Authoritative entries, not rendered-message indexes

`PiSessions` currently asks for `get_messages`; `PiRecords` creates display IDs, not Pi entry IDs.
`SessionFiles` also reads only the active projection. Add an on-demand, bounded/redacted tree
projection using authoritative entry and parent IDs; never match rows to history by text. Scope IDs
by session because forks retain inherited entry IDs. Fetch image/full-tool content only for an
explicit detail request. Keep raw history and summary storage in Pi, not Registry. [L2, P4]

For a live session, read its leaf from the live child, not the file. For inactive sessions, reuse
Pi's read-only SessionManager APIs behind `SessionFiles`; acquire/refresh the canonical host before
mutating. Expose only browser-vocabulary actions/results across `shared/wire.ts`; keep raw RPC and
extension transport inside `PiSessions`. [L2, L3]

### B. A narrow, explicit extension bridge

Keep the process boundary. Explicitly load a Piano-owned, versioned extension for navigation and
labels while preserving normal user/project resources. Discover/validate its capability before
sending its namespaced command; fail closed if missing or replaced. [P7, L1]

RPC's command-context binding returns only `{ cancelled }`, dropping the SDK's `editorText`,
`summaryEntry` and `aborted` details. Use a correlated machine result, not a human toast or mere
`prompt: handled`. `session_tree` is an extension lifecycle event, not a normal RPC completion event.
The old note's private, validated notification envelope is one viable transport;
upstream native navigation RPC would be preferable. A source lookup can recover draft content, but
must account for Pi's same-leaf no-op and cancellation. Keep draft text/attachments separate from
safe display previews. [P2, P7]

Serialize history/model/prompt mutations with expected host generation and leaf/revision, while
still allowing the abort and dialog responses needed to finish them. Two tabs cannot independently
change the same session's execution branch. Fence old readbacks and broadcast a consistent new
context/position after success. A timeout is **uncertain**, not an invitation to retry or fork again.
Native/extension lifecycle hooks must remain in the execution path. [L1–L3]

### C. Durable position is a policy, not a Pi guarantee

A leaf-only move changes memory; reopening chooses the last appended entry. Piano retires idle
children, so relying on that memory silently loses a user's selection. [P4, L3]

A non-context custom checkpoint appended **through Pi** after confirmed navigation is a plausible
policy. The probe confirmed it preserves both ordinary and root selections in an existing
conversation file without adding model-visible messages. It is not a complete solution:

- it adds a real entry and changes the leaf;
- it does not reconcile live model/thinking with historical branch settings on restart;
- a brand-new conversation-free fork still does **not** create a file from a custom entry alone;
- root, summary, hook, cancellation and restart behavior need integration verification. [P2, P4]

Choose and verify the persistence policy before shipping mutations. Until an empty fork is saved,
retain its host or give it an explicit discard lifecycle; a returned file path is not durability.
Do not manufacture a user message, rewrite JSONL, or maintain a second tree/leaf replay in Registry.
The alternative—retaining an unpersisted navigation only in memory—must not claim restart survival.

### D. Fork/clone require host adoption

Today `PiSessions.spec`, observation cursor and `SessionHosts`' canonical key are fixed at open;
`refreshState` does not adopt a changed session ID. Simply adding a native `fork` request would make
Piano publish new-session work under the original identity. [L2, L3]

The operation must claim the source, execute Pi's transition, read the new identity/state, atomically
adopt the child under that identity with a new observation generation, and register the Pi-created
session reference. Leave the source registered and independently reopenable. Only the initiating tab
follows the fork; other tabs should remain on the original, not silently follow a different session.
Suppress wrongly attributed transition-time events and coordinate release/archive/delete. [L3]

Veto leaves the source and draft unchanged. If Pi changes identity but registry/readback fails,
reconcile partial success before admitting new work; never blindly replay. Stopping and reopening
is not a universal shortcut because a before-first-prompt fork can have no file. Reuse this adoption
mechanism for clone and later arbitrary-entry fork rather than inventing three ownership paths.
Store only references and small lineage metadata; Pi's `parentSession` owns file ancestry. [P3, P4, L1]

### E. An isolated-code fork is a separate later capability

If the user chooses a new worktree, first define its source revision, treatment of uncommitted files,
and writer ownership. A new checkout from HEAD does not reproduce today's dirty working tree.
Use Worktrunk for creation and retain explicit workspace/revision provenance. [L1]

CLI `--fork` can seed a new cwd and accept a server-chosen session ID, but copies the **entire saved
tree** and cannot capture an unpersisted live leaf. It is suitable only when that full-history copy
is the intended, quiescent input. Entry-scoped cross-worktree transfer needs a separately designed
Pi-owned extraction/handoff; don't disguise a full-tree copy as native fork-from-here. [P4, P9]

## 5. Suggested delivery and acceptance gates

| Slice | Observable acceptance | Main contracts |
| --- | --- | --- |
| **1. Inspect** | Find compacted and abandoned history; search/preview without changing context; correct roots, IDs, bookmarks, payload limits and redaction. | INV-01, 05, 11–12 |
| **2. Revise, explore, return** | Navigate to a prompt/answer, preserve drafts/images, make another path, return with/without summary; veto/abort/error are distinct; two-tab stale requests fail; retirement/restart obey the chosen policy. Add bookmark mutation using the same bridge/gate. | INV-02–05, 07, 12 |
| **3. Independent alternatives** | Fork and duplicate, continue the new session, revisit the source, reconnect both; one owner per identity; handle first-prompt unsaved forks, veto and registry failure without replay. | INV-01–05, 07, 12 |
| **4. Isolated writing**, deferred | Two sessions modify separate worktrees from an explicit captured starting revision; no implied filesystem rollback or inherited verification. | INV-06–10 |

Slice 3 can precede 2 if independent sessions are the immediate need: native RPC avoids the bridge,
but **does not avoid host-adoption work**. Include clone once that shared transition is proven;
unlike the earlier minimal feasibility proposal, it deserves an early user-facing action.

For implementation, exercise contracts through `PiSessions`/`SessionHosts`, using fake Pi for races,
lost replies and hook outcomes. Run `npm test`, `npm run typecheck`, `npm run lint`, and scratch
`agent-browser` journeys. Use a short real-model summary only to verify the actual paid-summary path;
source inspection or a supplied summary does not prove provider behavior. Do not deploy as part of
research or verification. [L1]

## Evidence and limitations

Source/doc review, an independent background source audit, and isolated real **Pi 1.1.0** RPC/storage
probes on **Node v24.21.0**, Linux. Installed implementations were checked alongside tagged source.
Web discovery returned older issues; interface conclusions come from versioned first-party code,
not those historical requests.

Commands and output retained under `/tmp/piano-tree-fork-research-20261008/`:

```text
node probe.mjs         → rpc-probe.log: 9 assertion groups passed
node storage-probe.mjs → storage-probe.log: 6 assertion groups passed
```

Observed: absent native navigation; extension navigation without a model run; live/file leaf
mismatch; handled-command plus extension error; abandoned-branch fork; clone identity/ancestry;
unsaved first-prompt fork; full-tree/cwd copy; ordinary/root custom checkpoint persistence; empty
fork checkpoint limitation; raw/filtered summary preparation; global label resolution.
Probe source and full logs remain beside the independent `pi-audit.md`. Fixtures were removed by
`finally`; probes had isolated config/storage and made **no provider requests**. No real session,
registry, backend or worktree was modified.

Not verified: browser interaction, production bridge/host adoption, model-generated summaries,
extension races/vetoes, model/tool restoration in a live provider environment, or a complete durable
checkpoint policy. Those remain implementation gates. Document review checked the recommendations
against the current module boundaries and invariants; all **26 local link targets and 40 pinned Pi
source paths** across the new note and updated documents resolved. `git diff --check` passed.
No application run or code test suite was needed for this documentation-only change. [L1]

## Sources

Pi references are pinned to **v1.1.0** except the explicitly identified upstream checkpoint.

- **P1:** [RPC commands](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/rpc-commands.md), Session and Discoverable commands; [sessions guide](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/sessions.md).
- **P2:** [AgentSession](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/agent-session.ts), `navigateTree`, `_refreshFinalizedContext`, `_restoreToolsFromTranscript`, `_recordSelection`, `getUserMessagesForForking`, `getSessionStats`.
- **P3:** [AgentSessionRuntime](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/agent-session-runtime.ts), `fork`, `teardownCurrent`, runtime replacement; [SDK initialization](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/sdk.ts), model/thinking restoration.
- **P4:** [SessionManager](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/session-manager.ts), `_buildIndex`, `_persist`, `appendLabelChange`, `branch`, `resetLeaf`, `createBranchedSession`, `forkFrom`; [session format](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/session-format.md).
- **P5:** [RPC dispatch](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/modes/rpc/rpc-mode.ts), `rebindSession` and fork/clone/history cases; [command-context types](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/extensions/types.ts), `ExtensionCommandContext`.
- **P6:** [Branch summarization](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/compaction/branch-summarization.ts), `collectEntriesForBranchSummary`, `getMessageFromEntry`, `prepareBranchEntries`, `generateBranchSummary`; [serialization](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/compaction/utils.ts), `serializeConversation`; [compaction/summary reference](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/compaction.md).
- **P7:** [Extension contracts](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/extensions.md); [RPC extension UI](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/rpc-extension-ui.md); RPC binding in P5 and `_tryExecuteExtensionCommand` in P2.
- **P8:** [Interactive tree flow](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/modes/interactive/interactive-mode.ts), `showTreeSelector`; [tree selector](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/modes/interactive/components/tree-selector.ts), `applyFilter`; [bookmark example](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/examples/extensions/bookmark.ts).
- **P9:** [CLI options](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/cli.md); [CLI session selection](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/main.ts), `forkSessionOrExit`, plus P4.
- **P10:** [Upstream RPC types at inspected HEAD](https://github.com/earendil-works/pi/blob/ce950d78f424dcaf9f5d6a03ce80ab141130eb1d/packages/coding-agent/src/modes/rpc/rpc-types.ts); [v1.0.2 → v1.1.0 comparison](https://github.com/earendil-works/pi/compare/v1.0.2...v1.1.0). Discovery only: [historical CLI fork request #2290](https://github.com/earendil-works/pi/issues/2290), not current API evidence.
- **L1:** [ADR 0001](../adr/0001-pi-rpc-workspace-workbench.md), [invariants](../development-invariants.md), [roadmap](../roadmap.md), [testing policy](../testing.md).
- **L2:** [PiSessions](../../server/PiSessions.ts), `openSession`, `refreshState`, `refreshContext`; [PiRecords](../../server/PiRecords.ts), `serializeMessages`; [SessionFiles](../../server/SessionFiles.ts); [wire vocabulary](../../shared/wire.ts).
- **L3:** [SessionHosts](../../server/SessionHosts.ts), `reference`, `open`, `close`, retirement; [WsClient](../../server/WsClient.ts), selection/action delivery; [server idle policy](../../server/main.ts).
- **L4:** [Registry](../../server/Registry.ts), session references/grouping; [outcome-project plan](../outcome-projects.md).
- **L5:** [Project instructions](../../AGENTS.md), quiet UI and palette rules; [CommandPalette](../../web/src/components/CommandPalette.tsx); [SessionActions](../../web/src/components/SessionActions.tsx).
