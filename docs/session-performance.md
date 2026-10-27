# Session page performance baseline

Run the opt-in diagnostic from the checkout (Node 24, installed dependencies and Chromium for
agent-browser). It uses `agent-browser@0.38.1` through npx; Critical paths CI is unchanged.

```sh
node test/browser/session-perf.mjs .scratch/browser/session-perf
# Narrow a suspected cliff (sizes must be positive even integers):
PERF_SIZES=500,750,1000 PERF_REPEATS=3 node test/browser/session-perf.mjs .scratch/browser/session-perf-cliff
```

The directory receives `results.json` and first-repetition screenshots. Keep results with PR
evidence, not in Git. Defaults are 100/500/1000 messages, short and long, three repetitions.
There are no timing assertions: this is a baseline, not a shared-machine CI performance gate.

## Boundary and method

Claim: quantify how transcript size and message complexity affect opening, scrolling and sending
on the current session page. INV-09 applies: evidence proves this bounded synthetic workload,
not real-model latency or production/mobile performance.

- The existing browser harness creates a throwaway Git repository, database, HOME, Pi agent and
  session directories, fake Pi and loopback backend/Vite servers. Each sample gets a fresh browser
  and backend; recorded children and temporary data are cleaned up. No paid calls or real sessions.
- N counts saved messages, half user and half assistant, with alternating roles and deterministic
  content. Short messages have one small paragraph. Long messages have twelve paragraphs of
  Markdown (bold, inline code, link) plus a fenced JS snippet, about 2 KB each. User prompts retain
  the product's default collapsed presentation. No tools, images, diagrams or compactions.
- Viewport: 1280 × 900, headless Chromium, no CPU/network throttling. Development Vite/React,
  **not a production build**. Open `/` first to warm module transforms, then navigate through
  `about:blank`, collect garbage, disable browser HTTP cache and load `/s/<id>` directly.
  This is a fresh-document, cache-disabled open, not cold OS/filesystem/server caches.
- **Ready ms:** navigation time origin to N messages in the in-memory transcript, its final
  article mounted at the bottom and an enabled Message composer, followed by two animation frames.
  The pre-virtualization harness instead required all N anchored articles; that assertion is
  deliberately replaced by full-history readiness plus bounded mounting (at most 25 articles in
  this fixture/viewport). This is a rendered/usable proxy, **not standardized TTI**, and does not
  guarantee all asynchronous syntax highlighting has settled. Browser FCP is recorded separately: it can be the shell,
  so it is not the transcript paint metric. Long-task timings identify opening main-thread stalls.
- **Scroll:** sweep the real transcript scroller top-to-bottom over two seconds using animation
  frames. Record interval p95/max, count over 33.4 ms, frame count and height; assert arrival at
  the bottom. Also record placeholder frames, assert no sampled frame lacks a row covering the
  viewport, and measure settlement to the real final article. Geometry updates synchronously;
  expensive Markdown yields during rapid scrolling, with height-preserving placeholders rather
  than blanks. These frames therefore measure scrolling, not full Markdown painting at every
  intermediate position. After the memory sample, stop at the middle and measure real article
  readiness there too; a smooth sweep must not hide a renderer that never catches up. Screenshots
  show that middle destination. Estimated scroll height is not comparable to the old fully
  measured height. This stresses DOM rendering/scroll handlers but is not hardware wheel/compositor
  FPS. Include max alongside p95: a single visible stall can disappear from p95.
- **Append:** fill the real composer and click Send through agent-browser. Start the clock inside
  the click event; stop two frames after the fake Pi's echo appears. This measures a user/reply
  pair including lazy Pi startup and transport, not a pure React single-row append or model time.
  CLI startup is excluded from all measured timings.
- **Memory:** CDP V8 used heap before scroll (uncollected), then forced-GC used heap after append
  (N+2 messages). Use the latter for comparisons. Neither is process RSS, GPU memory or a leak
  test. Fresh browsers avoid earlier transcripts biasing memory and browser responsiveness.
- `results.json` includes every sample, source revision/dirty paths, Node/OS/CPU and exact browser
  version. Three repetitions support medians/ranges, not tail-latency confidence intervals.

A preliminary shared-browser experiment accumulated uncollected heap across navigations and
one driver click timed out at 1,000 long messages. The harness therefore isolates each sample;
do not combine shared-browser exploratory numbers with this method's baseline.

## Rendering architecture

- `web/src/components/SessionView.tsx` hands the complete session message array to `MessageList`.
- `web/src/components/MessageList.tsx` memoizes `transcriptRows(...)`, then mounts the visible
  window plus three buffer rows on each side through TanStack Virtual. All history stays in memory;
  there is no pagination. Stable message/tool keys retain disclosure state outside recycled DOM.
  Prompts are measured together in a layout effect; ResizeObserver remeasures variable-height rows.
  Saved Markdown uses static parsing; a live reply retains streaming block identities through
  completion. Fresh windows render concurrently behind height-preserving placeholders during
  rapid scrolling; explicit jumps render immediately so their targets can be measured.
- `web/src/lib/transcript.ts` projects history into rows and jump entries; Messages only changes
  this projection, not the authoritative history.
- `web/src/components/Markdown.tsx` renders Markdown through Streamdown, including code rendering.
  The baseline deliberately varies Markdown complexity, not just message count.
- `web/src/lib/transcriptViewport.ts` owns bottom pinning and reader intent on the real scroller.
  Capture-phase scroll handling runs before the virtualizer can render and follow; measurement
  corrections acknowledge the new position without treating it as a reader gesture. Native browser
  anchoring is disabled so it cannot compensate twice. `useVirtualTranscript.ts` adapts measured
  offsets to that seam: an offscreen jump locates the message index, mounts it and refines after
  measurement. Current-entry lookup uses measured DOM positions where present and estimated
  offsets elsewhere. Unmounted content is not available to native browser Find or select-all.
- Messages only exists in session commands. These no-tool fixtures would not meaningfully exercise
  its filtering cost, so it is not benchmarked. There is no transcript full-text search measured
  here; the command palette searches sessions/commands, not transcript content.

Use observed cliffs to select further sizes rather than treating 1,000 as a universal threshold.
A production-build run, actual wheel/touch performance and real image/diagram-heavy sessions remain
separate experiments. The open-session journey covers streaming follow/unpin, offscreen jumps,
expansion across unmount/remount and resizing; the row journey checks glyph alignment.
