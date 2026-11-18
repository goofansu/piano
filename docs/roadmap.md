## 1. Runtime correctness

- Preserve the deliberate exact Pi 1.0.2 package/lockfile upgrade, recorded in the
  [October 4 report](research/2026-10-04-pi-update-effort.md). Complete the remaining compatibility
  checks, including project MCP overrides and dialog/abort behavior. Inspect RPC/extension UI changes
  against the tagged docs; the completed dependency upgrade is not full runtime-milestone acceptance.
- Surface prompt disposition; distinguish settled, queued, waiting, compacting, retrying and exited.
- Atomically claim dialogs, propagate cancellation on abort, expose deadlines and prevent late
  acknowledgements from changing a newer operation.
- Reconcile authoritative message endings, selected versus physically routed model, usage and
  nested tool calls where the current translation drops them.
- Validate the supported Worktrunk version/schema/output behind a narrow adapter and preserve
  unknown/error states; allow direct Git inspection for exact revision capture.
- Add event sequence + host generation, snapshot/live ordering, slow-client handling and consistent
  redaction. Keep reconnect snapshot based; defer historical replay.

**Exit:** short browser roundtrip on 1.0.2 plus fake-Pi scenarios for handled prompt, immediate
completion, two-tab dialog races, timeout, abort, refresh, interrupted commands and child exit.
No automatic resubmission on reconnect. Run the baseline, `npm run verify`.
Covers INV-01–06 and INV-11–12.
