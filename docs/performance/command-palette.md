# Command palette: bounded search work

Measured 2026-10-18. Implementation: `11cff583309d6df70e9e98c9c8d663574d0b69f6`,
code tree `a22a2f884df42713518a8a341630494d60e7647f`, after rebasing onto `bc67950`.
Background: [initial research and baseline](../research/2026-10-18-command-palette-performance.md).

Invariants: INV-01 (browser search is a disposable projection, not another history store),
INV-07 (actions retain their session/workspace identity), INV-09 (bounded measurements and explicit
failures), INV-11 (loopback scratch instances, no access to the user's database).

## What changed

- The input owns its immediate text state separately from the catalog and result list. Only the
  query is debounced, by **80 ms**. Clearing returns to recents immediately; IME composition does
  not launch searches or activate results.
- A dedicated worker filters and ranks with the existing relevance policy. cmdk no longer filters
  or sorts the same candidates again. Only search documents cross the worker boundary, and only
  when the catalog changes. There is at most one active scan and one replaceable queued query;
  superseded replies cannot publish. The worker caches its last ranking for paging.
- Each group renders at most **50 matches**, with keyboard-accessible Previous/Next rows and a
  range/count heading. Searching still reaches every eligible session, file and link. Empty input
  retains the existing eight recent sessions and five recent files/links.
- Catalog preparation survives input, token updates, identical registry refreshes, stats-only
  changes and history replay ID changes. Actual labels, aliases, membership, availability,
  selection and ordering changes still invalidate the relevant projection.
- A pending query cannot execute a stale row through Enter or a pointer. Enter flushes a pending
  debounce and consumes the key; another Enter activates the settled result. Background refreshes
  preserve valid keyboard choices and page positions rather than silently selecting another row.
- Sidebar rows with unchanged catalog fields are memoized. Their closed menus no longer compute
  session commands or subscribe to every token; opening a menu reads current command state.
- Radix still owns dialog presence/close animation. Search work is cancelled while closing and
  the worker terminates when the contents unmount. Failure offers “Close and reopen to retry”;
  clearing to recents remains usable without a worker.

No new dependency, backend search endpoint, database index, fuzzy matcher, or production deployment.
Upstream-owned `ui/` files and CSS tokens are unchanged. A trial of CSS content containment was
removed; it is not part of the implementation or final measurements.

## Results and acceptance status

**The search budget passed in the final samples. The stricter typing goal did not.** This is a
substantial improvement in search work and responsiveness, not a claim that every interaction is
now below 50 ms or that the entire performance goal is complete.

| Final workload | Search median | Search p95 / max | Input proxy p95 / max | Open proxy |
| --- | ---: | ---: | ---: | ---: |
| 1,000 sessions, expanded sidebar, streaming conversation | 146.7 ms | 174.4 / 174.4 ms | 69.8 / 73.7 ms | 149.5 ms |
| 10,000 searchable sessions, closed folder, no conversation | 141.1 ms | 227.1 / 227.1 ms | 62.7 / 64.7 ms | 63.1 ms |

Raw observations: [streaming / 1,000](command-palette/stream-1000.json),
[idle / 10,000](command-palette/idle-10000.json).

- Search: final edit to the first completed result's two-frame observation, including debounce
  and worker work. All broad-match runs showed 50 matching sessions plus Next; no-match runs
  showed zero result rows. A separate check of the saved JSON passed the **p95 <300 ms** and
  **maximum <700 ms** search gates and verified every result count.
- Typing: captured input event to two animation frames later, for individual keyboard presses
  and single-event paste. Both scripts exited **1** on the **p95 <50 ms** assertion. The final
  runs passed the <100 ms maximum gate, but an earlier candidate run reached about 107 ms.
  Do not treat these samples as a worst-case bound. The streaming opening sample also missed the
  proposed <100 ms opening goal.
- Rapid automation bursts are retained separately in the JSON. Their early-event frame delays
  include later edits' work; they are not individual key-to-paint times.

The original 2-CPU development-build baseline had repeated **214–459 ms main-thread tasks** at
1,000 sessions and a worst input-to-two-frames observation of **2,153 ms**. An early same-machine
implementation run reduced that proxy to 44 ms and search completion to 172 ms. The final table
uses a **different machine configuration and a production build**; do not attribute every numerical
change between the original baseline and this table solely to the code.

## Measurement boundaries

Final environment: exe.dev Linux x86_64, four vCPUs, 7.7 GiB usable RAM, no swap, Node 24.22.0,
React/React DOM 19.3.0, cmdk 1.1.1, agent-browser 0.39.1, headless Chrome 155.0.0.0, 1280×900.
Production assets were built into `.scratch/palette-dist`, not the running deployment's assets.
Each run used its own SQLite database, throwaway Git repository, fake Pi, isolated history/home,
and loopback backend/preview on harness-assigned ports. No paid model calls were made.

Each workload had **12 queries**: four automated bursts, four character-by-character keyboard
sequences, and four pastes, alternating broad `release` searches with `zzzzzzz` no-match cases.
The typing summary uses the keyboard/paste samples, not bursts. Percentiles use nearest rank;
with only 12 searches, search p95 equals the maximum. These are local samples, not statistically
strong estimates of production tails. Titles were synthetic, with shared prefixes and unique IDs.

The streaming fixture emits one text delta every 200 ms into one selected conversation, with
1,000 sidebar sessions. The 10,000-session fixture deliberately keeps its folder closed to isolate
palette scale: it does **not** establish performance with 10,000 rendered sidebar rows. Neither
fixture represents a huge transcript or a real provider's maximum event rate.

Two frames are a conservative responsiveness proxy, **not exact paint latency or INP**. Input
capture starts after event delivery and therefore does not itself include input queueing; Event
Timing entries are retained separately. Browser automation, scheduling and software rendering
contribute to the results. Do not use a passing proxy to assert literal “no lag.” The palette is
opened before instrumentation/typing, so the worker can warm up; a cold, immediate first query over
a slow network and real-device Safari/mobile IME behavior remain unverified.

An early streaming probe incorrectly kept overwriting its first-result timestamp on subsequent
background updates. Those inflated search measurements were discarded; the final probe freezes
only the first completed observation for the requested query. This correction does not relax the
latency thresholds. The scripts still fail their typing gate, and that failure is retained here.

## Verification

On implementation `11cff583` after the rebase:

- `npm run typecheck`: pass.
- `npm run lint`: pass, including the commit hook.
- `npm test`: **825 passed**, none failed/skipped, about 43 seconds on the upgraded VM.
- `npm run test:browser`: pass for session start, open/continue (including the new stale-query
  Enter regression and palette navigation), and transcript-row alignment.
- `cd web && npx vite build --outDir /home/exedev/piano/.scratch/palette-dist`: pass; Vite retains
  its existing large-chunk warning.
- Final performance scripts: **failed typing p95**, with separately verified passing search
  budgets as described above. They are not reported as fully passing checks.

Additional scratch browser observations before the typography-only upstream rebase covered paging
through 123 sessions and links, Home/End/Enter, clear, no matches, IME suppression, switching to a
rare match, delayed/superseded worker responses, worker-construction failure and reopening, and
sidebar Pin/Unpin menus reading fresh state. An initially failing link-paging check exposed the
background-selection race; the corrected journey passed. Module coverage now protects preserving
paging choices, query resets, catalog replacement, identical refreshes and replay IDs.

Regression sensitivity was checked by temporarily removing the page slice: the paging test failed
with **123 rows instead of 50**, then passed after restoration. The identical-catalog test was also
observed failing before the cache fix. Relevance tests were updated to assert the new externally
filtered contract rather than requiring nonmatching cmdk candidates.

Before/after `test/browser/style-shots.mjs` captures were compared for the wrapper/sidebar edits.
Desktop palettes differed by 26–27 pixels (caret); the mobile palette, model pickers and major
transcript captures were identical. Other differences were reviewed as fixture paths, provider
catalog data and focus/animation timing. Later search-state corrections did not change styles.
The incoming composer typography change is unrelated and was included in the final build/tests.

### Local evidence and resource limits

Browser drivers remain uncommitted under `.scratch/`, per the testing policy. Important commands:

```sh
# Functional observations, with the scratch harness's resource guard:
node .scratch/palette-interactions.mjs .scratch/browser/palette-interactions-corrected

# Final, isolated production-build performance samples (exit 1 on the typing gate):
COUNT=1000 STREAM=1 SIDEBAR=1 TRIALS=12 PROFILE= node .scratch/palette-production.mjs .scratch/browser/palette-rebased-stream-1000
COUNT=10000 STREAM= SIDEBAR= TRIALS=12 PROFILE= node .scratch/palette-production.mjs .scratch/browser/palette-rebased-idle-10000
```

These local scripts are not present in a fresh clone; the retained JSON, workload description and
committed functional/module tests document their scope. Screenshots and logs remain under
`.scratch/browser/` and `.scratch/palette-*.log`. Style pairs are in `palette-before`, `palette-after`
and `palette-style-diffs` beneath `.scratch/browser/`.

A long trace/export on the original 2-vCPU/4-GB VM was followed by sustained memory-pressure
warnings and a user-initiated restart. No OOM-kill event was found; trace export is the leading
suspect, not a proven root cause. That interrupted run is not final verification. The user then
upgraded to 4 vCPUs/8 GB. Final performance runs collected **no full trace**, ran one browser at a
time, and used a 120-second/1-GiB-available-memory guard. Minimum available memory was about
**5.7–5.8 GiB**; their scratch processes and data were cleaned up. Interrupted fixtures from the
restarts were also removed. The user's own Piano services/database were not changed by the tests.

## Remaining work

The strict typing/opening targets need further browser rendering/presentation investigation and
real-device observation. Search computation is now off the input thread, but that does not make
DOM commits, background rendering or presentation instantaneous. Any further profiling should
capture a short, specific interaction with resource monitoring, not another long all-events trace.
Do not add a server search service or replace the matcher based on these remaining paint metrics.
