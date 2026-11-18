# Session page performance baseline

`PERF_SIZES` and `PERF_REPEATS` narrow a run of `test/browser/session-perf.mjs`.

## Boundary and method

INV-09: this proves a bounded synthetic workload on a development Vite build, not real-model
latency or production/mobile performance. Ready ms is a usable-transcript proxy, not TTI. Compare
the forced-GC heap after append, not the pre-scroll heap. Read max beside p95: one visible stall
can vanish from p95. Each sample needs a fresh browser and backend; do not mix in shared-browser
numbers.
