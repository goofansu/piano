# Visiting a remote Piano: where the time goes

2026-11-14 · Source audit at `0908b5696d1f2ba605c9b2149b814c97ce95aa1b`.
Research only; no proposed behavior is implemented or benchmarked here.

## Bottom line

**There is credible room for a noticeably faster repeat visit, but not evidence for a universal
speedup factor.** Switching machines currently throws away the browser's session/sidebar projection,
opens a new two-hop socket, waits for the peer's registry, and only then selects the remembered
conversation. Even a running session goes through history-file discovery before attachment.
These are concrete optimization targets; replacing the peer transport is not a prerequisite.

Separate three goals: **previous list visible**, **current list received**, and **conversation ready
for input**. A read-only remembered sidebar can improve the first substantially without improving
the other two. Avoid reporting that as faster authoritative restoration.

The existing implementation already caches the server's sidebar and model catalogs, reads saved
history off-thread, and virtualizes both session rows and transcript rows. “Cache everything,”
“stop starting Pi on open,” and “add virtualization” are not useful descriptions of new work.

## Observed waterfall

All source links below are pinned to the audited revision. Line ranges identify the evidence,
not timings.

| Stage | Actual dependency and work |
| --- | --- |
| Machine selection | `switchMachine` restores that machine's remembered URL; keyed `MachineContext` remounts `MachineApp`. A new client starts from `initialState`, seeded with that machine's model catalogs, not its former sidebar/transcript. Draft/question/catalog stores survive. The old client connection closes. [1] |
| Browser → main → peer | Browser opens `/peer/<id>/ws`. Main validates the request, opens `/ws/peer`, buffers the bounded prelude **until a valid registry frame**, then upgrades the browser and forwards original frames. Each visit opens a new upstream WebSocket; compression is disabled. This is a serial admission gate, not a separate HTTP health probe. [2] |
| Peer's initial list | `ClientDispatch` subscribes to hosts and the shared sidebar, forks their deliveries and requests background refresh. An existing sidebar observation is sent immediately; fresh Git discovery is **not normally on the warm-backend admission path**. Without any observation yet, discovery must produce one. Refresh rechecks both Git and history availability, independently/coalesced. [3] |
| Registry → restored selection | Navigation waits for `registryLoaded`, finds the saved session reference and sends `select(cwd, sessionId)`. Thus the initial list must reach and be processed by the browser before restored selection can travel back to the peer. Missing/deleted references become a missing-session view. Opening a row after the list loads has just the selection leg, not another handshake. [4] |
| Peer resolves selection | Under the session ownership lock, `SessionHosts.resolved` calls `SessionReferences.resolve` **before** looking up the live host. That resolves checkout aliases, verifies registration/archive state, and calls `history.locate`. Discovery enumerates each relevant session directory and stats candidate JSONL headers (16-way concurrency); stable header contents are cached, directory enumeration/stats are not. Even a running session pays this path. [5] |
| Running vs saved | A live host attaches to its snapshot/event stream, delivering `selected` on the snapshot before subsequent events. A saved session calls `history.peek` through the history worker, mirrors its name, and sends a saved snapshot. Merely opening saved history does not launch its Pi child; continuing with input is a distinct operation. [6] |
| Browser usable | Browser decodes the full frame, installs the snapshot and renders a window of transcript rows. It ACKs frames after handling them; the peer and gateway bound pending delivery. All history remains in memory. A small DOM does not remove serialization, transfer, decode or full-array projection costs. [7] |
| Parallel side work | Focus changes request `models` and `trust`; each connection asks again. Server model catalogs are cached until invalidation, with single-flight loading. Dispatch forks admitted request work, so a slow catalog probe is not a mandatory serial wait before `select`. Composer commands and restored Surface reads can add work/HTTP traffic; they are not the registry transport or the selected snapshot. [8] |

Cold **browser page load** additionally waits for Local's `listMachines` response to recognize a remote
URL; the ordinary Machine switch already has that list. Cold **peer process** means no sidebar/header/
worker/catalog caches; these are different experiments. A first visit to a warm peer can get its
existing sidebar immediately even though this browser has never seen it. [1–3,5,8]

### Cases that should not be averaged together

- **Repeat Machine visit:** same socket/admission/registry/select sequence, but warm backend caches,
  surviving drafts/catalogs and remembered location. Not a retained connection or transcript. [1]
- **Running session:** no new Pi startup, but file discovery still precedes host lookup. Background
  work continues while absent; restoration must reflect progress and dialogs, not old browser state. [5–6]
- **Saved session:** discovery plus a worker read/projection each time; worker jobs reuse in-flight
  work, not completed transcripts. A first worker startup differs from subsequent reads. [6]
- **Many sessions:** whole registry payload and filter/group/sort work remain; row mounting is
  windowed. Many histories in the selected directory affect `locate`, even if few are registered.
  Many directories also amplify background availability refresh. Do not equate sidebar count with
  transcript size or filesystem candidate count. [3,5,7]
- **Unavailable peer:** gateway connect/admission is bounded at 5 seconds, browser connecting at
  10 seconds; reconnect waits 2 seconds. A warm peer that cannot produce its first registry within
  the gateway deadline can look unavailable, not merely slow. Established liveness uses a 5-second
  ping interval and 8-second pong deadline. Oversized delivery is terminal rather than endlessly
  reconnecting. These are source constants, not measured failure latencies. [2,9]

## Evidence and honest quantitative bounds

This investigation read source and existing test/diagnostic contracts only. **No new latency samples,
network traces, production traffic, scratch runs or synthetic RTT runs were collected.** No real
Piano database/backend, credentials or model calls were used. This note therefore cannot identify
the dominant cost on the user's machines or claim live p50/p95 latency.

Existing evidence to reuse (tests inspected, not rerun):

- [`SidebarViewUpdates.test.ts:96–163,479–520,693–835`](https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/test/SidebarViewUpdates.test.ts#L96): late subscribers get the latest view; discovery coalesces; unchanged observations do not republish; freshness waits for availability; established-host prompts do not rescan history. These protect optimizations already present, not remote latency.
- [`PeerGateway.test.ts:887–1028`](https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/test/PeerGateway.test.ts#L887): unchanged relay, close meanings, admitted frame sizes and incompatible-peer refusal. Do not remove admission/bounds to make a benchmark faster.
- [`Machine.test.ts:88–277`](https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/test/Machine.test.ts#L88): qualified navigation, isolated same-ID drafts/catalogs and captured HTTP destination.
- [Session performance method](../session-performance.md) and [sidebar method](../testing.md#sidebar-sessions-benchmark), implemented in `test/browser/session-perf.mjs` and `test/performance-sidebar-sessions.mjs`: isolated fake-Pi, Vite development UI, headless Chromium, repeated opens, bounded DOM and render readiness. Neither method by itself measures a two-Piano Machine switch. The session document specifies methodology, not a numerical remote baseline.

For planning only, let **R** be an already-established browser → main → peer request/reply RTT,
**H** the new connection/admission interval, **L** reference lookup, **S** snapshot acquisition,
**B** delivered snapshot bytes, **V** effective transfer bytes/second and **D** browser decode/render.
Then after initial registry receipt, restored conversation readiness has roughly
`R + L + S + B/V + D` remaining (overlap and buffering can change the sum).

- Eliminating one dependency round trip could save approximately **R**: at assumed R=50/150/300 ms,
  roughly 50/150/300 ms. These are arithmetic scenarios, not observed results; RTT alone cannot
  quantify H (DNS/TLS/proxy/admission/server warmup).
- Cutting 1 MiB from a payload at an assumed 10 Mbit/s saves about **0.84 seconds** of serialization
  onto that link, before CPU effects. At 100 Mbit/s it is about 84 ms. Actual payload sizes,
  compression ratios and bandwidth are unmeasured.
- Avoiding selected-directory discovery saves its measured L component, not a fixed percentage.
  N candidates currently imply O(N) stats per spelling even on a header-cache hit. Filesystem
  locality and alias/shared-store layout determine whether this is negligible or material.

## Ranked opportunities

Ranked for a bounded next investigation, not a promised implementation schedule.

| Rank | Change to investigate | Defensible potential | Complexity / trade-off |
| --- | --- | --- | --- |
| 1 | Avoid history-file discovery when attaching a **validated, healthy existing host** | Removes enumeration/header stats from running-session restoration; no RTT saving. Largest likely benefit with many files/slow storage. | Medium. Split reference/checkout/alias validation from file location; keep ownership locking, archived/deleted rejection and dead/missing-checkout handling. Must not bypass conflict semantics accidentally. |
| 2 | Retain a bounded, machine-owned **read-only sidebar projection** across switches | Previous list can appear in the next render instead of waiting H plus registry transfer/decode. **Zero claimed improvement to current-list or composer readiness.** | Low–medium. Explicit stale/loading treatment; never set `registryLoaded` from it or enable mutations based on it. Clear removed machine IDs. No browser-persisted transcript needed. |
| 3 | Reduce full-snapshot/list bytes if traces show a bandwidth/CPU bottleneck | Saving is approximately removed bytes/V plus measured decode savings. | Medium–high. First measure redundant fields and image projection; compression costs CPU/memory and requires bounded decoded sizes. Pagination/incremental replay changes the snapshot contract and is not the first step. |
| 4 | Overlap remembered-session attachment with initial registry delivery | At most roughly one select RTT plus browser scheduling in the simple model; cannot eliminate snapshot work. | Medium–high. Peer must resolve a stable session ID authoritatively, not trust remembered cwd or stale browser membership. Keep pre-admission compatibility/security checks. New handshake semantics need careful stale-selection tests. |
| 5 | Keep idle peer attachments alive or preconnect | Could remove some H on repeat visits, but snapshot revalidation is still required. | High relative to benefit not yet measured: per-tab × per-peer subscriptions, heartbeats, retained memory, invalidation and shutdown. No justification yet for an always-connected fleet. |

Do not prioritize removing `models`/`trust` merely because they are visible in a trace: requests run
concurrently and catalog caching already exists. Measure probe CPU contention, response bytes and
composer prerequisites first. Similarly, background sidebar rescans are real load, but deferring
them does not normally remove a warm peer's initial-list wait. [3,8]

## Smallest first change and acceptance experiment

**Recommend a narrowly scoped healthy-live-host resolution fast path first**, conditional on a
baseline showing lookup cost. It improves authoritative conversation readiness without introducing
stale UI or changing transport. Keep saved-history resolution unchanged. In particular, establish whether re-detecting externally
introduced duplicate history files on every live attachment is a required contract; if so, skipping
that read is not semantics-preserving and this recommendation needs a narrower design or rejection.
If lookup is negligible, do not land extra complexity: use the read-only sidebar option for perceived repeat-visit latency,
or address the measured transport/payload bottleneck instead.

Before implementation, use the [verify-piano scratch workflow](../../.agents/skills/verify-piano/SKILL.md)
with two isolated fake-Pi Pianos and a controlled gateway. No live peers or model calls. Extend the
existing peer journey rather than inventing a production benchmark:

1. Instrument click, socket open, registry received, first sidebar window committed, `select` sent,
   selected snapshot received, and final visible transcript row + enabled composer + two animation
   frames. On the peer separately time reference validation, history enumeration and snapshot work;
   record bytes/frames/probe counts. Do not compare unsynchronized clocks across machines.
2. Test cold page/warm backend, cold backend, and repeat Machine switches; 1/100/1,000/5,000 history
   files in the selected directory; few vs many registered directories; running and saved sessions;
   short vs long transcripts. Include representative projects/closed groups, not only Today.
3. Run baseline/candidate interleaved at 0/50/150/300 ms added RTT, reporting **injected** delay,
   actual observed RTT, bandwidth, browser/build versions and revision. Use at least ten measured
   repeat visits per relevant case; report medians/ranges, not confident tail claims from tiny samples.
4. Fast-path acceptance: after warmup, healthy live selection performs **no history enumeration**, still
   supplies a fresh snapshot with progress made while away, and improves ready time by the removed
   lookup cost without a material regression in the small fixture. Preserve archive/delete refusal,
   checkout disappearance, aliases/conflicts, host exit/restart, and same IDs on different machines.
   Saved-session behavior must remain unchanged. Add only missing observable regression coverage.
5. Break the peer during selection and during input; verify bounded failure, reconnect to current
   state and **zero automatic input replay**. If evaluating cached sidebar separately, prove it is
   read-only and cannot authorize a stale session/action before the current registry/snapshot arrives.

Safety constraints: [INV-01/02/05/07/09/11/12](../development-invariants.md),
[ADR 0004](../adr/0004-same-owner-piano-peer.md), and [remote Piano](../remote-piano.md).
Pi remains history authority; switching detaches observers, not runs. Fresh selected snapshots and
ordered subsequent events remain mandatory. Browser memory is machine-qualified, never an authority;
no fallback to Local, no credential exposure, no bypass of peer admission, no prompt replay.

## Pinned source map

[1]: https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/web/src/components/MachineHost.tsx#L14-L69
[2]: https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/server/PeerGateway.ts#L132-L199
[3]: https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/server/ClientDispatch.ts#L581-L599
[4]: https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/web/src/lib/navigation.ts#L314-L333
[5]: https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/server/SessionHosts.ts#L255-L275
[6]: https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/server/ClientSessions.ts#L156-L278
[7]: https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/web/src/lib/ws.ts#L177-L205
[8]: https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/web/src/lib/client.ts#L153-L170
[9]: https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/web/src/lib/ws.ts#L100-L109

Supporting implementation for those stages:

- [App.tsx:51–97](https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/web/src/App.tsx#L51-L97), [machineStores.ts](https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/web/src/lib/machineStores.ts), [useClient.ts](https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/web/src/lib/useClient.ts): remount lifetime and retained stores.
- [SidebarView.ts:131–156,340–428](https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/server/SidebarView.ts#L340): bounded discovery concurrency, background refresh, latest subscription.
- [SessionReferences.ts:112–205](https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/server/SessionReferences.ts#L112), [PiHistory.ts:98–254](https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/server/PiHistory.ts#L98), [PiHistoryJobs.ts:1–97](https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/server/PiHistoryJobs.ts#L1): lookup, header cache and worker behavior.
- [SessionHosts.ts:557–575](https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/server/SessionHosts.ts#L557), [DirectoryFacts.ts:71–145](https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/server/DirectoryFacts.ts#L71), [WsClient.ts:99–101](https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/server/WsClient.ts#L99): saved read, catalogs and concurrent dispatch.
- [PeerGateway.ts:206–269,411–417](https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/server/PeerGateway.ts#L206), [SidebarSessionList.tsx:1–70](https://github.com/goofansu/piano/blob/0908b5696d1f2ba605c9b2149b814c97ce95aa1b/web/src/components/SidebarSessionList.tsx#L1): relay delivery bounds/admission order and windowed sidebar.
