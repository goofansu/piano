# Session fork UX: Pi semantics and web interaction

Date: 2026-10-12. Research, not an implementation plan approved for execution.

## Recommendation

Use **Fork session** in the latest completed assistant answer's action row, backed by Pi's
**`clone` RPC command**, for the requested journey: click → create → open the new session.
It preserves the answer the user was looking at. A literal Pi `fork` command does not.

Also make the same action available in the session menu and Mod+K Session commands, following
Piano's [command-surface policy](../../AGENTS.md#design). A latest-message action is a good
contextual shortcut, not the only discoverable/keyboard-accessible surface.

Keep a different action, **Fork before this message**, for revising an earlier user prompt.
That action maps to native Pi `fork(entryId)` and restores the selected prompt as an unsent draft.
It can be deferred if the first slice is only “continue this conversation separately.”
Do not silently use it behind an assistant-answer button: it would remove the very answer the
button appears to preserve.

Suggested interaction (product recommendation, not observed Piano behavior):

1. Offer the current-position action when the session is genuinely settled, has forkable history,
   and no conflicting operation is pending. A visible final answer alone is insufficient.
2. On click, show a local spinner/“Forking…” state and prevent duplicate submissions. Keep the
   original conversation visible. No confirmation dialog for this nondestructive operation.
3. Await the authoritative creation outcome, including extension cancellation, then register
   the new session identity and load its snapshot through Piano's normal selection path.
4. Once ready, navigate to the new session and focus its empty composer. Do **not** automatically
   send a prompt or request a new model answer. Leave the original session available.
5. On failure/cancellation, retain the current selection and existing draft. On an uncertain
   transport outcome, reconcile before retrying rather than creating another copy. If the user
   navigated elsewhere while creation ran, do not steal their new selection; offer to open the result.

Label/tooltip: **Fork session** — “Continue in a new session with this conversation.”
A secondary tooltip/detail can clarify “Uses the same working folder.” This is a conversation
copy, not a worktree creation or filesystem rollback. No persistent warning banner is needed.
For strict Pi terminology, **Clone session** is also accurate; whichever label is chosen, do not
mislabel the slash-command aliases: `/fork` and `/clone` have distinct native meanings.

## What Pi actually does

The installed dependency is `@earendil-works/pi-coding-agent` **1.1.0**. Its release commit is
[`abe508e1b89912adde45528136c3221eb69acdd7`](https://github.com/earendil-works/pi/tree/abe508e1b89912adde45528136c3221eb69acdd7).
The installed docs and implementation were inspected, not just current online documentation.

| Operation | Cut point | New session? | Composer afterward in Pi TUI |
| --- | --- | --- | --- |
| `/fork` | **Before** a selected user message | Yes | Selected prompt text, unsent |
| `/clone` | **At** the active leaf, including the current answer | Yes | Empty |
| `/tree` | Navigate the existing entry tree | No | Depends on selected entry |

Sources: [sessions guide](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/docs/sessions.md#choose-how-to-branch),
[runtime fork implementation](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/src/core/agent-session-runtime.ts#L262-L349),
and [TUI fork/clone handlers](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L5500-L5561).

### Using `/fork` in Pi's terminal

1. Type `/fork`.
2. Choose an earlier user prompt in the selector; the last candidate is initially selected.
3. Pi creates and opens a new session containing the branch leading **up to, but excluding**, that prompt.
4. Pi restores its text in the editor. Edit and send it when ready.

For `U1 → A1 → U2 → A2`, forking **U2** gives new history `U1 → A1` and draft `U2`.
Cloning gives new history `U1 → A1 → U2 → A2` and an empty editor.

The parent relationship is recorded in Pi's session header; `createBranchedSession` copies the
root-to-cut-point path, not every alternative branch in the original session tree.
[Session format](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/docs/session-format.md#sessionheader),
[branch persistence](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/src/core/session-manager.ts#L1627-L1730).

### RPC is not slash-command text

Use structured RPC commands, not `prompt("/fork")`:

```json
{"id":"choose-fork","type":"get_fork_messages"}
{"id":"fork-one","type":"fork","entryId":"<Pi user entry ID>"}
```

For the proposed latest-answer shortcut:

```json
{"id":"clone-one","type":"clone"}
```

`fork` returns `{ text, cancelled }`; `clone` returns `{ cancelled }`. Both can return
`success: true` with `cancelled: true` when an extension vetoes the operation. Neither response
contains the new session ID: read `get_state` afterward, then load the new history. The commands
already replace the active session **inside that same RPC child**; they are not detached factories
that leave that child on the parent. A second `switch_session` to the result is not the normal
Pi RPC flow. Browser navigation is a separate host responsibility.
[RPC commands](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/docs/rpc-commands.md#fork),
[RPC handlers](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L610-L635),
[SDK replacement contract](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/docs/sdk.md#session-storage).
Built-in TUI commands are explicitly not executable via `prompt` in the
[command-discovery documentation](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/docs/rpc-commands.md#get_commands).

A historical **assistant** message is not accepted by the native `fork` RPC command. The SDK
runtime can fork at an arbitrary entry with `position: "at"`, but this option is not exposed
by the `fork` RPC handler; `clone` supplies it for the current leaf only. Do not promise a
“fork after any past answer” action by merely wiring the existing RPC command.

Other edge cases from source inspection:

- Runtime replacement aborts active work during teardown. Disable the proposed action while
  working/queued/compacting/waiting rather than implicitly aborting. See
  [runtime teardown](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/src/core/agent-session-runtime.ts#L167-L179).
- Fork returns **text**, not a full image-bearing composer draft. Do not claim attachment-preserving
  prompt revision without addressing that separately. `getUserMessagesForForking()` filters for
  nonempty text and iterates all stored entries, despite RPC prose describing an active-branch
  fork. A client must not assume the candidate list is limited to the visible current branch.
  [Installed-version agent implementation](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/src/core/agent-session.ts#L4161-L4176).
- A fork before the first conversational entry can be an initially empty session. Pi lazily
  persists empty history, so “ready” cannot universally mean “a new JSONL file already exists.”
  [Fork creation](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/src/core/agent-session-runtime.ts#L290-L329),
  [persistence rule](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/coding-agent/src/core/session-manager.ts#L1714-L1729).

## Reference web UIs

These are static source observations at the pinned revisions below, not browser verification.

### T3 Code: closest match to the proposed interaction

At revision `5753207d53362608f281738eda3a9faf4e13b6be`, T3 Code has a **GitFork icon beside
Copy in the assistant-message action row**, labelled **“Fork from this response.”** It is offered
on eligible completed assistant messages, not just the last answer. Eligibility also accounts
for provider capabilities and a stable run ID. The button is disabled and its icon pulses while
its operation is pending.
[Button](https://github.com/pingdotgg/t3code/blob/5753207d53362608f281738eda3a9faf4e13b6be/apps/web/src/components/chat/MessagesTimeline.tsx#L2883-L2926),
[placement](https://github.com/pingdotgg/t3code/blob/5753207d53362608f281738eda3a9faf4e13b6be/apps/web/src/components/chat/MessagesTimeline.tsx#L2975-L2990),
[eligibility](https://github.com/pingdotgg/t3code/blob/5753207d53362608f281738eda3a9faf4e13b6be/packages/client-runtime/src/state/threadWorkflows.ts#L165-L185).

Its handler does precisely the useful two-stage wait:

1. Await fork creation.
2. Await the new session's client-side shell becoming available.
3. Navigate to it.

If creation fails, it stays put and reports the error. If creation succeeds but the client never
receives the new data, it reports **“The fork was created, but its thread data did not reach this
client. Reconnect and try opening it from the sidebar.”** It does not blindly navigate or create
a second copy. This distinction is worth adopting in Piano.
[Complete handler](https://github.com/pingdotgg/t3code/blob/5753207d53362608f281738eda3a9faf4e13b6be/apps/web/src/components/ChatView.tsx#L8663-L8708).

T3 Code's provider-independent run/context-transfer system is not Pi RPC, so its ability to
fork at historical answers is a UX reference, not evidence that Pi's `fork` command supports that.
Its backend records a new conversation and pending context transfer, with provider resolution
at first dispatch; Piano should not import that alternative history architecture.
[First-party lineage design](https://github.com/pingdotgg/t3code/blob/5753207d53362608f281738eda3a9faf4e13b6be/docs/orchestration-v2/thread-lineage-and-context-transfer.md).

### `agegr/pi-web`: distinguish prompt revision from copying the current session

At `894e1a28dbeeb7b457c7712e495d975fe9927b89`, user messages have a **“New session”** fork
control alongside **“Edit from here.”** Forking shows **“Creating…”**, awaits a command result
with a new session ID, then changes the selected session. Separately, its sidebar **Fork**
copies the current branch. These controls distinguish revisiting a prompt from continuing a copy.
[Message control](https://github.com/agegr/pi-web/blob/894e1a28dbeeb7b457c7712e495d975fe9927b89/components/MessageView.tsx#L601-L628),
[command handler](https://github.com/agegr/pi-web/blob/894e1a28dbeeb7b457c7712e495d975fe9927b89/hooks/useAgentSession.ts#L1897-L1917),
[selection](https://github.com/agegr/pi-web/blob/894e1a28dbeeb7b457c7712e495d975fe9927b89/components/AppShell.tsx#L1103-L1116).

The sidebar flow prevents concurrent duplicate forks of the same source. It captures the selected
session at click time: if the user navigates away during the request, it leaves them there and
shows an **Open** action for the new fork instead of hijacking navigation.
[Sidebar flow](https://github.com/agegr/pi-web/blob/894e1a28dbeeb7b457c7712e495d975fe9927b89/components/SessionSidebar.tsx#L1877-L1920).

This project creates copies through its own in-process/session-file adapter, not the exact native
session-replacing RPC command Piano uses. Its ability to retain a running parent must not be
assumed for Piano's current process ownership model.
[Backend fork handler](https://github.com/agegr/pi-web/blob/894e1a28dbeeb7b457c7712e495d975fe9927b89/lib/rpc-manager.ts#L1012-L1065).

### `mjakl/pi-web`: one control with role-dependent cut points

At `c4bad130dabb15eac57a6c3bda1edf764aa6c3aa`, history items offer **Branch** (within the same
session) and **Clone** (new session). Its adapter explicitly branches **before** a user message,
returning its text/images as a draft, but **through** other entries. Its fork route waits for
creation before returning the new session page, and navigation focuses the composer.
[Controls](https://github.com/mjakl/pi-web/blob/c4bad130dabb15eac57a6c3bda1edf764aa6c3aa/src/web/views/transcript/shared.tsx#L205-L270),
[cut-point implementation](https://github.com/mjakl/pi-web/blob/c4bad130dabb15eac57a6c3bda1edf764aa6c3aa/src/adapters/pi/session-catalog.ts#L644-L676),
[route](https://github.com/mjakl/pi-web/blob/c4bad130dabb15eac57a6c3bda1edf764aa6c3aa/src/web/routes/transcript.tsx#L222-L236),
[focus](https://github.com/mjakl/pi-web/blob/c4bad130dabb15eac57a6c3bda1edf764aa6c3aa/src/web/client/navigation.ts#L138-L160).

This supports the semantic distinction but not necessarily ambiguous shared labelling: Piano can
be clearer with “Fork session” for the latest answer and “Fork before this message” for a user prompt.

## Implications for Piano

Baseline: [`71912f1e5f3d5dfa0716ba29ae6ad817cf9d5f34`](https://github.com/goofansu/piano/tree/71912f1e5f3d5dfa0716ba29ae6ad817cf9d5f34).

This is not just a button plus an existing action. Piano currently has no conversation fork/clone
variant in [`SessionAction`](../../shared/wire.ts). Its runtime validates the initial session ID
and builds event cursors from the immutable opening spec in
[`PiSessions.ts`](../../server/PiSessions.ts); [`SessionHosts.ts`](../../server/SessionHosts.ts)
keys ownership by canonical folder/session identity. Sending `clone` into that host without a
lifecycle transition would leave the child serving a new Pi session under the old Piano identity.

An implementation must first define an explicit, serialized server-owned transition: reconcile
Pi's returned state, handle extension veto/failure, establish the new host identity/generation,
retain a valid parent reference, register the child reference, and reattach clients consistently.
Do not route replacement-session events under the parent's cursor or start a second writer for
the parent to avoid dealing with the transition. Exact handoff design is a follow-up implementation
decision, not something this research has proven.

Keep Pi authoritative for the history; don't copy rendered message strings into a new prompt or
hand-author a second transcript. Use stable Pi entry IDs for historical cut points, not visual row
indexes, duplicate text matching, or synthetic message IDs. Decide explicitly whether a new
session inherits the source's Piano project grouping; same folder/worktree is the native Pi behavior.

Affected contracts: [INV-01](../development-invariants.md#inv-01--one-authoritative-owner-per-state),
[INV-02](../development-invariants.md#inv-02--server-ownership-survives-browser-lifecycle),
[INV-03](../development-invariants.md#inv-03--agent-state-comes-from-pi-facts),
[INV-05](../development-invariants.md#inv-05--reconnect-creates-a-consistent-view),
[INV-07](../development-invariants.md#inv-07--every-observation-identifies-its-workspace),
and [INV-12](../development-invariants.md#inv-12--pi-compatibility-is-tested-not-inferred).

## Observed Pi behavior

A real installed Pi 1.1.0 RPC child was run with synthetic persisted history `U1/A1/U2/A2`,
an isolated temporary working folder, session directory, HOME and agent directory, and no
extensions, skills, prompt templates, themes or tools. No model prompts/calls were made.
The scratch session data was removed afterward; no user session or registry was touched.

Command: `node /tmp/piano-fork-rpc-check.mjs`; retained output below (also in
`/tmp/piano-fork-rpc-check.log` for this environment):

```text
startup appended metadata: true
get_fork_messages {"messages":[{"entryId":"entry001","text":"U1"},{"entryId":"entry003","text":"U2"}]}
fork(U2) {"response":{"text":"U2","cancelled":false},"newIdentity":true,"messages":["U1","A1"]}
clone {"response":{"cancelled":false},"newIdentity":true,"messages":["U1","A1","U2","A2"]}
source session unchanged since startup readback: true
fork(assistant A2) {"success":false,"error":"Invalid entry ID for forking"}
PASS: Pi 1.1.0 real RPC process; synthetic history; no prompts or model calls.
```

The initial experiment's overly strong comparison against the pre-startup fixture failed because
opening Pi appended a `thinking_level_change` entry. The rerun compared against the post-startup
readback and passed; the result supports preservation of the source conversation, not a general
promise that opening a Pi session never appends metadata.

Scope: native cut points and identity replacement were observed in a running RPC process.
Browser interactions in Piano and reference applications, extension cancellation, images,
compaction, multi-tab races and failure recovery were **not runtime-verified**. Those are
implementation acceptance checks, not claims established by this research. No application code
changed; no build, deployment or application test suite is needed for this documentation-only note.
