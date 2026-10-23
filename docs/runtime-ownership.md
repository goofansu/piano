# Runtime ownership behind PiSessions

PIN-11 follows the [transport failure audit](research/pin-10-transport-failures.md).
The public interface remains `PiSessions.open/probe/history` and a session's
`events/act/state/commands` plus `prepareRelease` (PIN-99: preview admission/cleanup before scope
release). Callers and behavioral tests do not import PiTransport.
Pi stays authoritative for history (INV-01); this is an internal refactor, not a
second session implementation or a new registry store.

## Owners

| Owner | State and obligations |
| --- | --- |
| `PiTransport` (internal) | One scoped process, bounded stdin/record queues and byte framing, request IDs/deferreds, capacity leases, pending/uncertain delivery, stdout/stderr/exit readers. `fail` settles callers and ends records before killing Pi. Scope cleanup closes stdin then kills after its deadline. |
| `PiSessions` publication (`SessionPublication`) | One generation per open, created by PiSessions. `SessionPublication` owns the snapshot, its one lock (held for projector correlation, snapshot fold, sequence assignment and subscriber attachment), sequence numbers, the cursor, subscribers, state merges and the closure announcement. State changes reach SessionReadbacks through its `onStateChange` listener. Publish never waits on a browser. A subscriber receives an atomic snapshot/cursor and then contiguous frames (INV-05). |
| `PiSessions` dialog lifecycle (`SessionDialogs`) | Open dialogs live in the snapshot. `SessionDialogs` sets each dialog's deadline (Pi's advertised timeout, or the earlier host recovery bound `PiDialogRecoveryMs`), publishes it and owns its deadline wakeup. Answer/cancel/abort/deadline/exit compete under the publication lock. Claim and publish before transport yields; no late acknowledgement or uncertain write reopens a claim (INV-04). |
| `PiSessions` actions/readbacks | Session scope owns admitted work, independent of the browser join. Operation/fact/output versions prevent old readbacks and abort acknowledgements from overwriting newer work. Abort does not clear queue; Stop restores queue first (INV-02/03). |
| `PreviewOwner` behind PiSessions (PIN-99) | One generation-local socket and serialized launch/idle/release admission. It fixes trusted workspace/session context and holds each supervisor runner’s connection. Transport exit disconnects immediately; Piano crash closes connections in the kernel. `prepareRelease(true)` reserves idle release only after confirmed absence, never on observation failure; explicit release cleans retained exact ownership or fails. See [ADR 0003](adr/0003-pi-owned-preview-lifetime.md). |
| `PiSessions` shutdown | Transport termination settles callers; record consumer completion signals `recordsDrained`. Only then announce closure once, resolving remaining dialog/submission uncertainty. The consumer finalizer signals completion but never waits on a later child finalizer. Scope release judges retained state and transport uncertainty, not already-interrupted action fibers. |
| `PiRecords` | Translates Pi payloads, readbacks and commands. One projection turns Pi's facts into every Snapshot, an open child's first one and a saved file's peek. Projector correlation is accessed under the publication lock; it does not own a process, deadline policy or fiber, or subscriber: a dialog leaves it as Pi's request (timeout, receipt time). |
| `PiHistory` (internal) | Saved sessions without a child, exposed as `PiSessions.history`: locate a file across checkout spellings, list a directory's session IDs, read a file's facts for PiRecords to project, and export its active branch. Never moves, merges or repairs history (INV-01). |
| `SessionReferences` | Where a session reference's Pi history is and whether it can be opened: the checkout spelling rule (registry, caller and physical spellings, with observed aliases remembered for the server's lifetime), resolution to the owning reference, Pi file, last known statistics and missing checkout, the sidebar's availability judged from the same observation, the saved view and branch export through `PiSessions.history`, archive and removal of Pi's file. Never starts Pi or takes an ownership lock (INV-01). |
| `SessionHost` | One running session from start to close: its child's scope, input admission under its key's lock (activity recorded first, checkout required, in-flight actions counted), the one busy rule idle release and branch export share, the registry mirror of Pi's name and statistics, and reporting its own exit to SessionHosts. Idle retirement additionally reserves preview release; close confirms preview cleanup before closing Pi’s scope. Explicit cleanup failure leaves the host retained for retry; Piano shutdown still ends Pi and logs the failure. |
| `SessionHosts` | Canonical checkout/session identity, keyed by the physical checkout SessionReferences returns, under one lock per key; creating or reusing a SessionHost, replacement/retirement, idle retirement and running-host announcements. Browser disconnect only releases its attachment, not this host's child (INV-02). |

The transport seam hides OS and RPC correlation details from session orchestration.
Its `observationVersion` counts **received**, not merely projected, output; context
readbacks must not overtake queued records. `hasPendingWork` includes uncertainty
left after caller timeout so retirement cannot infer false quiescence.

Publication, dialogs and readbacks share one atomicity boundary: SessionDialogs and
SessionReadbacks take the session's `SessionPublication` itself, its lock and gates included,
rather than a bag of functions, so the boundary has one owner and readback tests use the real
one. PiRecords is not split by size. These are explicit ownership choices, not deferred mechanical
file splitting.

## Publication mutation contract (PIN-28)

`SessionPublication.transaction(use)` supplies the only capability exposing `publish` and
`mergeState`. `apply` and `patchState` acquire the lock themselves; callers must not nest them
inside a transaction. The callback is evaluated after acquisition. The capability is internal,
nominally typed, and must be used inline, never retained or passed to forked work. TypeScript
has no linear lifetime types: this prevents casual unlocked calls, not deliberate capability
escape or casts. No new transport, wire or UI behavior is intended.

Lock-only call-site audit:

| Caller                                          | Lock ownership and mutation                                                                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PiSessions.onRecord`                           | One transaction covers projector correlation, state merge, projected events and `SessionDialogs.opened(transaction, request)`. Dialog watching/readbacks start afterward.          |
| `SessionDialogs.resolve`                        | A transaction checks/claims the dialog and publishes resolution/state; transport runs after release. A second transaction publishes delivery status/notice.                        |
| `SessionDialogs.resolveAll`                     | Individual claims use `resolve`; a final transaction merges pending delivery uncertainty on exit.                                                                                  |
| `SessionReadbacks.refreshContext`               | Pi is read outside the lock; a transaction rechecks freshness, replaces projector history and publishes context. Other readbacks use synchronized `patchState`.                    |
| `SessionPublication.apply/patchState/subscribe` | Private lock acquisition protects batch folding, state merging, or snapshot/cursor plus subscriber attachment. Private mutators never leave this module except via the capability. |
| `PiSessions.state`                              | A read-only transaction presents the snapshot consistently.                                                                                                                        |

Existing `DialogLifecycle`, `SessionDelivery` and `SessionReadbacks` tests protect INV-04/05
claim-before-transport, atomic attachment/sequence and stale-readback contracts. The compile-only
`test/SessionPublication.types.ts` additionally rejects direct mutation and unguarded dialog opening.

## Verification (historical PIN-11 refactor)

PIN-99 lifecycle evidence is [recorded separately](research/pin-99-preview-lifetime.md).

Based on `82b042c` plus this extraction, Node v24.21.0, installed dependencies unchanged:
`npm test` passed all 381 tests; `npm run typecheck` and `npm run lint` passed.
Outputs: `/tmp/piano-yej-evidence/11-{tests,types,lint}.log`.
Existing public-interface ordering, generation, dialog, cancellation, capacity and
shutdown tests were retained without rewrites; no new behavior or uncovered risk
justified an extra test. The preceding PIN-10 scratch browser evidence covers the
unchanged application journey; no additional browser run or real-model call was
made for this refactor. No migration or deployment.
