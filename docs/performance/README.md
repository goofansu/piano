# Performance benchmarks

Opt-in measurements for a performance claim. None is a CI gate or a latency budget: a result proves
its bounded synthetic workload on the machine that ran it (INV-09), and correctness still comes
from the module suite and browser journeys.

- Run one benchmark at a time on an idle machine, apart from test suites and browser checks.
- Each starts its own scratch backend, database and Pi directories; none needs model credentials.
- To compare revisions, run the same benchmark script in a separate checkout of the base revision.
  Compare the raw runs and their recorded revision and environment, not one machine's times.
- Keep output on the PR, not in Git.

| Measures | Command | Also needs | Detail |
| --- | --- | --- | --- |
| Transcript size against opening, scrolling and sending | `node test/browser/session-perf.mjs <directory>` | agent-browser | [Session page](../session-performance.md) |
| Sidebar rendering by session count | `node test/performance-sidebar-sessions.mjs <directory> [counts…]` | agent-browser | [Sidebar sessions](#sidebar-sessions) |
| New-session startup stages | `node scripts/bench/start-session.mjs <directory>` | agent-browser; the locked real Pi | [`scripts/bench`](../../scripts/bench/README.md) |
| Folder picker and registry latency | `node test/performance-folder-registry.mjs <file>.json` | Linux `ss` | [Folder and registry](#folder-and-registry) |
| Saved-history peeks | `node test/performance-saved-history.mjs <file>.json` | | [Saved history](#saved-history) |
| Peer gateway attachment | `PIANO_BENCH_SAMPLES=200 node test/performance-peer-gateway.ts <directory>` | Linux `/proc` | `PIANO_BENCH_PROFILE=1` adds CPU and heap profiles |

[Command palette](command-palette.md) is a dated measurement record; its scripts were not committed.

## Folder and registry

`test/performance-folder-registry.mjs` measures folder-picker and registry latency and event-loop
stalls against a scratch backend:

```sh
node test/performance-folder-registry.mjs .scratch/piano-performance.json
# Short controlled slow-folder reproduction (adds 1 ms to each filesystem metadata operation):
PIANO_BENCH_SLOW_ONLY=1 node test/performance-folder-registry.mjs .scratch/piano-performance-slow.json
```

Run it uncontended, apart from the test suite and browser checks. It requires Node 24, Git and Linux
`ss`. It starts `server/main.ts` on an ephemeral loopback port with a temporary SQLite registry,
isolated home/config/Pi directories and `test/fake-pi.mjs`, then deletes its scratch data after
stopping its own child; no credentials or model calls. JSON and backend logs are written beside the
output path, whose parent directory must exist. To compare before and after a change, copy
`test/performance-{folder-registry,monitor}.mjs` into a separate checkout of the base revision and
run them there too; never against a running checkout or the real registry.

## Saved history

`node test/performance-saved-history.mjs .scratch/saved-history.json` measures cold and five warm
saved peeks plus 16 concurrent peeks of the same 34.7 MB synthetic history with one tiny active
message. Run uncontended on Node 24: it records latency, process CPU, interactive-thread CPU and
1 ms timer gaps, using PiSessions with temporary history/Pi directories and no agent or model calls.
It disposes the service/worker and removes its fixture; the JSON survives at the supplied path.
For a baseline comparison, copy this script and `test/fixtures/large-history.ts` into a separate
checkout of the base revision and run there too. Cold observations include SDK worker startup;
warm observations do not reuse completed projections. This is evidence, not a CI wall-clock gate.

## Sidebar sessions

`test/performance-sidebar-sessions.mjs` is an opt-in rendering benchmark, not a CI timing gate:

```sh
npm ci
agent-browser install
node test/performance-sidebar-sessions.mjs .scratch/sidebar-performance
# Override the session counts for a narrower comparison:
node test/performance-sidebar-sessions.mjs .scratch/sidebar-performance 2000 5000
```

Requires Node 24, Git and agent-browser/Chromium (the same prerequisites as the browser journeys).
The existing browser harness starts a scratch backend and Vite **development** UI on free loopback
ports, with isolated database, HOME and Pi directories, fake Pi and a throwaway repository. It
creates N saved session references and empty synthetic histories, all in Today, with no pinned,
archived or running sessions. No prompts or model calls; no live database/history. Recorded children
and scratch data are cleaned up even on failure. Output JSON and screenshots survive in the chosen
evidence directory; keep them on the PR, not in Git. Run uncontended, separately from test suites.

The default counts are 100, 500, 1,000 and 2,000, at 1280×900 without throttling. Each count gets a
fresh scratch instance and browser. After an untimed app bootstrap (warming Vite and selecting the
browser target), CDP installs instrumentation before application code and measures:

- **Navigation to rows ready:** reload to the initial sidebar window committed, then two animation frames
  (a paint opportunity, not a paint trace). First reload clears the browser HTTP cache; the next
  two retain it. This is cache-cold versus cache-warm, **not** cold process/server startup. Includes
  app startup, WebSocket registry delivery, development module loading, React and layout. JSON also
  retains the commit timestamp and observed long tasks; it is not isolated sidebar CPU time.
- **Group reopen:** three real Today button clicks after collapsing and observing zero mounted
  rows. Time starts at the captured browser click, ends two animation frames after the window mounts;
  CLI invocation latency is excluded. This does not time completion of the disclosure animation.
- **Scroll cadence:** three 3-second requestAnimationFrame probes, advancing scrollTop by 120px
  each frame and reversing at the ends. JSON reports frame count, effective rate, p95/max interval,
  intervals over 34ms and distance actually travelled. This measures main-thread cadence during
  scripted scrolling, **not** compositor FPS or input-to-pixel latency. Large lists need not reach
  the bottom. Assertions bound mounted rows independently of N, then jump to the middle and bottom
  and verify contiguous visible rows. For N ≥ 100, untimed checks also retain the actual focused/menu
  node while scrolling, Tab/Shift+Tab through it, dismiss its menu with focus restored, and verify
  the offscreen row unmounts once neither focus nor menu needs it. Pin/Unpin at the list's end
  checks that a shrinking window never reads past the new session count.
- **Memory/DOM:** whole-page CDP JS heap after explicit GC, DOM node/listener counts and sidebar
  element count. Not browser RSS or sidebar-only heap. Screenshots show the actual tested surface.

The implementation path is `web/src/store.ts` (registry snapshot) →
`web/src/lib/sessionCatalog.ts` (cached against the state it reads) → `sidebarList.ts` /
`sidebarView.ts` (filter/group/sort, cached against the catalog and the sidebar's view) → `useSidebarList.ts` → `web/src/components/Sidebar.tsx`.
`SessionRows` uses `useSidebarWindow.ts` to mount visible rows plus five rows of overscan on each
side, against the shared Radix `ScrollArea` viewport. Group headers stay in normal flow. A CSS ruler
measures the existing responsive row heights and list gap/padding; each list preserves its full
scroll height. Stable session keys retain row identity through range updates. Focused rows, their
neighbours (including the nearest available sessions), open-menu anchors (through Radix focus
restoration), and each list's keyboard entry/exit rows stay mounted outside the window. Closed groups still unmount their rows. This bounds session
DOM by visible rows plus a small buffer per expanded group, not by sessions per group. It does not
virtualize group headers or paginate/filter the catalog.

Compare the raw runs, their environment/revision fields and repeated samples rather than treating
one machine's times as budgets. Before virtualization, the same instrumentation waited for all N
rows; use the base revision's harness for that comparison. Production builds, real wheel/touch
input, many-folder grouping, streaming and session selection are separate experiments. No new UI
strings, controls or actions are introduced.
