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

The default uses the locked **real Pi** through `server/PiRpcCli.ts`, Piano's normal extension
arguments, scratch HOME/settings/history/database, and an OpenAI-compatible loopback scripted
provider. No developer credentials or paid model calls. Every prompt is `Reply with exactly:
BENCH_OK`; the journey waits for the assistant's exact reply, not just the echoed user prompt.
It checks that dispatch, ask-user and library tools reached the provider. Preview/Radius require
configuration this fixture intentionally does not supply. This is an **offline runtime** benchmark:
network catalog refresh, user packages/MCP configuration and actual provider latency are excluded.
The fake mode measures Piano/browser overhead, not Pi startup, and bypasses the optimized CLI.

## Boundaries and output

- `samples.json`: capture-phase Send click → first browser `state.isStreaming`; browser
  `WebSocket.send(create_session)` → that state, using `performance.now()`.
- `benchmark.json`: revision, tracked-diff hash, benchmark hash, Node/Pi versions, raw stage
  samples and min/median/p90/max. The primary endpoint is Piano's transport observing Pi's
  **`agent_start`** record, not a successful prompt response. This measures observation of Pi
  starting the agent, not first model token or the provider accepting a request.
- Stages: socket send → spawn requested → first authoritative `get_state` response → prompt
  request → `agent_start` → browser streaming state. These use millisecond wall timestamps in
  `PIANO_DEBUG` logs and the browser on the same host; cross-process stages have clock/resolution
  uncertainty. `PiRecords` projects `agent_start` to `isStreaming: true`, but subsequent readbacks
  and browser publication can delay observation. Keep the two endpoints separate.
- `coldProbeReadyMs`: the initial composer's separate model-catalog probe, measured from spawn
  request to `get_available_models` response. It is **not** a user session or part of Send latency.
  Each run starts with its own empty Node compilation-cache directory (under its scratch TMPDIR).
  That probe may warm compilation before the measured new sessions; all measured sessions are
  still new OS processes. This does not claim filesystem/page-cache coldness.
- The harness retains process logs and provenance in the evidence directory, outside cleanup.
  Protocol debug output adds timestamps and response command names, not message/provider content.

To compare a historical bootstrap, use a dedicated benchmark worktree with this benchmark and
its `PiTransport` timestamp instrumentation applied identically to both revisions. Change only
`server/PiRpcCli.ts` between runs. Do not set `NODE_COMPILE_CACHE` externally as a baseline control:
Node enables its cache automatically when that variable is set (even to an empty string).
The benchmark explicitly removes it from the backend environment. `NODE_DISABLE_COMPILE_CACHE=1`
is a supported ablation/fallback check, not a reproduction of the historical static import.

Do not interpret this harness as a latency SLA. Retain raw samples and exact revisions with PR
evidence; benchmark results belong outside the repository. Ordinary `npm test` and the critical
start/open browser journeys remain the correctness gates.
