# Measuring transcript performance

Use `PERF_SIZES` and `PERF_REPEATS` to narrow a run of `test/browser/session-perf.mjs`. Start each sample with a fresh browser and backend. The benchmark measures a synthetic conversation on a Vite development build. Its ready time indicates when the transcript is usable.

Compare heap usage after appending messages and forcing garbage collection. Report the maximum alongside the 95th percentile so an isolated visible stall is counted. The scripted scroll sweep behaves like dragging a scrollbar. Use `test/browser/transcript-scroll.mjs` to cover native wheel input.

[Performance benchmarks](performance.md)
