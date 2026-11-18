# Native Pi queue controls — 2026-10-04

## Corrected contract (INV-01/03/05/12)

Pi owns pending messages. Piano projects `queue_update` into state and snapshots;
it does not schedule, dequeue, or automatically resubmit messages itself.

The installed Pi **1.0.2** runtime contradicts the RPC documentation's statement
that abort continues queued work. In `dist/core/agent-session.js`, `abort()` sets
`_agentRunAbortRequested`; `_runAgentPrompt()` skips automatic continuation and
emits settlement, leaving pending queue entries intact. An actual RPC reproduction
with a loopback model stream observed `isStreaming: false`, pending count **1**,
and no delivery of that queued input after abort. Raw evidence is under
`/tmp/piano-real-queue-evidence/`. No paid model request or real credentials were used.

Piano maps:

- sending while working → `follow_up`;
- Stop → `abort`, leaving pending entries visibly **Paused queue**;
- Restore to draft → native `clear_queue`, using its returned `steering` and
  `followUp` text, without starting work or fabricating a resume operation.

Pi's current RPC interface has no queue-resume command. Restore intentionally
returns text for manual editing/sending; it is not automatic continuation.

## Result ownership

`PiSessions.act()` returns the cleared text as a command result to its caller.
`WsClient` sends that result only to the requesting browser with session identity;
queue updates still reach every subscriber. Browser-local unsent drafts are keyed
by session identity, so a delayed result appends to its original draft rather than
replacing another session's editor. Existing text, multiline input and duplicate
queue entries are preserved, with blank lines between recovered messages.
This editor state is not a second Pi queue and is not written to the registry.

## Verification and limits

The fake abort was corrected to retain its queue rather than drain it. The native
restore regression failed before the new command was implemented. Public-interface
module checks protect retained queues, exact restored text, empty restores and no
new history/model work. A real-Pi compatibility test uses only a local, held
OpenAI-compatible response and verifies that abort plus restore makes exactly one
model request (the original request), not a new request for the pending messages.
Reducer checks protect late-result targeting and preservation of existing drafts.

`npx agent-browser` used separate scratch backend/Vite processes, not the hosted
built UI: eight viewport sizes, queue snapshots across reload, paused queues,
restoration into an existing draft, peer-tab isolation, single action buttons,
keyboard behavior and in-place reconnect. Evidence is under
`/tmp/piano-restore-evidence/`. The hosted instance was not changed by these checks.

Recovery is text-only, matching Pi's `clear_queue` response. Like ordinary unsent
editor text, restored drafts are browser-memory state, not durable history. The
command removes entries in Pi before the response reaches the browser: this does
not guarantee recovery across a connection loss between clearing and response
delivery. Piano does not silently retry destructive operations or replay prompts.
