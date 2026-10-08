# pi-subagent events and useful Piano interfaces

## Conclusion

**Start with structured delegation/result cards using existing RPC messages. Add a
pi-subagent observation bridge only for live activity and inspection.** Do not parse
terminal widget text or duplicate pi-subagent's lifecycle reducer in Piano.

The main gap is not missing React components: Piano discards existing structured
`details`, while pi-subagent's richer live observations remain inside the Pi process.

## Scope and evidence

Static primary-source research, not runtime verification. No application changes,
application model roundtrips, browser verification, or deployment were performed.

Inspected sources:

- **S:** `/Users/james/code/pi-subagent`, package `1.0.5`, clean revision
  `578b712a552e76fbc33544afdabbc6b3ecc9edfb`.
- **P:** Piano revision `e031429eacb2e7b4df33c5ad927c0aae8a738d4b`.
- **C:** Piano's installed `node_modules/@earendil-works/pi-coding-agent`, version
  `1.0.4`. Core citations below are relative to this package.

`S:path:lines`, `P:path:lines`, and `C:path:lines` identify primary sources at those
versions. These are local source references, not claims of a stable public API.

## 1. What actually reaches Piano

| Surface | Existing transport | Useful data | Limitation |
| --- | --- | --- | --- |
| Parent's `agent_*` tool calls | Ordinary assistant tool calls | Profile, task description, prompt, target IDs | Describes the operation, not its eventual success |
| Tool results | `tool_execution_end.result` / `message_end.message` | Structured `details` for start, resume, wait, result, cancel and steer | Presentation facts, not a complete Run snapshot |
| Completion notification | Custom message, `customType: "subagent-notification"` | Run/subagent identity, label, terminal status, duration; readable output in content | May be suppressed when wait/result already delivered the answer |
| Ambient subagent widget | TUI component factory | Live run rows in terminal | **Not exported in RPC mode** |
| Internal `RunObservation` stream | In-process Effect services | Activity, transcript, tool progress, usage, diagnostics | **No existing external subscription endpoint** |

Evidence: S:`extensions/subagent/host/tools.ts:63-103` registers tool names and
encodes facts into `details`; S:`extensions/subagent/host/notification-message.ts:50-100`
builds the custom message; S:`extensions/subagent/host/session.ts:216-222` sends it
as `{deliverAs: "followUp", triggerTurn: true}`.

Core forwards session events through `toJsonEvent`
(C:`dist/modes/rpc/rpc-mode.js:263-269`). That function returns non-`message_update`
events unchanged (C:`dist/modes/json-event.js:16-29`), so it does not strip
`details` from final tool/custom-message events. This is source-level transport
evidence; no wire capture was made.

The widget distinction is explicit: pi-subagent installs a render callback
(S:`extensions/subagent/host/widget.ts:88-94,209-248`), but core's RPC `setWidget`
only forwards string arrays or removal; it ignores factories
(C:`dist/modes/rpc/rpc-mode.js:123-136`). Core's `custom()` also returns `undefined`
there (`:152-155`). Piano cannot reuse the terminal dashboard simply by rendering
its existing generic extension-state panel.

## 2. Existing structured payloads: the first implementation opportunity

### Tool result `details`

The actual schemas are **tool-row presentation facts**, not raw domain outcomes.
In particular, start/resume/steer do not expose a universal `outcome` discriminator.
Do not assume a payload inferred from the English tool response.

| `details.kind` | Fields relevant to Piano |
| --- | --- |
| `start` | `rowPhrase`, `tone`, `agent`; successful admission also has `subagentId`, `runId` |
| `resume` | `rowPhrase`, `tone`; successful admission also has `subagentId`, `runId` |
| `steer` | `rowPhrase`, `tone`, `runId`; no separate machine-readable acceptance enum |
| `collection` | `scope: named \| all-active`, `runs: [{runId, agent, status}]`, counts `stillRunning`, `unknown`, `unavailable`, `noActiveRuns` |
| `result` | `rowPhrase`, `tone`, `outcome`; `available` carries `run: {runId, agent, status}`; `still-running`/`unknown` carry `runId`; `unavailable` carries `runId`, terminal `status` |
| `cancel` | `outcomes`: `requested`, `already requested`, `unknown` with `runId`, or `already terminal` with `runId`, `phase` |

Sources: S:`extensions/subagent/presentation/tool-row-facts.ts:460-536,654-687,717-720`.
The collection's non-result outcomes are **counts**, not individual run records;
a wait-all timeout cannot identify each still-running Run from those details alone.
The task label comes from the start/resume call's `description`, not their result
facts. Tool arguments and result details must be joined by the **Pi tool-call ID**.

### Completion notification

```ts
{
  role: "custom", // Pi message envelope
  customType: "subagent-notification",
  content: "...bounded, readable result...",
  display: true,
  details: {
    runId, subagentId, agent, label,
    status: "completed" | "failed" | "cancelled",
    durationMillis
  }
}
```

Source: S:`extensions/subagent/host/notification-message.ts:50-100`.
Output belongs to `content`, not `details`. The richer internal notification has
availability, accounting and retention concepts, but those are **not all fields
of this RPC-visible details object**.

A short retained answer is included inline; longer output gets a preview and
retrieval pointer. Inline threshold is 16 KiB; preview bound is 500 bytes
(S:`extensions/subagent/domain/notification.ts:60-68,218-235,319-353`). “Fits inline”
is separate from whether the retained answer was itself truncated.

## 3. Live internal events: useful, but not today's browser protocol

`RunObservation` is a strict `kind`-discriminated union. It is folded within a Run;
most observations have no Run identity themselves. An exported feed must supply
that identity in its envelope.

| `kind` | Payload | Appropriate UI |
| --- | --- | --- |
| `message` | `role`, `parts`, optional model | On-demand bounded transcript |
| `tool_progress` | `callId`, status, optional `outputSummary` | Tool activity in Run details |
| `activity` | string or undefined | One current-activity line; replacement, not log |
| `usage` | additive usage delta | Accounting after authoritative folding |
| `context` | latest context gauge | Optional detail, not another token total |
| `diagnostic` | category, bounded message | Actionable failure or diagnostics disclosure |
| `link` | typed result link | Validated artifact/native-session link |
| `model` | actual model string | On-demand execution metadata |
| `reconciliation` | optional transcript/output/usage/context/turns/model | Correct final view; replaces present fields |
| `ending` | answered, failed, or cancelled | Terminal outcome only after settlement |

Sources: S:`extensions/subagent/domain/observations.ts:40-174`,
`extensions/subagent/domain/reconciliation.ts:1-37`.

Important semantics:

- Message parts are text or `{kind: "tool_call", name, callId?}`. **Arguments are
  deliberately absent.** Tool progress joins by `callId`, including when progress
  precedes the call. Missing call IDs must not be invented or merged by tool name.
  S:`extensions/subagent/domain/transcript.ts:9-61`, `extensions/subagent/domain/reduce-run.ts:126-136,302-331`.
- Usage deltas add; context gauges replace; terminal reconciliation replaces only
  supplied totals. Do not sum cumulative snapshot usage again in Piano.
  S:`extensions/subagent/domain/usage.ts:191-252`.
- Activity is latest-value state. Pi's adapter emits kind changes rather than every
  text delta. This is not a token-by-token child transcript API.
  S:`extensions/subagent/backend/pi/translate.ts:1-26`, `extensions/subagent/domain/reduce-run.ts:333-349`.
- Default projection bounds include 500 transcript items, 200 tools, 50 diagnostics,
  20 links, 16 KiB text parts and 64 KiB final output. Truncation is recorded.
  S:`extensions/subagent/domain/projection.ts:28-113`.
- Diagnostics have fixed categories, including transport loss, cleanup escalation,
  queue overflow and reconciliation differences. Provider failure text is confined
  by adapter redaction; that does not make arbitrary transcript text secret-free.
  S:`extensions/subagent/domain/diagnostics.ts:1-78`, `extensions/subagent/backend/pi/translate.ts:55-67`.

## 4. Lifecycle and delivery rules the interface must preserve

**Two identities:** a Subagent is the stable owner, resumed using `subagentId`;
each execution has a new `runId`, used for wait/result/cancel/steer. IDs are
Session-scoped. Namespace projected records by parent session and host generation;
never treat a Run ID as a Pi tool-call ID.
S:`extensions/subagent/domain/ids.ts:1-86`, `docs/adr/0013-stable-subagent-identity.md:62-74`.

**Two lifecycles:** Subagent `running → idle` can later resume; Run
`running → finalizing → completed | failed | cancelled` settles once. Finalizing
is cleanup, not completion. Cancellation records a request; it is not immediate
terminal cancellation. Steering acceptance means local mailbox admission, not
proof the model read the guidance.
S:`extensions/subagent/domain/phases.ts:29-240`,
`extensions/subagent/presentation/tool-row-facts.ts:93-97`.

**Three delivery paths:** automatic notification, direct result retrieval, and wait.
Wait holds notifications; successful direct delivery consumes them, preventing a
duplicate notification. A UI relying only on `subagent-notification` will leave
some Runs looking active forever. Read collection/result facts too.
S:`extensions/subagent/host/push-sink.ts:36-46,476-533`.

**No durable live registry:** ResultStore is bounded, can evict output while retaining
identity/status, and clears on Session shutdown. Existing Pi transcript records can
still preserve previously delivered messages, but do not resurrect extension memory
or backend Conversations. A process restart is not continuation of a known active Run.
S:`extensions/subagent/runtime/result-store.ts:56-101,149-185,504-525`.

**No guarantee that completed means useful output:** internal availability is
`complete | partial | record-only`; completed with no answer can be record-only.
Neither Run completion nor a reviewer answer establishes Piano verification.
S:`extensions/subagent/domain/notification.ts:89-126`; P:`docs/development-invariants.md`, INV-03/09.

## 5. Where Piano currently loses information

- `server/PiRecords.ts:19-37,60-86` has no `RawMessage.details` handling. Tool results
  become text; custom messages become generic context with `customType` as label.
  The structured run identity/status is lost, although readable prose remains.
- `server/PiRecords.ts:95-104,153-173` retains content from execution results/updates,
  not structured details. `shared/wire.ts:41-83` has no subagent projection.
- `web/src/components/MessageList.tsx:292-326` summarizes command/path/pattern/URL/query,
  not `agent` or `description`. Delegation therefore receives a generic tool label.
  The tool row's success describes the **parent operation**, not the child Run.
- Nested calls use Pi's `parentToolCallId` or persisted nested-call summaries
  (`PiRecords.ts:81,161`; `MessageList.tsx:319-320`). Child backend activity is not
  automatically that event stream; a future bridge must explicitly associate it.
- Generic extension status/widgets appear in the on-demand extension panel
  (`web/src/components/SessionView.tsx:52-54,153-156`); they cannot recover a factory
  widget that core never sends.

## 6. Recommended interfaces and implementation order

These are proposals, not implemented or verified behavior.

### A. Existing-data slice: useful delegation cards

1. In the PiSessions translation seam, validate recognized tool-result and custom
   message details. Export a narrow Piano-owned typed projection, not arbitrary
   extension JSON. Preserve readable fallback for old or malformed payloads.
2. Render a collapsed row such as **“Research event contracts · Started”**, with
   profile, prompt and IDs in its disclosure. Correlate tool arguments → result
   using tool-call ID, and Run → later result using a **separate runId field**.
3. Show **Completed / Failed / Cancelled** only from terminal facts, including
   wait/result returns. Keep **Cancellation requested** and **Steering submitted**
   distinct from their eventual effects.
4. Group resumed Runs under their stable Subagent in details. Keep ordinary tool
   rows and historical messages intact; do not manufacture child tool transcripts.
5. Reconstruct historical cards from authoritative Pi messages. An admission with
   no terminal record means **last observed started**, not proof it is still running
   after a host restart. This slice cannot provide authoritative live enumeration.

### B. Live activity slice: add a supported bridge in pi-subagent

Export a bounded **snapshot plus changes** read model from the extension's existing
Run state, not raw backend SDK events. A proposed envelope needs schema version,
parent host generation, sequence, run/subagent IDs and snapshot/update type. Rows
need label/profile, phase, activity, duration and optionally cumulative usage.
Inspection can fetch bounded transcript/tools/diagnostics/output with retention flags.

The transport is an explicit design task: standard RPC currently provides no
pi-subagent snapshot/subscription command. A bridge must specify subscription,
resynchronization, shutdown and supported capabilities before Piano adds controls.
Do not send high-frequency custom chat messages to simulate an event bus: completion
messages currently trigger parent turns and enter conversation history.

With that bridge, add a compact **active subagents** section, independent of parent
streaming status. Show label plus useful current activity, with an expandable Run
inspector. Keep token accounting and diagnostics in details. Add cancel/steer/resume
controls only with explicit operation acknowledgements; never simulate them by
silently prompting the parent model. Mirror offered controls in the command palette.

Relevant contracts: [INV-01–05, INV-11–12](../development-invariants.md), especially
Pi authority, independent child lifecycle, snapshot ordering, bounded delivery and
safe display. Preserve the process boundary in [ADR 0001](../adr/0001-pi-rpc-workspace-workbench.md).

## 7. Smallest verification before implementation acceptance

For slice A, capture one scratch RPC/browser journey with start → short answer,
then a wait-delivered answer with no duplicate notification. Check description,
correlation and terminal status survive browser reload. Include malformed details,
cancel request versus terminal cancellation, and a host restart with an unfinished
historical Run. Inspect both event and persisted-history payloads.

For slice B, additionally observe parent settlement while a child continues,
reconnect mid-activity, two tabs, terminal cleanup, result eviction and process exit.
Verify Piano's retirement logic does not dispose a parent that owns live subagents.
Keep structured feed snapshots bounded and test resynchronization without rerunning work.

This research only performed source/document review. Runtime compatibility, browser
behavior and recovery remain **unverified**. No new tests are warranted for this
document-only change; implementation will require the repository's normal gates.
