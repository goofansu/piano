# Runtime ownership behind PiSessions

PIN-11 follows the [transport failure policy](#transport-failure-policy-pin-10).
The public interface remains `PiSessions.open/probe/history` and a session's
`events/act/state/commands` plus `prepareRelease` (PIN-99: preview admission/cleanup before scope
release). Callers and behavioral tests do not import PiTransport.
Pi stays authoritative for history (INV-01); this is an internal refactor, not a
second session implementation or a new registry store.

## Owners

| Owner | State and obligations |
| --- | --- |
| `PreparedImages` / `PeerImages` | Peer-owned ephemeral raster preparations, registered target validation and one-use references. Two slots cover ingestion through consumed-operation settlement; TTL/cancellation applies only before consumption. No filesystem staging, registry bytes or durable history. ClientDispatch resolves references before starting/creating, then passes ordinary image actions through PiSessions. |
| `PeerImageGateway` / `ImageTransfer` | Main's fixed HTTP image routes: immutable configured destination/credentials, actual-byte bounds, backpressure, cancellation and independent concurrency/deadlines. No conversation frame rewriting, upload retry, Local fallback or Pi protocol. |
| `ImagePreviews` / `ClientSessions` | Disposable content-hash bytes; ClientSessions binds projected transcript hashes to their observed session before delivery. Peer reads require registered session membership and that provenance. Cache eviction drops metadata with bytes; reselecting/reopening can reproject history. |
| `PiTransport` (internal) | One scoped process, bounded stdin/record queues and byte framing, request IDs/deferreds, capacity leases, pending/uncertain delivery, stdout/stderr/exit readers. `fail` settles callers and ends records before killing Pi. Scope cleanup closes stdin then kills after its deadline. |
| `PiSessions` publication (`SessionPublication`) | One generation per open, created by PiSessions. `SessionPublication` owns the snapshot, its one lock (held for projector correlation, snapshot fold, sequence assignment and subscriber attachment), sequence numbers, the cursor, subscribers, state merges and the closure announcement. State changes reach SessionReadbacks through its `onStateChange` listener. Publish never waits on a browser. A subscriber receives an atomic snapshot/cursor and then contiguous frames (INV-05). |
| `PiSessions` dialog lifecycle (`SessionDialogs`) | Open dialogs live in the snapshot. An ordinary extension dialog has a deadline (Pi's advertised timeout, or the earlier host recovery bound `PiDialogRecoveryMs`). A dialog its tool call owns (Piano's `ask_user`) has none: that call's end closes it and its stored result confirms the answer. Answer/cancel/abort/deadline/tool end/exit compete under the publication lock. Claim and publish before transport yields; no late acknowledgement or uncertain write reopens a claim (INV-04). |
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

Admission retains byte counts, not serialized image-payload strings (`InputBytes`). PiTransport
creates one final newline-terminated stdin byte buffer; queued bytes keep their lease through
uncertain writes until accepted or closed. Stdout framing reuses buffers up to 1 MiB; larger
buffers get a one-second reuse window after a large line, not renewed by small records. Expiry
releases empty storage, never an unfinished line; completion of that line schedules release
again. This avoids repeating the geometric allocation/copy ladder during image/history bursts.
Reader completion/failure/cancellation clears the timer and releases the remainder. This storage is distinct
from Pi-owned history and the disposable image-preview cache; neither policy changes. See
[runtime input limits](runtime-input-limits.md).

Process exit stops input and disconnects preview ownership immediately, but is not stdout EOF.
The transport allows one second after exit for stdout framing and response correlation to finish,
then ends the record queue without dropping accepted records. PiSessions drains those records
before publishing closure. A truncated record or a drain deadline (including a descendant holding
stdout open) produces a terminal failure, not a clean exit; missing acknowledgements remain
uncertain and mutations are never replayed (PIN-111, INV-02/03/05).

Publication, dialogs and readbacks share one atomicity boundary: SessionDialogs and
SessionReadbacks take the session's `SessionPublication` itself, its lock and gates included,
rather than a bag of functions, so the boundary has one owner and readback tests use the real
one. PiRecords is not split by size. These are explicit ownership choices, not deferred mechanical
file splitting.

## Failed creation and reconnect

A `create_session` claims its durable `attemptId` before checkout creation, session registration
or Pi startup. Older clients use their creation's `selectionId` as that identity. The claim stores
only a request digest, the server-generated session identity, destination and startup outcome in
Piano's database: no prompt, attachments or competing transcript. Claims are retained after session
removal, including confirmed failures; they are not an expiring retry queue.

Only the original claim can create and send the first input, after its attachment completes.
Duplicates observe that attempt, even after a server restart; changed input under the same identity
is refused without replay. `select` with `attemptId` reads the original outcome (waiting for a
currently owned startup), never starts Pi or resends input. Browser and dispatch reconnect use that
read when the session ID was not received. Missed dispatch observations remain unattributable.
Navigation still belongs to `selectionId`, so a slow reconciliation cannot replace a newer selection.

While acquiring Pi, the sidebar shows **Starting**. On startup failure, SessionHosts removes only
the fresh reference, under its ownership lock, when PiSessions observed OS exit after scope closure
and strict history inspection conclusively found no file. An unreadable store/header, saved history,
or unconfirmed teardown preserves the reference. A title or ordinary sidebar availability is never
deletion evidence. Worktrees are always kept. Confirmed failure returns the first input to the New
session draft with its options and attachments, with **Retry** (a new attempt) and **Dismiss**.
An uncertain outcome offers **Check start**. No legacy sessions are migrated or cleaned up.

Creation claims survive restart; drafts remain browser-memory state, as other drafts do. Reloading
or closing the tab does not persist attachment bytes or automatically retry an abandoned attempt.
The caller must retain the attempt identity to reconcile an unnamed start after losing that memory.

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

## Questions owned by a tool call

Piano's `ask_user` extension asks through Pi's ordinary dialogs and returns the batch as its tool
result; it has no Piano-specific protocol. The server reads two native facts from Pi's one stdout
stream: a dialog requested while Piano's `ask_user` call is the only running tool, and matching
the call's next question, belongs to that call (`Dialog.toolCallId`, `Dialog.questionId`), and the
call's `tool_execution_end` record carries the result Pi stores. The tool asks its questions in
order, one dialog at a time, each as `askUserPrompt` builds it: `select` with the question's
choices, else `editor`, titled `2 of 3: …` in a batch. Any other dialog opened meanwhile, such as
another extension's command sent from the composer or a tool hook's dialog, has no owner and does
not move the call to its next question. `shared/askUser.ts` is the only place that interprets the
call's arguments, dialogs and result, for the extension, the server's receipts and the browser's
transcript.

An owned dialog has no deadline. A successful write is **written**, not accepted: the next question
of the batch, or the call's end with the answer stored under its question's ID, makes it
**accepted**; an end without it, even with the same text stored for another question, makes it
**rejected** with the answer kept in the live receipt. The call's end also closes a question
nobody answered, and an answer arriving after that closure is kept as rejected
without being sent. Pi's exit leaves a written answer uncertain; a response the transport refused
before queuing any bytes (Pi already exited, input full) is **not sent**, with the answer kept.
Nothing is retried or resent. The next run Pi starts retires a receipt with nothing left to report
(accepted, not sent without an answer, or written for an ordinary dialog), so an earlier run's
ending never sits under a later one; a pending, uncertain or rejected receipt, an unsent answer,
or a written answer awaiting its call, stays. Such a receipt also outlasts another dialog's
closure that carries no answer, such as Stop cancelling it or Pi's exit: that dialog leaves the
queue, but its own status line is not shown, so the receipt still reporting (and an owned
answer's later verdict) is not lost. This
is not durable draft storage across a Piano restart; Pi still owns persisted tool results. When
several tools run at once, a dialog gets no owner and keeps the recovery policy, as third-party
dialogs always do.

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

## Verification (historical PIN-11 refactor)

Based on `82b042c` plus this extraction, Node v24.21.0, installed dependencies unchanged:
`npm test` passed all 381 tests; `npm run typecheck` and `npm run lint` passed.
Outputs: `/tmp/piano-yej-evidence/11-{tests,types,lint}.log`.
Existing public-interface ordering, generation, dialog, cancellation, capacity and
shutdown tests were retained without rewrites; no new behavior or uncovered risk
justified an extra test. The preceding PIN-10 scratch browser evidence covers the
unchanged application journey; no additional browser run or real-model call was
made for this refactor. No migration or deployment.
