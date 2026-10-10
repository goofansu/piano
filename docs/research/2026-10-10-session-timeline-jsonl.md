# Session timeline from Pi's existing JSONL

## Scope and conclusion

Inspected the nine existing files under `~/.pi/agent/sessions/` read-only and researched the
**installed Pi 1.1.0** documentation and implementation. Piano revision:
`fc59b1bc60e4d2b9fdf91e80e068dd1e967f7350`; inspection date: 2026-10-10 UTC.
No sessions were opened through an agent, no model requests were initiated for verification,
and no session files, settings, registry or running services were changed by the inspection.
The current conversation continued appending normally, so counts below are snapshots, not a
transactionally consistent snapshot of the entire directory. Only structural aggregates are retained;
no prompts, results, credentials, private session identifiers or raw payloads are copied here.

**Recommendation: implement a persisted session-history timeline first, with no new database.**
Pi already stores model selection, thinking-level selection, prompt/tool changes, context edits,
and completed message diagnostics. This supersedes the preliminary suggestion to introduce a
separate diagnostic journal immediately. Full runtime tracing is a distinct, optional later scope:
session JSONL is not a recording of the JSON/RPC stdout event stream. [1][2][3]

This preserves INV-01 (Pi owns history), INV-03 (state follows observed facts), INV-05 (ordered,
bounded delivery), INV-11 (sensitive payload handling), and INV-12 (version-specific compatibility).
See [development invariants](../development-invariants.md).

## Observed existing files

All nine files had version-3 headers. The initial structural scan parsed 1,569 records across
approximately 11 MB, with the largest file approximately 3.59 MB. No malformed lines were observed
in that pass. This is a small sample, not evidence that malformed/truncated files never occur.

| Persisted entry | Count | What the timeline can show |
| --- | ---: | --- |
| `session` | 9 | Session creation metadata, not process launch/resume history |
| `model_change` | 12 | Initial selection plus three actual model transitions across two sessions |
| `thinking_level_change` | 10 | Initial setting and subsequent setting changes |
| `message` | 1,521 | 33 system, 120 user, 675 assistant and 693 tool-result messages |
| `custom_message` | 5 | Extension messages; all five had type `subagent-notification` |
| `session_info` | 6 | Recorded session names, including initial assignments—not necessarily six renames |
| `context_edit` | 6 | Changes to what future model requests see |

The first scan's assistant stop reasons were 573 `toolUse`, 93 `stop`, seven `error`, and two
`aborted`. These are message outcomes, not proof of agent settlement. All six observed context edits
omit assistant messages whose stop reason is `error`. That is particularly useful for diagnostics:
**the raw history retains failed attempts which the repaired model context excludes.** Pi documents
this distinction and uses context edits during recovery. [1][4]

A follow-up structural scan, after this live conversation had appended more records, found:

- All 680 assistant messages and 698 tool results then present had `durationMs`.
- All 680 assistant messages had `thinkingLevel`; 669 had `rawStopReason`.
- Nine assistant messages had `errorMessage`; 32 tool results had `isError: true`.
- 23 tool results had `nestedCalls`, containing 85 successful and three failed nested calls.
  All 23 containers reported `complete: true`; other sessions may have incomplete records.
- System messages included named prompt sections and tool additions/removals.
- No assistant `diagnostics`, `responseModel`, or `providerThinkingLevel` fields were observed,
  although the installed message types support them. [5][6]

The scan collected only keys, counts and selected structural relationships, not conversation bodies.

## What is available without additional persistence

### Selection and request details

Show initial model/thinking settings distinctly from later changes. Determine the previous value
through the entry's parent chain, not simply the preceding file line: sessions are trees.

Keep **selected model** separate from **model that answered**. Selection lives in `model_change`;
assistant messages identify physical dispatch with `provider`, `model`, `api`, and optional
`thinkingLevel`. A virtual model can route several responses to different physical models without
any user model switch. `responseModel`, when present, adds the concrete provider response model. [1][5][7]

### Conversation, tools and failures

Completed messages retain content, tool calls, correlated results, errors, stop reasons, and usage.
Where present, show recorded assistant/tool durations and nested tool-call metadata. Nested-call
results are not recorded in `nestedCalls`; arguments can be omitted and `complete` can be false.
Do not invent missing starts or calculate precise tool durations from gaps between unrelated entries.
Assistant timestamps represent request start; entry timestamps represent append time; tool-result
timestamps represent result creation. Label those meanings rather than treating them as one clock. [5][6][8]

Recorded usage includes input/output, cache usage and cost. Reasoning tokens, if present, are already
included in output and must not be added again. Full-session accounting can also include separate
usage entries, tool usage and summarization usage. [1][5]

### Context and configuration history

System messages declare the initial prompt sections/tools and later patches. A compact timeline row
can describe changed section names and tool additions/removals, with sensitive content behind a
redacted, on-demand detail view. This can explain what instructions and tools Pi recorded for requests;
it is not a capture of every provider's transformed HTTP request. [1][5]

Show `context_edit` as omission/replacement of a referenced entry while retaining the original raw
history. Do not replace the normal model-context projection with raw history or send that history
back to Pi as new context. [1][4]

### Documented, but absent from this sample

Support these when encountered; their absence in nine files is not a compatibility limitation:

- `compaction`: successful summary, retained boundary, tokens before, and optional checkpoint,
  usage and details. It is not a history of failed/cancelled compaction attempts. [1][4]
- `branch_summary`, `label`, and header `parentSession`: summaries, bookmarks and fork/clone
  relationships. Not every navigation operation creates an entry. [1][8]
- `usage`: non-message usage, such as cache warming; tolerate unknown `kind` values. [1]
- `custom`: extension state, including optional virtual-model routing state. It is not model context. [1][7]
- Direct-shell `bashExecution` messages: command outcome, truncation and context-exclusion flags. [5]

Custom payloads are extension-defined. Do not promise built-in UI semantics or expose everything
blindly; unknown types need a safe bounded fallback.

## What session JSONL cannot fully reconstruct

The documented live event stream includes events without corresponding standard persisted entries:
`agent_start`, `agent_end`, `agent_settled`, `turn_start`, `turn_end`, streaming message/tool updates,
queue changes, retry attempts/delays, and failed/cancelled compaction outcomes. Prompt command
acceptance/rejection and extension UI interactions also belong to RPC, not the standard session
entry schema. Process launch/exit and browser connection history are separate host observations. [1][2][3]

A stored error followed by a successful response does not prove why or how many times Pi retried.
A final assistant answer does not prove `agent_settled`. A tool call lacking a stored result does not
prove the tool never ran. A header creation timestamp does not identify every resume.

Pi persists finalized message events, rather than each streaming delta; pending assistant messages
are explicitly excluded by the documented format. An interrupted stream may therefore have no
completed assistant record. Do not promise recovery of unpersisted partial output. [5][9]

## Integration and performance

Piano's current [`server/SessionFiles.ts`](../../server/SessionFiles.ts) uses
`buildSessionContext()` for its display snapshot and extracts only the latest selected model from
the active branch. That is a context projection, not the complete entry history. The new display
needs a separate raw-entry projection behind `PiSessions`, translated into Piano's wire vocabulary.
Do not leak the Pi protocol into browser components.

For an already-running child, Pi 1.1.0 provides:

```json
{"type":"get_entries","since":"last-seen-entry-id"}
```

It returns entries strictly after that ID in append order, plus the current `leafId`; omitting `since`
returns all entries, including pre-compaction history and abandoned branches. An unknown cursor
returns an error. IDs are session-scoped. `get_tree` is also available. This is documented and
confirmed in the installed RPC implementation, but was **not exercised against the user's child**. [3][10]

Use append order for the audit timeline and parent links/`leafId` for branch context. Live navigation
can change the leaf without appending anything; a file-only view cannot always identify the live
child's current leaf. The RPC result carries that distinction. [8][10]

There is no documented page-size limit for `get_entries`; `since` reduces repeat payloads, not the
initial load. The implementation still builds the full entry array and searches for the cursor, so
incremental responses are not constant-time queries. Avoid calling it on every token. [10]

A reasonable initial implementation would:

1. Load only the selected session's history when the timeline is requested.
2. Keep a bounded, disposable server-side projection and send compact rows to the browser; load
   large payload details separately rather than repeatedly sending images and full tool outputs.
3. Refresh incrementally/coalesce at meaningful boundaries, after persistence is visible, rather
   than reparsing every file on each streaming update. The installed agent emits `message_end`
   before its append code, so event delivery alone is not an atomic persisted-entry boundary. [9]
4. Resynchronize on session replacement, missing cursor or file rewrite/truncation; deduplicate
   persisted entries by session and entry ID. Do not fabricate exact ordering between separate
   live-only events and history entries.
5. Retain no new durable store for this first scope. Pi continues to perform its existing writes;
   Piano adds read/parse/serialization/rendering work only.

One Python read/parse/aggregate scan of the approximately 11 MB sample took **72.1 ms** on this VM.
That is a single local observation with unspecified filesystem cache state, not a Node/server latency,
memory, cold-disk, large-session or concurrent-load benchmark. The sample supports feasibility, not
a claim of negligible overhead. Large payload parsing and rendering are likely more important than
the tiny model/thinking metadata records; measure the chosen implementation separately.

### Important read-only caveat

Do **not** assume `SessionManager.open()` is a strictly read-only file API. In installed 1.1.0,
`loadEntriesFromFile()` can append a missing terminal newline, opening an empty file can initialize
it, and old-format entries can trigger a rewrite during migration. [8]

The current Piano peek path uses that API despite its read-only intent. This is a discovered risk,
not a demonstrated corruption incident and not fixed by this research. A new history reader should
use truly read-only I/O for files, defer incomplete trailing records, and leave repairs/migrations
to Pi. Never use an additional writer to inspect a live session. The inspection above used direct
read-only parsing, not `SessionManager.open()`.

## Proposed first scope

Call the option **Session timeline**, with scope described as recorded Pi history, not “all events.”
Include model/thinking changes, system/tool changes, context edits, summaries, metadata and completed
message diagnostics alongside the conversation. Keep initial values and branch membership clear.

Only add a separately bounded runtime journal later if debugging requires retry scheduling,
process/reconnect history or other missing runtime facts after restart. Do not duplicate persisted
messages simply to fill those gaps.

## Sources and verification limits

Primary sources below are the installed package files, matching Pi 1.1.0 used by this checkout.
Local relative links require `npm install`; no claim is based on the moving upstream `main` branch.

1. [Session file format](../../node_modules/@earendil-works/pi-coding-agent/docs/session-format.md)
2. [JSON event stream](../../node_modules/@earendil-works/pi-coding-agent/docs/json.md)
3. [RPC commands](../../node_modules/@earendil-works/pi-coding-agent/docs/rpc-commands.md) and
   [RPC mode](../../node_modules/@earendil-works/pi-coding-agent/docs/rpc.md)
4. [Compaction reference](../../node_modules/@earendil-works/pi-coding-agent/docs/compaction.md)
5. [Message types](../../node_modules/@earendil-works/pi-coding-agent/docs/message-types.md)
6. [Installed message declarations](../../node_modules/@earendil-works/pi-ai/dist/types.d.ts),
   `AssistantMessage`, `ToolResultMessage`, `NestedToolCalls`
7. [Virtual models](../../node_modules/@earendil-works/pi-coding-agent/docs/virtual-models.md)
8. [Installed session manager](../../node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js),
   `loadEntriesFromFile`, `_setSessionFile`, `_loadEntries`, `_persist`, `getBranch`, `getEntries`, `branch`
9. [Installed agent session](../../node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js),
   message-event dispatch and `message_end` persistence
10. [Installed RPC handler](../../node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js),
    `get_entries` and `get_tree`

Also read the [SDK guide](../../node_modules/@earendil-works/pi-coding-agent/docs/sdk.md),
[session example](../../node_modules/@earendil-works/pi-coding-agent/examples/sdk/11-sessions.ts),
[sessions guide](../../node_modules/@earendil-works/pi-coding-agent/docs/sessions.md), and
[how Pi works](../../node_modules/@earendil-works/pi-coding-agent/docs/how-pi-works.md).

Documentation-only research: document/source-link review and local structural inspection suffice.
No application behavior was changed, so no browser journey, unit suite, typecheck or deployment
was performed. All 17 local documentation/source links resolved and the staged whitespace check
passed. The commit hook ran lint successfully, with an existing optional-chaining warning in
`web/src/components/SessionPullRequest.tsx`. The new timeline, refresh strategy and large-session
performance remain unimplemented and unverified.
