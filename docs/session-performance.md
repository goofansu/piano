# Session page performance baseline

Ownership and correctness checks: [Transcript rendering and scrolling](transcript.md).

`PERF_SIZES` and `PERF_REPEATS` narrow a run of `test/browser/session-perf.mjs`.

## Boundary and method

INV-09: this proves a bounded synthetic workload on a development Vite build, not real-model
latency or production/mobile performance. Ready ms is a usable-transcript proxy, not TTI. Compare
the forced-GC heap after append, not the pre-scroll heap. Read max beside p95: one visible stall
can vanish from p95. Each sample needs a fresh browser and backend; do not mix in shared-browser
numbers.

The scroll sweep sets `scrollTop` from script, as a scrollbar drag does, so its rows take the
deferred placeholder path. Scrolling driven by wheel, touch or keys renders rows entering view before
paint while `web/src/features/transcript/scrollRenderBudget.ts` allows it; the sweep does not measure that path.
`test/browser/transcript-scroll.mjs` covers it with native wheel input.
