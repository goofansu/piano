# Phase 5 — Ordered, bounded current views

Date: 2026-10-05. Implements the [Phase 5 slice](../vertical-slice-plan.md#phase-5--reconnectswitch-into-an-ordered-bounded-current-view).
**INV-01–05, INV-11**. This is not completion of the runtime milestone; Phase 6 remains open.

## Claim and implementation

Attaching, reconnecting and selecting another session cannot apply older frames over the current
snapshot or relabel another session's output. Slow browser consumers cannot stall Pi or retain an
unbounded delivery backlog. Reconnect requests a snapshot, never resubmits a prompt.

- `PiSessions.events` attaches atomically with a cursor: registered cwd/session identity, random child
  generation and monotonically increasing sequence. Partial-message/tool assembly now happens under
  the same lock as snapshot capture and event publication. Snapshots retain partial output, tools,
  dialogs/deadlines and extension state. Both live frames and snapshots use display redaction.
- Browser selections have fresh correlation IDs, including reconnect/resync and session creation.
  The server claims them in receive order, rejects stale actions and suppresses superseded lookup
  results. The browser rejects old selections, wrong identities and duplicate sequences; gaps and
  generation changes request a fresh snapshot. Notifications obey the same acceptance rule.
  Socket delivery IDs also protect caller-only results against duplication and reconnect on a gap.
- `BoundedDelivery` is a nonblocking mailbox shared by session subscriptions and socket delivery.
  Each queue permits **256 frames / 8 MiB of serialized content**. Overflow fails explicitly instead
  of silently dropping session facts or backpressuring Pi. The internal host observer resnapshots too.
- WebSocket delivery has a separate cumulative acknowledgement window: **32 frames / 8 MiB in flight**,
  a **10-second acknowledgement deadline**, and one staging frame of at most 8 MiB. This is needed
  because the installed socket adapter's `ws.send` does not await network drainage. Queue/window
  limits bound delivery retention, not total process heap or Pi's authoritative context size.
  Host/project sidebar broadcasts coalesce to their latest complete projection.
- Backlog/ack failure closes the socket with **1013**; the browser explains possible missed live
  notices and reconnects. A single oversized view closes with **1009**, reports the limit and stops
  automatic reconnect to avoid a permanent retry loop. Historical notice replay is not provided.

Registry and Pi history formats are unchanged. The browser/server wire changes together: old clients
without selection IDs and delivery acknowledgements are not supported by the new backend.

## Retained verification

Local packet: `/tmp/piano-phase5-evidence/` (outside the registry). Committed tests and the scratch
browser script reproduce the checks; screenshots and full command output remain machine-local.

| Check | Observed result | Output |
| --- | --- | --- |
| PiSessions ordered attachment | Contiguous same-generation frames; current partial/tool/dialog/status snapshot; redacted live and snapshot canaries; concurrent attach/mutation; reopened child has a new generation. | `test/SessionDelivery.test.ts`, `tests.log` |
| Held subscriber | One subscriber held at its snapshot over 600 fixture updates fails `DeliveryOverflow`; fast subscriber receives contiguous frames, Pi remains responsive, reattachment captures `burst 600`. | `tests.log` |
| Byte budget | Both a single oversized frame and a retained backlog fail explicitly, without producer blocking or a falsely successful drain. | `tests.log` |
| Browser reducer faults | Late A→B selections, wrong-session frames, duplicate endings, older snapshots, gaps, changed generations and returning to New cannot overwrite current state. | `test/Store.test.ts`, `tests.log` |
| Scratch browser/public routing | Reload mid-partial/tool and dialog; unchanged dialog deadline; duplicate final frame renders once; dropped frame triggers resnapshot with no extra prompt; delayed public A lookup cannot replace B; stale action is rejected before Pi. | `browser-final/result.json`, `browser-commands.json`, snapshots/screenshots |
| Two tabs / exit and restart | 600 paced updates (10 ms fixture interval): fast tab continues, paused tab is closed with 1013. After child exit and explicit restart, the returning tab receives the replacement generation and partial message without sending a prompt or spawning another child. | `browser-final/host-audit.jsonl`, `slow-tab-resnapshot-after-exit-restart.*` |
| Required gates | **45 tests passed**, including existing locked-Pi compatibility tests. Server/web typechecks and `git diff --check` passed. | `tests.log`, `typecheck.log` |

Earlier attempts are retained rather than counted as passes. One test incorrectly assumed that the
first captured sequence must be zero; startup usage refresh can already have published a fact. Its
assertion now checks independent generation/reset, not incidental startup scheduling. Browser attempts
1–4 corrected fixture status/selector/toast synchronization. Attempt 5 exposed an overly restrictive
one-frame stop-and-wait transport under a 3 ms update burst. Delivery now uses a bounded pipelined
ack window; the final browser gate uses a 10 ms producer interval, while the module's fast-subscriber
check retains the 3 ms interval. This does not promise lossless delivery at arbitrary producer rates:
overloaded consumers explicitly reconnect, and transient notices may be lost. Final self-review
also replaced batched queue pulls with single-frame pulls to keep only one staging frame outside
the accounted queue, serialized archive/delete detachment with attachment, and added socket-level
deduplication for caller-only results. The final browser run and full suite passed after those changes.

### Tested inputs and environment

- Base: `e89e7a6dacc5174cacb1e0dc66bbee519371487d`, plus the implementation in this commit.
- `revision.json` records per-file SHA-256 hashes, requirement digest, environment and command outcomes.
  Implementation/fixture manifest digest: `b4eb0bbcb99b8650821e47b8c0dbc1ed225f05756879845f667d315ba99ce426`.
  `implementation.patch` retains tracked edits; `added-inputs/` retains new source/test files.
  Documentation is outside this implementation digest. The final module and browser checks cover
  the same implementation inputs.
- Node **24.21.0**, Effect/platform-node **4.0.0-rc.118**, locked/installed Pi **1.0.2**,
  Worktrunk **0.80.0** (version observation only), agent-browser **0.38.2**.
- Browser Pi override: `test/fake-host-pi.mjs`, `--mode rpc`, explicit audit path,
  `--hold-session delayed --burst-delay 10`. Exact scratch paths/arguments are in
  `browser-final/environment.json`. No paid model calls.
- Only scratch Git/registry/HOME/agent/session directories and loopback **7171/7172** were used.
  Only owned PIDs were stopped; fixture children were confirmed exited before scratch storage removal.
  No worktrees or production Pi session files were created.
- Self-review covered snapshot/assembly locking, selection admission, stale notifications, subscription
  cleanup, byte/count bounds, ack deadlines and generation replacement. No independent review claim.

## Limits and operations

No replay database, durable exit diagnostics, cross-backend writer exclusion, new authentication or
credential containment. Backend restarts recover Pi history, not interrupted shell execution. A
single view above the delivery limit requires reducing context outside this connection before reload.
The byte-limit browser error and real network/background-phone behavior were not separately observed;
byte rejection is module-tested, and browser backpressure was injected at the receive/ack boundary.
Existing startup/custom-extension UI limitations remain; Phase 6 Worktrunk compatibility is still open.

**Deployment:** not requested or performed. No production build was run. Activation requires a UI
build, restart of **`piano.service`**, and browser reload together for the changed wire protocol.
No dependency install or proxy/socket restart is needed. The user's running services and registry
were left untouched.
