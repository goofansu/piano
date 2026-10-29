# Settings → Usage: composing sessions, models, tokens and cost

## Recommendation

Build an explanation of usage, not four independent counters. Use **date → model → session** as the main investigation path, with tokens and estimated cost carried through every level. A user should be able to answer:

1. How much did I use in this date group?
2. Was spending spread across more sessions, concentrated in heavier sessions, or associated with a different model/token mix?
3. Which models and sessions account for it?
4. Can I open the session to understand the work behind that usage?

These are product recommendations, not validated usability findings. Research inspected Piano at `c139992` on 2026-10-28 and first-party Langfuse documentation. No implementation, real-session audit, paid model call or deployment was performed.

This note refines the [earlier usage research](2026-10-12-usage-dashboard.md): use the user's requested **Settings → Usage** location, existing Sessions date groups rather than new period presets, and sessions/models as first-class breakdowns. Its historical data audit is not a current coverage measurement.

## Why compose the dimensions?

Langfuse's first-party guidance connects session identifiers to whole-conversation cost and model attribution to explaining spend changes, rather than merely displaying a total. Its chart/table facilities also preserve a filtered query while changing the metric, and its compact timeline supports drilling into spikes. These support the interaction pattern, not a claim that Piano needs a general-purpose analytics builder. [E1–E4]

| Composition | Question answered | Useful presentation / action |
| --- | --- | --- |
| Date × sessions × tokens × cost | Where did usage accumulate? | Date-group rows with all three measures; select a group. |
| Sessions × tokens | Was usage distributed across many sessions or a few heavy ones? | Tokens/session plus session rows sorted by tokens. |
| Sessions × cost | What did a session cost in this period? | Cost/session plus session rows sorted by cost; open a session. |
| Models × tokens × cost | Which models account for volume versus spend? | Model rows with tokens, token share, estimated cost and cost share. |
| Models × sessions | How widely was each model used? | Distinct sessions using each model; selecting a model narrows the session list. |
| Session × models | Did the session switch models, and where did its cost go? | Model contributions within the selected session and date group. |
| Model × token category × cost | Is the spend associated with output, uncached input, or cache behavior? | On-demand input/output/cache-read/cache-write token and cost breakdown. |

### An explanatory identity, not a productivity score

For a common, fully measured population with nonzero denominators:

`Cost = Sessions × (Tokens / Sessions) × (Cost / Tokens)`

This separates three factors: **number of sessions**, **token volume per session**, and **blended cost per token**. Display the last as USD per million tokens if needed. A change in blended cost may reflect model mix, output share, cache mix, or pricing tiers; it does not establish why any one request was expensive.

Models explain the blended factor:

`Cost / Tokens = Σ_model [(model tokens / all tokens) × (model cost / model tokens)]`

Use ratio-of-sums, not the mean of session/model rates. These identities are descriptive, not causal attribution. Suppress ratios with zero denominators or incompatible/missing coverage; positive-cost, zero-token operations need a separate cost component rather than a fabricated token rate.

**Illustrative example, not measured usage:** 10 sessions process 2M tokens for $8: 200k tokens/session and $0.80/session. Model A accounts for 1.6M tokens and $2 (80% of tokens, 25% of cost); Model B accounts for 0.4M and $6 (20%, 75%). Selecting B shows the sessions behind that $6. This is a useful investigation, not evidence that B was wasteful or A produced better work.

Do not equate sessions with completed tasks, output tokens with useful output, or lower cost with better results. Piano's glossary explicitly separates session lifecycle from task acceptance. [L4]

## Date semantics: same boundaries, different fact being dated

The existing Sessions date grouping is defined in `sidebarView.ts`, using local calendar midnights and first-match boundaries. These are **disjoint groups**, not overlapping rolling-range presets. [L1]

Let `D` be today's local midnight and `asOf` the captured current instant:

| Existing label | Usage interval |
| --- | --- |
| Today | `[D, asOf)` |
| Yesterday | `[D − 1 calendar day, D)` |
| Previous 7 days | `[D − 7 calendar days, D − 1 calendar day)` |
| Previous 30 days | `[D − 30 calendar days, D − 7 calendar days)` |
| Older | Before `D − 30 calendar days`, limited to retained history |
| Unknown date | Usage with no valid attributable date; separate from dated totals |

Keep these labels and boundaries. Put exact dates and timezone on demand; do not silently interpret Previous 7 days as today plus the last six days. Preserve DST-aware calendar arithmetic and one timezone/asOf across the whole board. Future-dated records should be treated as a data anomaly, not counted beyond asOf.

**Critical distinction:** Sessions puts each session in one group by its latest `updatedAt`. Usage must place each usage event by its persisted timestamp. A session used yesterday and today contributes to both usage groups; only today's recorded usage goes into Today. Reopening or renaming it must not relocate historical spend. Sidebar counts and usage counts therefore need not agree. [L1, L2]

Adjacent groups have unequal lengths: do not add percentage-change arrows comparing Today against Previous 7 days or Previous 7 days against Previous 30 days. A chronological daily trend inside a selected group can be added later, but a line connecting these group totals would be misleading. Equal-duration, equal-coverage comparisons require a separate deliberate interaction.

## Proposed first version

Use the existing Settings page/header and hairline-divided group/list structure, not a wall of KPI cards. [L5]

1. **Date overview** — rows in the same order as Sessions:
   `Date | Sessions used | Tokens | Estimated cost`.
   Default selection: Today. Selecting another row updates all details below. Keep known empty groups selectable; distinguish no recorded usage from unreadable history. No arbitrary range builder in v1.
2. **Selected date group** — compact secondary values **Tokens/session** and **Cost/session**. The selected overview row already carries the totals; do not repeat them as cards. Defer medians, percentiles and blended USD/1M tokens to Details rather than adding more default counters.
3. **Models** — `Model | Sessions used | Tokens | Estimated cost`, ordered by cost descending. Put each model's token/cost share beside its respective value; do not make a separate pie chart. Preserve unknown-model contributions. A model row selects that model; an **All models** control clears the selection. The model list remains the group-wide comparison; the session list below reflects the selected model.
4. **Sessions** — selected date group, optionally narrowed to one model. Show title, tokens and estimated cost, sortable by cost or tokens. If model-filtered, values are **that model's contribution**, not the session's full-period total. A row's breakdown shows model/token-category contributions; **Open session** navigates to its history. A bounded initial list must offer access to the remaining sessions rather than silently presenting top-N as the whole population.
5. **Details** — exact interval, timezone, scope, coverage, estimation semantics and token-category breakdowns. Missing data must also qualify the affected value as partial/unavailable; hiding the fact of incompleteness exclusively in Details would be misleading. Read failures get an actionable Retry.

On narrow screens keep session/model name, tokens and cost visible; move secondary shares/counts into the row's details. Use normal selection/sort feedback, and a loading indicator on a read control; no success toast for merely changing a filter. Include Usage in Settings navigation and the command palette. These are proposed controls, not screenshot-verified UI.

Defer a scatter plot, Sankey diagram, multi-axis chart, generic pivot builder, budgets, alerts and forecasts. They add interpretation/control cost before improving the core date → model → session answer. A session-cost ranking already exposes concentration; token/cost shares expose model mix without a second chart.

## Data gaps: persisted history versus today's UI contract

Follow-up source inspection confirms that **usage timestamps are missing from Piano's normalized browser usage, not generally from Pi's persisted history**. `Usage` is a numeric value object; time belongs to its enclosing event. [L3, L8–L10]

| Needed fact | Persisted Pi source | Gap for the board |
| --- | --- | --- |
| Recorded usage time | Every `SessionEntryBase` has an ISO `timestamp`; message, standalone usage and summary entries inherit it. | `RenderMsg` and `Usage` expose no timestamp. Preserve the enclosing entry timestamp in a dedicated usage projection. |
| Request start / duration | `AssistantMessage.timestamp` is request-start milliseconds; `durationMs` is optional. | Not preserved in the transcript wire representation. Request start is not the same as recorded time; duration is not required for the proposed board. |
| Stable accounting identity | Session/header ID plus persisted entry ID and parent provenance. | Display message IDs can be positional (`m0`, etc.); they are not sufficient accounting/deduplication identities. |
| Model attribution | Assistant messages and standalone usage entries carry provider/model. | Summary entries' typed usage has no provider/model fields; attribution is not universally recoverable. Keep unknown-model contributions. |
| Cost components | Pi `Usage.cost` retains input/output/cache components. | Piano's response projection exposes only the total. |
| Missing-data provenance | Some entry kinds have optional usage; some records may be absent entirely. | Transcript normalization can erase missing-versus-zero distinctions. Source telemetry/retention may genuinely be incomplete. |

`SessionStats.statsUpdatedAt` records when totals were observed, and session `updatedAt` records activity; **neither dates the requests contributing to those totals**. Timestamping a cumulative total now cannot reconstruct historical daily spending. [L1, L3]

Consequently, adding a timestamp to the existing totals is insufficient. Read retained entries and project at least `{ sourceSessionId, entryId, recordedAt, kind, provider/model or unknown, token categories, cost components, completeness/provenance }`. The board can receive aggregates rather than every raw event. Existing `PiHistory.savedEntries` already reads all saved entries without starting an agent, but the current snapshot is a context-oriented display projection, not a dated usage API. [L10]

The persisted entry timestamp is a practical **recorded-time convention**, not proof of the provider's billing timestamp or each nested operation's execution time. Exact provider charges, subscription allocation, unreported operations, deleted history and precise timing/model splits inside aggregate subagent reports remain unavailable without additional evidence.

## Metric contracts

- **Scope:** recommend retained Piano sessions on this installation, including retained archived sessions, not only the sidebar's current visible list. Confirm project/folder filtering separately; it was not requested as part of this research. Do not imply account-wide billing, all machines, or deleted-history coverage.
- **Sessions used:** distinct source sessions with at least one recorded model operation in the selected interval, including an operation whose telemetry is missing. Opening, renaming or creating an empty session alone does not count. This needs operation evidence, not `updatedAt`, and is not the count of currently running sessions. If implementation can only identify usage-bearing operations, label the narrower count **Sessions with usage** instead.
- **Model identity:** provider plus the model that produced the response, not the session's current model selection. Preserve recorded model versions; do not merge aliases or guess unknown models. Mixed-model sessions contribute to several model rows. [L2, L3]
- **Non-additive counts:** cost and token amounts reconcile across disjoint groups/models; session counts do not. A multi-day or multi-model session counts once in each applicable row and once in the overall distinct count. Never sum model session counts to obtain total sessions.
- **Tokens:** sum Pi's input + output + cacheRead + cacheWrite over selected events. These are processed tokens across calls, including repeated context/cache reads, not unique text or current context size. Reasoning is already part of output; one-hour cache writes are already part of cacheWrite. [L2, L6]
- **Estimated cost (USD):** sum recorded historical costs. Pi calculates costs from model rates and applicable tiers/cache categories; do not reprice history using the current catalog or call the result an invoice. A subscription or zero price does not establish zero resource use or a free request. [L6, L7]
- **Cost/session and tokens/session:** period contribution divided by distinct sessions in the same population. In model details, divide only that model's contribution by sessions using that model. These are not completed-session lifetime averages. When missing values affect coverage, do not show an unqualified average; defer the ratio or explicitly show a measured subset and its denominator.
- **Shares:** each model's contribution divided by the selected date group's total, including unknown-model contributions. Calculate cost share and token share separately; unavailable for a zero denominator. Partial coverage must be apparent.
- **Cache hit:** `Σ cacheRead / Σ(input + cacheRead + cacheWrite)`, not an average of percentages. A model with many cached reads can have a high token share and low cost share. Call this reuse, not proven savings; savings require a counterfactual. [L3]
- **Unknown versus zero:** existing transcript normalization substitutes zero for absent fields and flattens cost components. Do not reuse that display representation as an accounting source. Unknown usage or pricing remains unknown. [L8]

The existing research identifies additional accounting risks: compacted and off-branch history, copied fork history, repeated subagent reports, failed/aborted requests with usage, and deleted records. Carry those rules forward; this board must not add parent reports to already-counted child work. Model/session/date attribution should use the same deduplicated event set. Ambiguous subagent totals should remain separately labeled rather than distort model shares. This note did not re-audit fork/subagent handling. [L2, R1]

## Smallest useful future checks

Before implementing, agree on the counting and attribution contract above. Meaningful fixtures should demonstrate:

- One session used yesterday and today contributes only each interval's usage; changing `updatedAt` leaves historical usage unchanged.
- One session using two models produces two model-row memberships, one total session, and reconciling model token/cost sums.
- Date labels match Sessions boundaries, including DST and the six-day/23-day residual groups.
- Model selection shows only that model's session contributions; clearing it restores the unfiltered list.
- Missing cost is not free usage; ratios/shares never silently mix coverage or average row percentages.
- Repeated/forked/subagent records are not double-counted, with source attribution retained.
- A synthetic spike can be traced from date group to model to session and opened without starting agents merely to read usage.

Validate the proposed layout with a scratch browser journey before treating it as settled design. This research-only change requires document/link review, not application tests.

## Sources

### Local primary sources

- **L1:** [sidebarView.ts](../../web/src/lib/sidebarView.ts), `DATE_LABELS`, `dateLabel`, `dateGroups` — actual date labels, local-midnight boundaries and `updatedAt` grouping.
- **L2:** Installed `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`, `getSessionStats()` — all-entry accounting, including standalone usage, compaction/branch summaries, tool results and assistants; not just current context.
- **L3:** [contextUsage.ts](../../web/src/lib/contextUsage.ts) and [wire.ts](../../shared/wire.ts) — existing token categories, weighted cache hit, per-response physical model and cumulative usage semantics.
- **L4:** [Glossary](../glossary.md) — session, task and acceptance distinctions.
- **L5:** [SettingsSectionFrame.tsx](../../web/src/components/SettingsSectionFrame.tsx), [SettingsPage.tsx](../../web/src/components/SettingsPage.tsx) — shared Settings layout and current sections.
- **L6:** Installed `node_modules/@earendil-works/pi-ai/dist/types.d.ts`, `Usage` — cost components and token subset definitions.
- **L7:** Installed `node_modules/@earendil-works/pi-ai/dist/models.js`, `calculateCost` — per-category rates, tier selection and cache-write pricing.
- **L8:** [PiRecords.ts](../../server/PiRecords.ts), `usageOf` — absent-field zero normalization and flattened cost.
- **L9:** Installed `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts`, `SessionEntryBase`, `UsageEntry`, `CompactionEntry`, `BranchSummaryEntry`; installed `node_modules/@earendil-works/pi-ai/dist/types.d.ts`, `AssistantMessage` — entry timestamps, request-start timestamps, optional duration and model-attribution limits.
- **L10:** [PiHistory.ts](../../server/PiHistory.ts), `savedEntries`, `savedFacts` — all-entry read path versus context-oriented snapshot.
- **R1 (earlier research, not a fresh audit):** [Practical usage dashboard](2026-10-12-usage-dashboard.md) — broader history accounting feasibility and limitations.

### External first-party sources

- **E1:** [Langfuse: LLM Cost Management](https://langfuse.com/resources/engineering/llm-cost-management) — session/model attribution, overlapping token-category risks and recorded-versus-inferred cost.
- **E2:** [Langfuse: Chart any table](https://langfuse.com/docs/observability/features/events-table-charts) — metric/aggregation/breakdown composition over a filtered query.
- **E3:** [Langfuse: Pulse](https://langfuse.com/docs/observability/features/pulse) — compact time-bucket view for spotting and drilling into spikes.
- **E4:** [Langfuse: Metrics API](https://langfuse.com/docs/analytics/metrics-api) — aggregating usage/cost by dimensions, filters and time interval.

External evidence came from search-extracted first-party content; pages were not independently browser-tested. No claim is made about current provider prices. The recommended metrics and layout are deductions from these sources and Piano's contracts, not measurements of user behavior.
