# Runtime ownership behind PiSessions

YEJ-11 follows the [transport failure audit](research/yej-10-transport-failures.md).
The public interface remains `PiSessions.open/probe` and a session's
`events/act/state`. Callers and behavioral tests do not import PiTransport.
Pi stays authoritative for history (INV-01); this is an internal refactor, not a
second session implementation or a new registry store.

## Owners

| Owner | State and obligations |
| --- | --- |
| `PiTransport` (internal) | One scoped process, bounded stdin/record queues and byte framing, request IDs/deferreds, capacity leases, pending/uncertain delivery, stdout/stderr/exit readers. `fail` settles callers and ends records before killing Pi. Scope cleanup closes stdin then kills after its deadline. |
| `PiSessions` publication | One generation per open; one lock for projector correlation, snapshot fold, sequence assignment and subscriber attachment. Publish never waits on a browser. A subscriber receives an atomic snapshot/cursor and then contiguous frames (INV-05). |
| `PiSessions` dialog lifecycle | Open dialogs live in the snapshot; deadline wakeups live in `dialogClosed`. Answer/cancel/abort/deadline/exit compete under the publication lock. Claim and publish before transport yields; no late acknowledgement or uncertain write reopens a claim (INV-04). |
| `PiSessions` actions/readbacks | Session scope owns admitted work, independent of the browser join. Operation/fact/output versions prevent old readbacks and abort acknowledgements from overwriting newer work. Abort does not clear queue; Stop restores queue first (INV-02/03). |
| `PiSessions` shutdown | Transport termination settles callers; record consumer completion signals `recordsDrained`. Only then announce closure once, resolving remaining dialog/submission uncertainty. The consumer finalizer signals completion but never waits on a later child finalizer. Scope release judges retained state and transport uncertainty, not already-interrupted action fibers. |
| `PiRecords` | Translates Pi payloads, readbacks and commands. Projector correlation is accessed under the publication lock; it does not own a process, deadline fiber or subscriber. |
| `Subagents` | The pi-subagent extension contract: subagent cards from tool and notification `details`, and the `RunLedger` that folds raw session entries into a compact per-Run spend record. PiRecords asks it about subagent payloads. |
| `SessionReferences` | Where a session reference's Pi history is and whether it can be opened: the checkout spelling rule (registry, caller and physical spellings, with observed aliases remembered for the server's lifetime), resolution to the owning reference, Pi file, last known statistics and missing checkout, the sidebar's availability judged from the same observation, the saved view, branch export, archive and removal of Pi's file. Never starts Pi or takes an ownership lock (INV-01). |
| `SessionHost` | One running session from start to close: its child's scope, input admission under its key's lock (activity recorded first, checkout required, in-flight actions counted), the one busy rule idle release and branch export share, the registry mirror of Pi's name and statistics, and reporting its own exit to SessionHosts. |
| `SessionHosts` | Canonical checkout/session identity, keyed by the physical checkout SessionReferences returns, under one lock per key; creating or reusing a SessionHost, replacement/retirement, idle retirement and running-host announcements. Browser disconnect only releases its attachment, not this host's child (INV-02). |

The transport seam hides OS and RPC correlation details from session orchestration.
Its `observationVersion` counts **received**, not merely projected, output; context
readbacks must not overtake queued records. `hasPendingWork` includes uncertainty
left after caller timeout so retirement cannot infer false quiescence.

Dialog and publication code deliberately remain together. Extracting them now would
require passing the snapshot lock, publish functions, generation and shutdown gates
back and forth, making their shared atomicity harder to see. PiRecords likewise is
not split by size; `Subagents` is a split by concept (the pi-subagent extension contract versus
the Pi RPC protocol), so the run ledger reads Pi entries without serializing a transcript. These are explicit ownership choices, not deferred mechanical
file splitting.

## Verification

Based on `82b042c` plus this extraction, Node v24.21.0, installed dependencies unchanged:
`npm test` passed all 381 tests; `npm run typecheck` and `npm run lint` passed.
Outputs: `/tmp/piano-yej-evidence/11-{tests,types,lint}.log`.
Existing public-interface ordering, generation, dialog, cancellation, capacity and
shutdown tests were retained without rewrites; no new behavior or uncovered risk
justified an extra test. The preceding YEJ-10 scratch browser evidence covers the
unchanged application journey; no additional browser run or real-model call was
made for this refactor. No migration or deployment.
