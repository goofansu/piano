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

## Failed creation and reconnect

For implementation work on starting a session and recovering a failed or uncertain start, begin at
[Developer navigation: session creation and recovery](#developer-navigation-session-creation-and-recovery).

A `create_session` claims its durable `attemptId` before checkout creation, session registration
or Pi startup. A client that sends no `attemptId` makes no claim: its creation runs once and cannot
be reconciled, because a `selectionId` lives only as long as its connection. The claim stores
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
(or no child was ever spawned) and strict history inspection conclusively found no file. A done
project that the start reopened gets its done mark back, unless it took another session since. An unreadable store/header, saved history,
or unconfirmed teardown preserves the reference. A title or ordinary sidebar availability is never
deletion evidence. Worktrees are always kept. Confirmed failure returns the first input to the New
session draft with its options and attachments, with **Retry** (a new attempt) and **Dismiss**.
A first input refused after its session was created returns to that session's draft instead, so
sending it again cannot start a second session. A failure that arrives after the person moved to
another session is announced with a toast. An uncertain outcome offers **Check start**. No legacy sessions are migrated or cleaned up.

Creation claims survive restart; drafts remain browser-memory state, as other drafts do. Reloading
or closing the tab does not persist attachment bytes or automatically retry an abandoned attempt.
The caller must retain the attempt identity to reconcile an unnamed start after losing that memory.

### Developer navigation: session creation and recovery

This is the starting place for starting a session from the New page, a project home or dispatch,
and for what the user sees when the start is refused, fails or stays uncertain. It spans the
modules below, not one feature module. Preserve `web → shared ← server`: the browser decides
where it offers to start and keeps the draft; `shared/creationVerdict.ts` and
`shared/inputVerdict.ts` are the one reading of the server's answer; the server owns the durable
claim, the registry writes and Pi's startup, and only it decides that nothing was created.
[Image attachments](image-attachments.md) owns the input policy,
[Session dispatch](session-dispatch.md#results-and-limits) the tools' result vocabulary, and
[Remote Pianos](remote-piano.md#developer-navigation) the peer slice.

Where to begin: where a session may start, `startsSessionIn` in
[`machineOffers.ts`](../web/src/lib/machineOffers.ts) and the rules in
[`sessionContext.ts`](../web/src/lib/sessionContext.ts); what the screen does with an answer, the
`selection_rejected`, `error` and `connected` cases of [`store.ts`](../web/src/store.ts) with
[`firstMessage.ts`](../web/src/lib/firstMessage.ts); what an answer means,
[`creationVerdict.ts`](../shared/creationVerdict.ts); what the server records or removes,
[`CreationAttempts.ts`](../server/CreationAttempts.ts) and `create` in
[`SessionHosts.ts`](../server/SessionHosts.ts).

#### Web ownership and interfaces

- [`NewSession.tsx`](../web/src/components/NewSession.tsx) is the UI caller: its submit hands the
  draft to `useImageSend` ([`useImageSend.ts`](../web/src/lib/useImageSend.ts)) with a callback
  that builds `newSessionCommand` ([`composerControl.ts`](../web/src/lib/composerControl.ts))
  and adds the draft's fresh `inputId` as the `attemptId` (the command builder itself sets none);
  the sender delivers it through `Client.captureSend`, so a send that completes after navigation
  or a reconnect is not sent. **Retry** is the same submit over
  the restored draft, a new attempt; **Dismiss** dispatches `dismiss_creation`.
- [`machineOffers.ts`](../web/src/lib/machineOffers.ts) exposes `startsSessionIn(state, cwd)`,
  the one rule for where this machine offers to start: Local anywhere whose checkout is not
  gone, a remote only in a directory listed under one of its open folders. Its callers are the
  New page's default directory in [`client.ts`](../web/src/lib/client.ts), the Directory
  picker's roots (`directoryChoices`), a folder row's and a session's New session here
  ([`folderCommands.ts`](../web/src/lib/folderCommands.ts) and
  [`sessionCommands.ts`](../web/src/lib/sessionCommands.ts), which take the machine's offers and
  return only the commands it offers, so the surface draws what it receives) and a project
  home's directory.
- [`sessionContext.ts`](../web/src/lib/sessionContext.ts) exposes `checkoutMissingAt`, the one
  decision that a checkout is gone: the selected session's own `checkoutMissing` state, a session
  reference unavailable for its checkout, or a folder root Git lists as missing (a linked
  worktree's, unknown or non-Git status is not evidence). Trust, New session here, Rename, the
  focused directory, the composer and the status line all read it. It also exposes
  `directoryChoices`, `startPlace` and `focusedDirectory` for the New page.
- [`client.ts`](../web/src/lib/client.ts) sends `create_session`: it mints a `selectionId` and
  shows the first message only once the socket took the frame; a send known not sent keeps the
  draft on the New page with a warning. On reconnect with an uncertain first message and no
  session named, it sends `select` with the `attemptId`, a read-back, never the creation again. A
  verdict for a creation no longer on screen is announced as a toast.
- [`firstMessage.ts`](../web/src/lib/firstMessage.ts) exposes `PendingCreate` and its
  transitions `started`, `connectionLost`, `rejected`, `failed` and `reconcile`, under which Pi's
  own submission receipt supersedes the browser's record. [`store.ts`](../web/src/store.ts)
  decides when each applies: a `refused` verdict returns to the New page with the attempt's
  options; `created_not_sent` keeps the created session on screen with its input in that
  session's draft; anything else is uncertain and is never resent.
- [`messageDraft.ts`](../web/src/lib/messageDraft.ts) exposes `createDrafts()`, whose `submit`
  and `prepareSubmit` consume the draft and mint the `inputId`, and whose `follow(client)`
  returns input a frame declares `not_sent` to its draft ahead of newer typing: the New draft for
  a refused creation, the created session's draft when the frame names one.
- [`sessionNotices.ts`](../web/src/lib/sessionNotices.ts) owns the banners on a session: Unable
  to open session with **Retry** (a plain `select`), and an uncertain first message with
  **Check start** (the same `select` with `attemptId` that reconnect sends). The New page's Could
  not start session banner with Retry and Dismiss is rendered by `NewSession.tsx`.

#### Shared contracts

- [`wire.ts`](../shared/wire.ts) defines `create_session { selectionId, attemptId?, cwd,
  projectId?, inheritProject?, options, worktree?, text?, attachments, preparedImages? }` and the
  frames that end it: `selected` names the session; `selection_rejected` with `inputId` refuses
  the named creation, nothing created or sent; `error` with `inputId`, `cwd` and `sessionId` says
  the session exists but Piano refused its first input before Pi saw it; `selection_failed` says
  an admitted attachment failed and makes no claim about the creation.
- [`creationVerdict.ts`](../shared/creationVerdict.ts) exposes `creationVerdictOf(frame, {
  attemptId, sessionNamed })`, which reads one result frame as `refused`, `created_not_sent`,
  `created_uncertain` or `uncertain`, and `refusedAttempt(frame)`. The browser (`store.ts`,
  `client.ts`) and the dispatch extension read every creation here; a rejection naming nothing
  leaves the creation uncertain.
- [`inputVerdict.ts`](../shared/inputVerdict.ts) exposes `inputVerdictOf(frame)`: `not_sent` for
  an `error` or `selection_rejected` naming an input, else Pi's submission receipt. Drafts and the
  dispatch extension decide here whether input may be sent again.

#### Server ownership and interfaces

- [`ClientDispatch.ts`](../server/ClientDispatch.ts) admits `create_session` as a claim that is
  never coalesced with navigation. Its unanswered policy maps a refusal or `SessionNotCreated` to
  `selection_rejected` with `inputId`, `InputNotSent` to an `error` naming the created session,
  and any other failure to a plain `error`; a refused delivery of a reused `attemptId` whose
  original may have run answers that the original must be inspected. Prepared peer images are
  claimed here, before creation.
- [`ClientSessions.ts`](../server/ClientSessions.ts) exposes `create`: with an `attemptId` it
  calls `CreationAttempts.begin`, a duplicate reconciles instead of creating, and the first prompt
  is sent only after this client has attached, with `inputId` equal to the `attemptId`. Its
  `reconcile` answers a `select` with `attemptId` from the recorded outcome: `failed` as
  `selection_rejected` with `inputId`, `created` by showing the session, `uncertain` or
  `unclaimed` as an `error` saying nothing was restarted or resent.
- [`CreationAttempts.ts`](../server/CreationAttempts.ts) exposes `begin(request, create)` and
  `outcome(id, { wait })`. `begin` answers `started` for a new identity or `duplicate` for the same
  identity with the same input (a fingerprint of the destination, options, text and attachment
  bytes), and fails with a rejection for the same identity with different input, creating
  nothing. A started creation runs under server ownership and records `created`, `failed` or
  `uncertain` through the registry's `claimCreation` and `saveCreation`
  ([`CreationAttempt.ts`](../server/CreationAttempt.ts): identity, destination and state, never
  prompt bytes).
- [`SessionHosts.ts`](../server/SessionHosts.ts) exposes `create(spec)`: the project check
  (including dispatch inheritance), the destination or new worktree through `FolderWorktrees`
  (INV-06), `attempt.place(cwd)`, the Starting announcement, then Pi. `SessionNotCreated` means no
  reference remains and no input was sent: a fresh reference is removed only after confirmed child
  exit and conclusively absent history, a kept worktree is named in `detail`, and
  `checkoutUnconfirmed` makes the sidebar rediscover. Every other failure keeps its evidence as a
  `PiSessionError`, which the browser and the attempt record read as uncertain.
- [`PeerScope.ts`](../server/PeerScope.ts)'s `peerVerdict` admits a peer's `create_session` only
  in an open registered directory with the creation options the slice allows; the browser's
  `startsSessionIn` offers no more than this, and the server decides.

#### Tests and verification paths

Module checks are grouped by the contract they protect:

- Where a session may start: [`SessionContext.test.ts`](../test/SessionContext.test.ts) covers
  the Directory picker offering only roots on disk, one rule for a folder whose root is missing,
  New session here asking the machine's rule, and a missing checkout decided once;
  [`Client.test.ts`](../test/Client.test.ts) covers the New page's default directory and a
  remote's remembered directory giving way to an open folder;
  [`RemoteSlice.test.ts`](../test/RemoteSlice.test.ts) checks every enabled New session here on a
  remote against the peer's admission; [`MachineOffers.test.ts`](../test/MachineOffers.test.ts)
  covers the offers themselves.
- Verdicts and the draft: [`CreationVerdict.test.ts`](../test/CreationVerdict.test.ts) reads
  each result frame; [`Client.test.ts`](../test/Client.test.ts) covers the minted selection, a
  rejection marking only its own first message, a rejection naming nothing leaving it uncertain,
  reattachment failures never resending creation, and the toast for a creation that fails after
  the person moved on; [`DraftSubmission.test.ts`](../test/DraftSubmission.test.ts) covers a
  failed creation restoring text, quotes, images and options with reconnect only reading the
  original attempt, a refused first input returning to the created session's draft, a known
  not-sent message staying on the New page, and a throwing send opening the session as uncertain;
  [`Navigation.test.ts`](../test/Navigation.test.ts) covers Settings preserving a failed
  selection's Retry and an uncertain creation without replay;
  [`SessionNotices.test.ts`](../test/SessionNotices.test.ts) covers the uncertain first message's
  wording. No module test asserts the Check start action by name; the read-back it sends is the
  one reconnect sends, covered above.
- Durable claims: [`CreationAttempts.test.ts`](../test/CreationAttempts.test.ts) covers a reused
  identity refused while and after the original runs, the read-back waiting for the original, and
  claims surviving restart; [`ClientSessions.test.ts`](../test/ClientSessions.test.ts) covers a
  failed attempt as a tombstone across restart, a claim interrupted before startup staying
  uncertain, a duplicate waiting for the original and attaching, a creation naming no attempt
  making no claim, and the registry writes landing before Pi sees the first prompt.
- Startup failure evidence: [`SessionHosts.test.ts`](../test/SessionHosts.test.ts) covers removing
  only a conclusively empty fresh reference after Pi exits, a killed Pi still being a confirmed
  stop, a never-spawned Pi leaving no reference, a done project getting its mark back, and
  preserved evidence for saved, unreadable, unattributed and stop-unconfirmed startups;
  [`ClientDispatch.test.ts`](../test/ClientDispatch.test.ts) covers a missing directory rejected
  as never started and a first input refused before Pi saw it reading not sent.
- The dispatch reader: [`SessionDispatch.test.ts`](../test/SessionDispatch.test.ts) covers a
  refused creation naming and claiming nothing, and a send that throws or a start abandoned after
  sending staying uncertain.

The committed journey is [`start-session.mjs`](../test/browser/start-session.mjs), run by
`npm run test:browser` or alone with `node test/browser/start-session.mjs <evidence-directory>`:
its creation steps cover a successful start with directory, model, effort and project, the reply,
and a reload that sends nothing again. It does not exercise a failed start. Those paths are the
verify-piano recipes in [Start a session](../.agents/skills/verify-piano/features/start-session.md):
`failed-start` (the browser fake's opt-in `PIANO_TEST_STARTUP_FAILURE` marker, confirmed rejection
with the draft and options restored, Retry once, Dismiss), `not-sent`, `choose-folder` and the
`remote-new` prerequisite, plus `refusals` in
[Session dispatch](../.agents/skills/verify-piano/features/session-dispatch.md). Connection-loss
reconciliation and Check start have no browser journey; the module tests above are their
evidence. The fixture is a process-boundary refusal, not a real Pi startup failure.

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
