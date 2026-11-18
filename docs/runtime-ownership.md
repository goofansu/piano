# Runtime ownership behind PiSessions

Publication, dialogs and readbacks share one atomicity boundary: SessionDialogs and
SessionReadbacks take the session's `SessionPublication` itself, its lock and gates included,
rather than a bag of functions, so the boundary has one owner and readback tests use the real
one. PiRecords is not split by size. These are explicit ownership choices, not deferred mechanical
file splitting.

## Saved-history SDK compatibility

`PiHistoryFile` loads Pi's shipped `dist/core/session-manager.js` relative to its resolved public
entry point. In Pi 1.5.2, the public root re-exports that same parser and `SessionManager`, but
also initializes interactive/runtime modules unnecessary in `PiHistoryWorker`. Pi still parses,
migrates in memory, and selects context/compaction/branches; Piano adds no parser or history cache.
Other server modules still load the full SDK: this is a cold history-worker optimization, not a
claim about daemon startup. `fileVersion` stays in the same small internal module.

This path is **not a public export** and is an explicit upgrade cost (INV-12). A missing module
or missing parser/`inMemory` export falls back to the public SDK. Missing transitive dependencies,
module initialization failures, and history parsing/projection errors do not trigger fallback;
the existing unreadable-history/recovery policy remains in force. No installed Pi files change.

On each Pi upgrade, check the root's re-exports and package layout; prefer a public history subpath
when available. Run `HistorySdkCompatibility.test.ts` (real worker and installed Pi, with module
availability faults), `SessionHistory.test.ts`, and the production scratch open/continue journey.
Recheck cold-worker latency and memory: fallback preserves behavior but can lose the optimization.
These checks protect the supported semantics, not arbitrary future SDK releases (INV-01/12).

### Developer navigation: session creation and recovery

Start at `create` in `server/SessionHosts.ts`; `shared/creationVerdict.ts` reads the answer.

## Publication mutation contract (PIN-28)

`SessionPublication.transaction(use)` supplies the only capability exposing `publish` and
`mergeState`. `apply` and `patchState` acquire the lock themselves; callers must not nest them
inside a transaction. The callback is evaluated after acquisition. The capability is internal,
nominally typed, and must be used inline, never retained or passed to forked work. TypeScript
has no linear lifetime types: this prevents casual unlocked calls, not deliberate capability
escape or casts. No new transport, wire or UI behavior is intended.

Existing `DialogLifecycle`, `SessionDelivery` and `SessionReadbacks` tests protect INV-04/05
claim-before-transport, atomic attachment/sequence and stale-readback contracts. The compile-only
`test/SessionPublication.types.ts` additionally rejects direct mutation and unguarded dialog opening.

## Transport failure policy (PIN-10)

Contracts: INV-02/03/04/05/11. Pi RPC record validation is in the
[PIN-7 failure policy](research/2026-10-12-pi-rpc-failures.md).

| Boundary | Recovery policy |
| --- | --- |
| Pi stdout framing, JSON/envelope, record capacity, reader failure or premature EOF | Fail the session, settle pending requests/writes, end queues, kill the unusable child. No replay. |
| Pi stdin sink failure | Use the same terminal failure path, after failing writes/requests as transport-uncertain. Raw cause text is not delivered. |
| Pi record consumer | Unexpected processing failure terminates the child and publishes closure after the consumer signals completion. Scope interruption is ordinary shutdown, not failure. |
| Pi exit observation | Unexpected failure terminates the child with a fixed diagnostic; ordinary scope interruption is not a crash. |
| Pi stderr reader | Continue RPC, with one server warning that exit diagnostics may be incomplete. Stderr is diagnostic-only; do not expose raw reader causes. |
| Kill after failure / shutdown | Best-effort kill errors remain suppressed: terminal state is already settled, and the scoped process resource still owns cleanup. Do not replace the original failure with a kill race. |
| RPC acknowledgement / write deadline | Report uncertain delivery, retain uncertainty for retirement, never retry a mutation. A refusal before any byte is queued (full capacity, closed input, an exited Pi) is `not_sent`, not uncertain: the prompt's submission receipt says so and the composer gives the draft back. |
| Dialog deadline / abort cancellation | `resolveDialog` claims once and publishes written/uncertain/not-sent before returning its typed failure. Timer/abort callers suppress that already-reported error to continue resolving other dialogs. Exit resolution sends nothing. |
| Usage/context/state readbacks | Continue with retained values and existing refresh-error state. Obsolete observations cannot overwrite newer operations. Optional run-ledger reads retain last usage on failure; cursor reset retries only a read, never a mutation. |
| Remote image preparation | Failed/cancelled uploads start no Pi work and restore the machine-owned draft. A consumed reference stays unavailable to replay; only proven not-sent receipts restore input. Socket teardown cannot free a started operation's preparation slot before settlement. Lost unclaimed results expire; peer restart forgets them. |
| Socket reader | Peer close and scope interruption end the client scope normally. Unexpected read/dispatch failure sends 1011 with reconnect guidance. Session-owned Pi work survives; reconnect is snapshot-only. |
| Socket close write | Best effort: a dead peer cannot receive its close reason. Client scope still closes. No resend. |
| Bounded socket delivery | Overflow/encoding/write failure or missing ack resolves the first close reason. 1009 means oversized view; 1013 means reconnect for a snapshot. Writer failure never retries frames. |
| Client session attachment | DeliveryOverflow closes the socket via output. Stream completion detaches and releases readiness; next action may reopen an exited session. The trailing `Effect.ignore` has no remaining typed error after overflow handling (it does not catch defects). |
| Client catalog/host/sidebar subscriptions | Their streams/send have no typed failures; trailing `Effect.ignore` is redundant, not a hidden transport recovery policy. Actual socket writes belong to bounded delivery above. |
| SessionHosts observer | Retry snapshot subscription on delivery overflow so exit ownership is not lost. This retries observation only; cached-state persistence failures are already warned, not retried as user mutations. |
| Registry committed-write listeners | Keep catch-and-warn: SQL/config commit already succeeded. Failing the caller would falsely imply rollback and encourage duplicate mutation. |
| Generic subprocess group kill | Suppress already-exited process/group races; completion/timeout/abort still settles the original command. |

No permanent UI warning reports these failures. Failure text appears only when the corresponding
session or connection fails, and no raw transport cause is copied into a diagnostic.
