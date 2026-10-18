# Cmd+K: responsive typing and search below 700 ms

Date: 2026-10-18. Status: research and measured baseline, **not an implemented fix**.
Application revision: `373a996a3d1b4a19b94b24d77898a50a278cc90b`.

Follow-up: [implementation, verification and remaining latency limits](../performance/command-palette.md).

## Recommendation

Separate immediate input from search. Start with a **150 ms trailing debounce**, filter/rank
once outside cmdk, and render a bounded page of matching rows (initial proposal: 50 session
results). Cache query-independent catalog work. Preserve access to subsequent matches rather
than silently truncating the searchable catalog. Add a worker if scoring still blocks typing at
the agreed catalog size; do not start with a server search service or a new fuzzy-search library.

Debouncing alone is insufficient: it reduces how often expensive work starts, not how long that
work blocks the next keystroke. Enter-only search is an alternative product choice, not necessary
as the default fix. The measurements below support reducing candidate-component and DOM work
first; they do not establish that this proposal already meets the target.

## Define the target before implementation

The user requested no typing lag and search under 700 ms. Proposed measurable interpretation:

- **Typing:** input-event-to-visible-character p95 below 50 ms, no measured interaction above
  100 ms in the acceptance workload. These are proposed engineering thresholds, not a claim that
  literal zero latency is possible. Include input queueing, not just handler duration.
- **Search:** final edit to painted, selectable results for that exact query below **700 ms**,
  including debounce, scheduling, computation, transfer and rendering. For explicit submission,
  measure from submission instead. Do not report only the filter-function duration.
- **Correctness:** no stale query may replace newer results or execute an obsolete selection;
  search must still reach all eligible sessions. Keep current ranking, aliases and command groups.
- **Scale:** propose 1,000 sessions as the reproduced case and 10,000 as the acceptance ceiling,
  to be confirmed against actual usage. Test varied title lengths and common prefixes, not just
  random strings. An unbounded session count cannot carry an unconditional latency guarantee.

An initial budget could be 150 ms debounce + 150 ms search/transfer + 100 ms render/paint +
100 ms scheduling allowance = 500 ms, leaving 200 ms headroom. This is an allocation, not a
benchmark. A 150 ms main-thread search would still violate the typing goal: move/chunk such work.
A trailing debounce intentionally waits during uninterrupted typing; the 700 ms search clock
starts at the last edit, not at every intermediate query.

## What the current code does

Sources are the repository at the revision above and the installed cmdk 1.1.1 distribution.

1. [`CommandPalette.tsx`](../../web/src/components/CommandPalette.tsx) controls the input with
   `search`, calls `commandPalette(state, { search, ... })` directly during rendering, and maps
   every returned row into `CommandItem`. There is no debounce, deferred list or result window.
   The palette component also computes groups while its dialog is closed.
2. [`commandPalette.ts`](../../web/src/lib/commandPalette.ts) shows eight recent sessions before
   searching. Any nonblank search produces rows for **every nonarchived session**, scores them,
   sorts rows and groups, and retains even zero-score rows for cmdk to filter later. This is
   metadata search (title, folder, branch, project, ID), not server-side transcript search.
3. [`sessionCatalog.ts`](../../web/src/lib/sessionCatalog.ts) reconstructs entries, joins folders,
   hosts and projects, then sorts by parsed creation time whenever `recentSessions` is called.
   The palette also re-extracts conversation links when a session is selected. Those operations
   do not intrinsically depend on query text.
4. cmdk receives `filter={paletteFilter}` and does filtering/ranking again. In installed
   `node_modules/cmdk/dist/index.mjs`, updating its search calls the filter and DOM-sort paths;
   sorting uses DOM queries and `appendChild`. Item components subscribe to its external store.
   Nonmatching items can return `null`, but Piano still constructs their React components and
   cmdk registers them. An empty DOM result therefore does not mean an inexpensive query.
5. This is a **controlled** cmdk input: its input callback updates Piano state; cmdk synchronizes
   the controlled value into its search store in an effect. Simply passing a debounced value to
   Piano's ranking function while leaving cmdk filtering enabled does not debounce that second path.
6. [`PianoCommand.tsx`](../../web/src/components/PianoCommand.tsx) exposes `filter`, but its custom
   `CommandDialog` does not currently expose/forward `shouldFilter` to the inner `Command`.
   That wrapper must be extended deliberately; adding a prop to the dialog alone is insufficient.

The duplicate ranking exists for a reason: newly matching rows previously appeared in the wrong
order. Preserve that observable behavior, not both implementations. Existing
[`CommandPalette.test.ts`](../../test/CommandPalette.test.ts) covers this, recent ordering, alias
precedence, groups and file/link queries. Some assertions explicitly expect all candidates for
cmdk; a new external-filter contract would require reviewing those assertions rather than blindly
retaining the implementation detail.

## Measured baseline

Scratch only: fresh SQLite database, throwaway Git repository, synthetic Pi history, fake Pi,
loopback backend/Vite on harness-assigned free ports. No model calls, real database access,
production restart or application-source edits. The existing
[`test/browser/harness.mjs`](../../test/browser/harness.mjs) stopped its processes and removed its
scratch repository/history after each run.

Environment: exe.dev Linux VM, Node 24.21.0, React/React DOM 19.3.0, cmdk 1.1.1,
agent-browser 0.38.1, headless Chrome 155.0.0.0, 1280×900 viewport, Vite development mode,
no deliberate CPU throttling. Runs were sequential.

Fixture: sessions named `Release planning <n> authentication review`, unique IDs and creation
times, one closed folder so the sidebar does not render thousands of sessions, no selected
conversation. Open Cmd+K, type `release` in a burst, record main-thread long tasks and time from
each captured input event to two animation frames later. `zzzzzzz` is the no-match comparison.

| Sessions / query | Long tasks during typing | Worst input → two frames | Last input → two frames | Pure palette median / p95 |
| --- | --- | --- | --- | --- |
| 100 / `release` | 67–95 ms | 339 ms | 40 ms | 1.0 / 1.2 ms |
| 1,000 / `release`, first run | 50–428 ms | 1,974 ms | 282 ms | Not sampled |
| 1,000 / `release`, repeat | 214–459 ms | 2,153 ms | 256 ms | 10.2 / 11.8 ms |
| 1,000 / `zzzzzzz` | 83–462 ms | 1,119 ms | 90 ms | 2.3 / 2.5 ms |

Separate browser-only computation sample: `commandPalette` over **10,000** synthetic references,
without rendering those rows, took **115.4 ms median / 129.6 ms p95** (145.7 ms maximum).
Pure samples used five warmups and 20 measured calls, with empty command/file arrays. They include
catalog construction, row creation, scoring and sorting, not just the fuzzy matcher. These small
sample p95 values are descriptive, not acceptance statistics.

**Interpretation:** large catalogs reproduce substantial browser stalls even without sidebar or
transcript load. At 1,000 sessions, the pure function is much cheaper than the complete update.
The no-match run remains slow despite zero final item DOM nodes. This supports reducing candidate
components, duplicate cmdk work and rendering before replacing the matcher. It does not precisely
apportion time between React, cmdk, layout and paint; a production trace is still needed for that.
At 10,000 sessions, computation itself also warrants optimization or off-main-thread execution.

**Limitations:** two animation frames are a responsiveness proxy, not an exact paint measurement.
Rapid automation can put several edits before a frame, so the worst value includes later edits'
work; it must not be called an individual search duration or INP. Event Timing returned no
interaction entries for this automation path. The last-input proxy was below 700 ms in these
runs, but typing was plainly blocked by repeated long tasks. Development-mode, synthetic, burst
results do not establish production or real-device latency. No proposed optimization was benchmarked.

### Local evidence and reproduction

The uncommitted harness is `.scratch/palette-research.mjs`. Its assertion fails when any
input-to-two-frames proxy reaches 700 ms; that is a deliberately loose reproduction gate, **not**
the proposed 50/100 ms typing acceptance gate. It gave the same failing verdict on both
1,000-session broad-match runs.

```bash
COUNT=100 node .scratch/palette-research.mjs .scratch/browser/palette-100
# exit 0: reproduction gate passes; not proof of lag-free input
COUNT=1000 node .scratch/palette-research.mjs .scratch/browser/palette-1000-repeat
# exit 1: AssertionError, input-to-two-frames proxy exceeds 700 ms
COUNT=1000 QUERY=zzzzzzz node .scratch/palette-research.mjs .scratch/browser/palette-1000-nomatch
# exit 1: same assertion
COUNT=100 PURE_COUNT=10000 node .scratch/palette-research.mjs .scratch/browser/palette-pure-10000
# exit 0: only 100 sessions rendered; separate 10,000-reference pure computation sample
```

Each directory contains `measurements.json`; failed runs also capture `failure.png` and process
logs. Console logs are `.scratch/palette-*.log`. These are local evidence, not committed fixtures
or portable artifacts. The setup, recorded environment and results above remain in this note.

## Strategies and trade-offs

| Strategy | What it helps | Limit / decision |
| --- | --- | --- |
| 150 ms trailing debounce | Skips intermediate searches during a typing burst | Recommended after separating raw input. Never debounce the displayed text. Does not interrupt work already running. |
| Search only on Enter | Removes search work while editing | Valid alternative, but Enter currently activates a result. Must distinguish dirty query → search from settled query → activate; adds a step and still needs bounded rendering. |
| `useDeferredValue` + memoized results | Lets React prioritize input over result rendering | Useful alternative/complement, not a fixed debounce or deadline. It cannot preempt an arbitrary synchronous scoring loop or expensive commit. Do not leave the cmdk auto-filter path active. |
| Cache catalog/search documents | Avoids rebuilding and sorting unchanged metadata | Invalidate on actual searchable metadata changes, not each new whole `AppState` object or token event. Keep selection/availability current separately. |
| External filtering + bounded result page | Removes duplicate scoring and most candidate components/DOM | Highest-priority structural change. Search the full catalog before selecting a page; retain access to all matches. |
| Virtualization | Keeps a large navigable result set with a small DOM | cmdk has no built-in virtualization. Keyboard selection, scrolling and `aria-activedescendant` need explicit integration; more risk than bounded pages. |
| Web Worker | Moves CPU search off the input thread | Useful if optimized scoring exceeds the input budget, especially at 10,000 sessions. Does not fix a huge DOM commit; avoid cloning the entire catalog per query. |
| Server search / SQLite FTS | Can avoid sending huge catalogs or enable new full-text search | Not the first fix for an already-loaded metadata search. Adds network/index freshness work and changes matching semantics. Reconsider only after measurement or a new transcript-search requirement. |

Primary API evidence: React's [`useDeferredValue` documentation](https://react.dev/reference/react/useDeferredValue)
requires memoizing the slow child for this pattern and distinguishes deferral from fixed-delay
debouncing. Installed cmdk 1.1.1's `README.md` documents `shouldFilter={false}` for external
filtering/sorting and says virtualization is not built in. Its general “2,000–3,000 items” statement
is not a guarantee for Piano's row composition or latency target. Mozilla's
[worker documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)
explains separate-thread execution, message copying and the inability to manipulate DOM in a worker.

## Suggested implementation sequence

1. **One search owner.** Make the palette's data layer return matching rows in final order,
   with stable tie ordering and group ranking. Forward `shouldFilter={false}` through
   `PianoCommand.CommandDialog`; leave `web/src/components/ui/` upstream-owned. Keep the current
   matcher initially. Drop empty groups and explicitly handle pending versus genuinely empty results.
2. **Bound rendering.** Start with 50 session matches per page, keeping the small command groups
   available. Provide a keyboard-accessible next/previous page mechanism with bounded replacement,
   not unlimited append. Preserve full reachability of `!files` and `!links`, using paging or
   tested virtualization for large sets too. Page size and the added navigation UX need validation.
3. **Separate input and results.** Keep raw input updates tiny; isolate/memoize the results subtree
   with stable props. Debounce only the committed query by 150 ms. Mount expensive palette content
   only while open. Cache prepared documents/recency ordering by their actual source inputs;
   do not re-extract links or rebuild search strings on every edit.
4. **Keep pending behavior safe.** Results carry their query and catalog generation. While the raw
   query differs, old results may remain visible but cannot be activated accidentally. Enter while
   pending flushes the search and consumes the key, never executes a stale row; a subsequent Enter
   activates the settled selection. Guard pointer selection too. Clear returns immediately to
   recents. Respect IME composition; cancel pending timers/work on close and session-context change.
5. **Measure again, then isolate CPU if needed.** If preparation/scoring still creates input stalls,
   maintain serializable search documents in a worker, send query/generation IDs and return ordered
   IDs/scores rather than entire UI rows. Ignore obsolete replies and coalesce queued queries; merely
   ignoring replies does not cancel CPU work. Include cold worker startup and catalog transfer in
   the budget. Do not use `startTransition` or a timer as if it moved JavaScript to another thread.

This preserves **INV-01** (a disposable browser search projection, not another history store),
**INV-09** (measured claims scoped to revision/environment), and **INV-11** (scratch-only, private
loopback verification). It follows the roadmap's current responsive-daily-use priority, not a new
backend architecture. See [invariants](../development-invariants.md), [roadmap](../roadmap.md),
[UI ownership](../shadcn-ui.md) and [testing policy](../testing.md).

## Acceptance evidence for the eventual change

Use the same synthetic scale fixture before/after, then a production-mode scratch build when
implementation is authorized. Include 100/1,000/10,000 sessions; cold opening and warm searches;
single characters, fast typing, human-paced typing, paste, clearing, no matches, broad matches,
and a rare match beyond the first page. Include open-sidebar load and a streaming selected
conversation; the isolated baseline deliberately excludes those costs.

Collect enough repeated interactions for meaningful p95/max, actual key/input-to-paint evidence,
long tasks, and final-query-to-painted-result timing. Confirm the correct query's result IDs and
selection, not just that a frame elapsed. Check representative desktop hardware plus a slower
CPU/device; publish the exact tested ceiling and environment rather than extrapolating from this VM.

Retain existing relevance tests; add focused coverage for pagination reachability, late-result
rejection, catalog invalidation and Enter/pointer safety while pending where the new design exposes
those risks. Observe Arrow/Home/End navigation, Escape/reopen, IME and focus/ARIA behavior in the
scratch browser. Timing evidence belongs in the browser, not a flaky wall-clock assertion in the
module suite. A `PianoCommand` wrapper edit also requires before/after style shots per project policy.

For this documentation-only change, review source accuracy and links; full typecheck/module tests
are not required. The observed baseline failures above are findings, not a failed implementation
verification or a claim that the problem is fixed.
