# Practical usage dashboard — 2026-10-12

## Answer

**Yes: Pi already persists enough data for a useful historical model/token/cache/estimated-cost dashboard. Piano does not yet expose a period-based aggregation API.** Its cached session totals and visible transcript are not sufficient inputs. Read Pi history without starting agents, project usage events, and aggregate those events.

This is an implementation recommendation, not a shipped feature or a billing audit. Primary sources are the installed Pi 1.1.0 code/docs and Piano at `5232a3c`. No external pricing lookup is needed: preserve the historical recorded costs rather than repricing old usage with today's catalog.

## Data in hand

Read-only audit of the default `~/.pi/agent/sessions` store on October 12:

| Observation | Result |
| --- | ---: |
| JSONL files | 19 |
| Combined file size | 14,591,518 bytes |
| Assistant records carrying usage | 933 |
| Records with provider + model | 933 / 933 |
| Records with entry and message timestamps | 933 / 933 |
| Records with input, output, cacheRead, cacheWrite, totalTokens | 933 / 933 |
| Records with numeric cost.total | 933 / 933 |
| Distinct provider/model pairs | 3 |
| Zero-cost records | 10; none had positive totalTokens |
| Unparseable lines | 0 |
| Parent-session headers / repeated assistant identity candidates | 0 / 0 |
| Earliest/latest usage entry timestamps | October 9 04:08 UTC – October 12 11:29 UTC |

The scan counted metadata only; no prompts, replies, credentials or paths are reproduced here. Counts are a live-store snapshot and can increase. It found only assistant usage records, so compaction/tool/standalone usage support below is supported by source inspection, not observed examples. Repetition candidates used entry ID, timestamp, provider and model; this was not a production deduplication implementation.

**Longer presets can be offered immediately, but this inspected store does not contain a month of history.** Do not describe days without retained records as verified zero activity. Global settings and this process had no session-directory override; this does not prove every registered folder or the service uses the same configuration. Resolve actual folder-specific stores through PiEnv before claiming complete Piano coverage. The audit did not query or modify the real registry, start Pi children, or inspect other machines. [S1–S4]

## What is stored versus what Piano exposes

| Need | Pi history | Piano today |
| --- | --- | --- |
| Model attribution | Assistant provider/model; optional responseModel | Per-response physical model, not a complete analytics event |
| Time bucketing | Entry ISO timestamp; assistant request-start milliseconds | Session-level stats have an observation time, not a usage time series |
| Input/output tokens | Per response | Response usage and cumulative session totals |
| Cache read/write tokens | Separate categories | Already displayed in ContextDetails |
| Costs | Input/output/cache cost components and total | Response usage flattens cost to total |
| Other model operations | Standalone usage, compaction/branch summaries, tool-result usage | Not a complete historical analytics projection |
| Subagents | Extension-delivered Run usage where present | RunLedger deduplicates deliveries, groups by profile |

Pi's Usage also optionally carries reasoning tokens (already part of output) and one-hour cache-write tokens (already part of cacheWrite). Do not add those subsets again. Costs are calculated using model rates, with tier and cache-retention handling; call the dashboard metric **Estimated cost (USD)**, not “bill” or “amount charged.” Subscriptions, discounts, missing provider telemetry and external paid tools are not established by these records. A stored zero cannot universally prove a free request. Missing usage/cost must remain unknown, not be silently converted to zero by reusing display normalization. [S2, S3, S5, S6]

## Accounting rules that matter

1. **Read all entries, not active context.** Pi's own `getSessionStats()` includes all stored entries, including other branches and compacted-away messages. Its accounting covers assistant usage, tool-result usage, standalone `usage` entries, and optional compaction/branch-summary usage. Context edits do not erase historical spend. `PiHistory.peek()` intentionally builds visible context, so it is not the dashboard input. [S1, S4, S7]
2. **Choose one timestamp convention.** Recommend persisted entry time (recorded/completed usage) for v1 across all entry kinds. Retain assistant request-start time for possible detail views. A request crossing midnight belongs to the date it was recorded; this is not necessarily the provider's billing date. Never bucket an entire session by creation or last activity.
3. **Use actual response models.** Group assistants by provider + model, not the session's current selection, which may be virtual or may have changed. Keep responseModel as optional detail. Standalone usage has provider/model; summaries and tool usage may not. Put unattributable spend in **Other / unknown model**, rather than guessing from the latest selection. [S1, S2]
4. **Do not multiply streaming observations.** Count persisted usage events once. If later adding live previews, replace the same response's cumulative usage and reconcile with persistence; never sum cumulative updates. [S5]
5. **Forks can copy spend.** Pi's `forkFrom()` copies all non-header entries and records parentSession. Summing per-file or per-session totals can double-count inherited usage. Resolve physical file aliases, then deduplicate inherited entries within proven ancestry using entry identity plus a stable accounting fingerprint. Eight-character entry IDs alone are not globally unique. Unrelated equal-looking requests must not be merged. Preserve source-session provenance; count inherited events once in the global total, not as new work by the child. Missing ancestors or ambiguous copies need an explicit coverage/conflict result, not a confident guess. Project/folder attribution of inherited work must use the origin where known. [S8]
6. **Subagents need a separate policy.** RunLedger uses the last usage-bearing delivery per Run ID because notification/wait/result can repeat the same Run. Its aggregate loses time granularity. A delivery timestamp is only a reporting-time proxy, not the time each child request occurred. For v1, keep separately labeled **Reported subagent usage**, deduplicated before period filtering; do not automatically add it to independently scanned child-session usage. Exact per-period/model accounting needs child events plus parent/Run linkage. Mixed-model runs cannot safely be assigned wholly to one model. [S9]
7. **Do not silently drop failed/aborted work with reported usage.** Pi stats do not exclude assistant usage by stop reason. Conversely, requests never persisted or never reporting usage cannot be recovered from these logs. [S7]
8. **Deletion limits reconstruction.** Deleted history, disabled persistence, remote-machine work and out-of-scope folders are not recoverable from these records. Retaining a durable billing ledger beyond Pi history is a different product decision, not an accidental cache feature.

## Practical UI

A dedicated **Usage** view, reachable from navigation and the Global commands group in Mod+K:

- Period selector: **1 month · 2 weeks · 7 days · 3 days · Today**; default 7 days.
- Four summary values: estimated cost, total tokens, input tokens, output tokens. Explain once that total tokens include cache read/write.
- One daily chart, switchable between cost and tokens; hourly buckets for Today.
- One sortable model table: **Model/provider | Input | Output | Cache read | Cache write | Total tokens | Estimated cost**.
- Optional filter for folder/project, not a wall of per-session cards. A model row may later drill into sessions.
- A compact details area for scope, timezone, covered history, unknown records and reported subagent usage. Show an actionable incomplete-read warning when necessary, not permanent diagnostic badges.

Prefer **Cache read / Cache write** over “cache in/out”: these mean reused prompt tokens and tokens written into the prompt cache, not ordinary input and generated output. If showing cache hit rate, use the token-weighted ratio:

`sum(cacheRead) / sum(input + cacheRead + cacheWrite)`

Show unavailable when the denominator is zero; do not average per-response percentages. “Cache savings” is not a v1 metric: it requires a defensible counterfactual price model. Existing ContextDetails uses this cache-hit denominator. [S6]

### Define periods before implementation

Recommendation: calendar-aware, including the current partial day, in an explicit IANA timezone supplied by the browser:

- Today: local midnight → now.
- 3/7 days: midnight 2/6 calendar days ago → now.
- 2 weeks: midnight 13 calendar days ago → now.
- 1 month: midnight on the date one calendar month ago → now, clamped at month end.

Expose the exact date range so “1 month” is not mistaken for month-to-date or exactly 30 days. If fixed-length comparability is preferred, rename it **30 days** instead. Use one captured `asOf` and half-open UTC intervals `[start, asOf)` derived from timezone boundaries; daylight-saving days are not always 24 hours. An event belongs to one bucket, and table/chart/summary must use identical filters.

## Implementation shape

Preserve INV-01, INV-07, INV-11 and INV-12. This is a read-only projection of Pi history, not a competing transcript or a reason to start one Pi process per session.

1. **Server-side usage reader:** extend the history boundary or add a focused `PiUsage` module beside it. Resolve registered-session scope through registry identities and PiEnv's directory rules. Keep Pi parsing/provider specifics behind the server boundary. Default to **Piano sessions**, explicitly defined as retained registered references; optional all-local-Pi scope must be deliberate, not silently scan/import unrelated terminal sessions. Folder/project filters describe current registry membership unless historical membership is separately recorded.
2. **Normalized projection:** source identity, entry identity, provenance/Run identity where available, recordedAt, provider/model or unknown, usage kind, the four token counts, original totalTokens, recorded cost components, and completeness flags. Derive displayed token totals consistently with Pi's sum of the four categories; retain any totalTokens discrepancy for inspection. Do not persist message bodies.
3. **Query API:** accept period + timezone and optional folder/project IDs; return exact range/asOf, totals, buckets, model rows and bounded coverage metadata. Paths stay out of URLs and browser output. No provider API credentials required.
4. **Small first, measure:** the inspected store is about 14 MB. Start with bounded asynchronous reads and a shared in-memory per-file cache keyed by physical identity/change metadata. Do not rescan on every UI render or block the server on synchronous whole-store parsing. Handle an incomplete trailing line during live writes, distinguish genuine parse/read failures, invalidate on replacement/truncation/deletion, and never silently report failed reads as empty usage. Add an incremental disposable index only if measured latency needs it; keep it rebuildable from Pi and outside registry config JSON.
5. **Refresh:** on opening Usage and after relevant persisted session activity; no live per-token cost ticker needed. Refetch after reconnect, without launching agents.

### Smallest useful checks for implementation

A fixture-driven module contract should prove period/timezone boundaries (including DST and month-end), changed models, cache arithmetic, unknown versus zero, compaction/other branches and every Pi-accounted entry kind, fork deduplication without merging unrelated requests, repeated Run deliveries, partial writes, missing files and cache invalidation. Independently reconcile a single non-forked fixture with Pi stats. Browser-check period switching, model sorting, totals matching chart/table, reload and narrow-screen behavior on the scratch instance. Run the required test/typecheck/lint gates when implementing; none are necessary for this research-only note.

## Sources and research limits

Primary sources inspected locally; package paths below refer to the installed Pi 1.1.0, not whatever upstream main contains later:

- **S1:** `node_modules/@earendil-works/pi-coding-agent/docs/session-format.md` — entry kinds, timestamps, physical models, context projection and parentSession.
- **S2:** `node_modules/@earendil-works/pi-ai/dist/types.d.ts`, `Usage` and `AssistantMessage` — accounting fields, subset semantics, request-start timestamp.
- **S3:** `node_modules/@earendil-works/pi-ai/dist/models.js`, `calculateCost` — rate-based USD estimates, tiers and cache writes.
- **S4:** [PiHistory](../../server/PiHistory.ts), [PiEnv](../../server/PiEnv.ts) — discovery, aliases and context-only snapshots.
- **S5:** [wire schemas](../../shared/wire.ts), [PiRecords](../../server/PiRecords.ts) — cumulative response usage, normalization and exposed fields.
- **S6:** [ContextDetails](../../web/src/components/ContextDetails.tsx), [contextUsage](../../web/src/lib/contextUsage.ts) — existing usage display and cache-hit calculation.
- **S7:** `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`, `getSessionStats` — authoritative session-total inclusion rules.
- **S8:** `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js`, `forkFrom` — copied entries and parent provenance.
- **S9:** [RunLedger](../../server/RunLedger.ts) — repeated deliveries, latest usage and profile totals.
- Architecture: [ADR 0001](../adr/0001-pi-rpc-workspace-workbench.md), [invariants](../development-invariants.md), [roadmap](../roadmap.md).

No background research-agent tool was available; research was performed directly using independent parallel file reads. No provider billing API, external web research, paid model probe, application run or deployment was needed. The audit establishes available fields in the inspected store, not comprehensive usage across all machines or all historical providers. Research verification consists of source inspection, metadata audit and document/link review.
