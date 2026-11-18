# Session page performance baseline

`PERF_SIZES` and `PERF_REPEATS` narrow a run of `test/browser/session-perf.mjs`.

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
