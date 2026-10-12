# YEJ-14: folder and registry latency

Issue: [YEJ-14](https://linear.app/goofansu/issue/YEJ-14/piano-measure-synchronous-folder-and-registry-work-before-optimizing).
Measured 2026-10-12 on base `cba4c63`, with the changes in this PR for the after runs.
Invariants: INV-01 (unchanged registry ownership/persistence), INV-07/09 (scratch identity and bounded evidence), INV-11 (loopback isolation).

## Decision

Move the folder picker's filesystem reads to promises, with at most eight child metadata operations
in flight per request. Preserve hidden-entry exclusion, directory symlinks, sorting, Git hints and
missing/file errors. Do not change SQLite, registry transactions, runtime transport or UI.

This is a **targeted slow-folder improvement**, not a claim that Piano's performance is now acceptable
at every measured size. The current registry already writes only changed rows; it does not rewrite
all SQLite rows on every mutation. It still walks/serializes whole snapshots in memory.

The controlled slow-folder reproduction supports the change. Adding 1 ms to each filesystem metadata
operation on a 100-entry folder caused ~243 ms event-loop stalls before the change. Afterward, the
maximum was ~13 ms and an unrelated live session's command-request p95 fell from ~259 ms to ~13 ms.
The warmed local filesystem pays promise/scheduling overhead instead: listing throughput gets worse.
That trade-off is intentional here; it does not justify asynchronous SQLite or a persistence redesign.

## Reproduce

```sh
npm ci
node test/performance-folder-registry.mjs /tmp/piano-performance.json
# Short controlled slow-folder reproduction:
PIANO_BENCH_SLOW_ONLY=1 node test/performance-folder-registry.mjs /tmp/piano-performance-slow.json
```

Run uncontended, separately from the test suite/browser checks. Requires Node 24, Git and Linux `ss`.
The script starts `server/main.ts` on an ephemeral loopback port, uses a temporary SQLite registry and
isolated home/config/Pi directories, and deletes its scratch data after stopping its own child. Pi is
`test/fake-pi.mjs`; no credentials or paid model calls are required. JSON and backend logs are written
beside the specified output path; its parent directory must exist.

To repeat the before/after comparison, run this PR's benchmark files in a separate checkout of
`cba4c63` (copy `test/performance-{folder-registry,monitor}.mjs` there), then run them in this PR.
Do not replace files in a running checkout or use the real registry. No builds or deployment needed.

### Workload and measurement boundaries

- Linux 6.12.93, Node 24.21.0, two visible AMD EPYC 9554P CPUs, ext4; exact environment is in the JSON.
  Locked Effect/platform-node 4.0.2. SQLite WAL / synchronous FULL unchanged.
- Three synthetic developer-size envelopes: 10 folders / 100 saved sessions; 20 / 1,000;
  and a stress case of 100 / 5,000. 90% of saved references are archived. These are workload assumptions,
  **not measurements of the user's registry**. Folders are subdirectories of one scratch Git repository.
- Picker folders contain 100, 1,000 or 10,000 visible, non-Git child directories. Metadata is warm/local.
  A fourth case uses 100 entries and an injected 1 ms delay for each `stat`, `access`/`exists` and
  `readdir`, affecting only the listing path. Synchronous calls block; promise calls wait asynchronously.
  This reproducibly models latency, not actual NFS/FUSE contention or errors.
- One fake-Pi session runs while two WebSocket clients consume and acknowledge registry broadcasts.
  An observer sends liveness pings; an HTTP observer requests that live session's commands from its child.
  Each sends another request 5 ms after the previous completes. No prompt-generation timing is claimed.
- Each phase performs 40 listings or 40 project renames, waiting 20 ms after each operation. Rename
  latency ends when a browser-side registry frame carries the new name, not at SQLite commit.
  Idle phases use the same 40 waits; their `operationMs` is a no-op, not a request metric.
- The backend records `monitorEventLoopDelay({ resolution: 1 })`. These are sampled timer delays,
  not isolated CPU time. Client latencies include fetch/body decoding, IPC and client scheduling.
  Percentiles use nearest rank. Closed-loop probes under-sample busy periods; compare maxima and
  operation latency too, not only percentiles or sample counts across different-length phases.
- After stopping the backend, the same database is reopened through `RegistryLive` with no listeners.
  Another 40 project renames measure registry update/persistence without sidebar, Git or delivery.
  Reopen assertions check the last project name and session count after both workloads. Existing
  registry tests, not this benchmark, establish rollback and competing-writer semantics.

## Results (milliseconds, rounded)

Raw results: [before local](yej-14/before-local.json), [before slow](yej-14/before-slow.json),
[after, including direct registry](yej-14/after.json).

| Listing workload | Listing p95 before → after | Session commands p95 before → after | Event-loop max before → after |
| --- | ---: | ---: | ---: |
| 100 entries, local | 17 → 33 | 14 → 15 | 10 → 11 |
| 1,000 entries, local | 91 → 175 | 73 → 60 | 78 → 133 |
| 10,000 entries, local stress | 687 → 1,295 | 680 → 19 | 588 → 589 |
| 100 entries, synthetic slow metadata | 257 → 66 | 259 → 13 | 243 → 13 |

The 10,000-entry p95 improvement does **not** remove its tail: after-change session-command p99 was
~549 ms and max ~611 ms. Large response processing still blocks. Likewise the local 1,000-entry
maximum worsened in this run. This patch only removes synchronous filesystem waiting; sorting,
response schema encoding, redaction and JSON serialization still run on the event loop.

| Saved sessions | Direct registry write p95 | End-to-end rename p95 | Session commands p95 during renames | Event-loop max during renames |
| --- | ---: | ---: | ---: | ---: |
| 100 | 5 | 98 | 189 | 64 |
| 1,000 | 11 | 598 | 1,227 | 444 |
| 5,000 | 33 | 2,966 | 5,926 | 2,076 |

These after measurements isolate a major remaining cost outside direct registry persistence. The
full path includes synchronous sidebar assembly, per-client response projection/serialization and
background discovery. Inspection also found that `projectDisplay` rebuilds its environment-secret
list for every string, but this benchmark does not separately attribute its cost. **Next work should
profile that full path before changing SQLite.** Keep redaction semantics and bounded delivery intact.
This issue's targeted improvement does not resolve large-registry responsiveness.

## Verification and limitations

- `node --test --import ./test/setup.ts test/Router.test.ts`: pass, including a new HTTP contract case
  for sorting, hidden entries, files, directory/broken symlinks and missing/file errors.
- `npm test`: **368 passed**, 0 failed/skipped, 81.1 s in the standalone run.
- `npm run typecheck`: pass. `npm run lint`: pass. `git diff --check`: pass.
- `PIANO_ALLOWED_ORIGINS=http://127.0.0.1:7172,http://localhost:7172 node test/browser-folder-picker.mjs /tmp/yej14-browser-allowed`:
  pass through `npx agent-browser` on scratch backend 7171 / Vite 7172. Covers folder navigation,
  loading/error selection guards, creation, stale responses, draft retention, home and mobile layout.
  [Retained observations](yej-14/browser.json); full command output/screenshots remain at that `/tmp` path.
- The first parallel test/browser attempt overloaded the two-CPU VM: suite hit the 240 s tool timeout
  and a browser command was terminated. The standalone suite then passed. A standalone browser attempt
  without `PIANO_ALLOWED_ORIGINS` failed at listing (the old runner omits it); rerunning with the documented
  origin configuration passed. These failed attempts are not counted as successful verification.
- The initial local baseline's idle window included startup/settlement work. The retained slow baseline
  and final harness wait for fresh folder discovery plus 500 ms before sampling. Do not compare the
  initial local **idle** tails as steady-state evidence. Listing/rename phases followed that window.
- One run per full workload, not a statistical confidence interval or a CI performance threshold.
  No real remote filesystem, slow disk, SQLite lock contention, permission fault, many-tab fan-out,
  or real-model streaming benchmark. No cold-cache or production-load claims.
- No global concurrency cap across many simultaneous listing requests. Each request bounds its own
  child metadata work; Node's worker pool remains shared. Native filesystem operations already queued
  cannot necessarily be cancelled when the request is interrupted.
- No production registry access, persistence migration, build or deployment. Existing registry tests
  suffice because persistence is unchanged. The benchmark remains opt-in, not a flaky CI timing test.
