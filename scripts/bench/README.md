# New-session startup benchmark

```sh
node scripts/bench/start-session.mjs /tmp/piano-start-real
BENCH_FAKE=1 node scripts/bench/start-session.mjs /tmp/piano-start-fake
NODE_DISABLE_COMPILE_CACHE=1 node scripts/bench/start-session.mjs /tmp/piano-start-no-cache
```

Requires the ordinary browser-test prerequisites. Runs one isolated scratch backend and browser,
then tears them down using `test/browser/harness.mjs`. Never targets a running Piano. Defaults to
10 sequential new sessions; set `BENCH_SAMPLES` to change that. Run benchmarks serially, without
concurrent tests/builds. Compare distributions, not a wall-clock test threshold.

To compare a historical bootstrap, use a dedicated benchmark worktree with this benchmark and
its `PiTransport` timestamp instrumentation applied identically to both revisions. Change only
`features/sessions/server/pi/PiRpcCli.ts` between runs. Do not set `NODE_COMPILE_CACHE` externally as a baseline control:
Node enables its cache automatically when that variable is set (even to an empty string).
The benchmark explicitly removes it from the backend environment. `NODE_DISABLE_COMPILE_CACHE=1`
is a supported ablation/fallback check, not a reproduction of the historical static import.
