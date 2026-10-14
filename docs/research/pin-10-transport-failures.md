# PIN-10 — transport failure policy

Audited main `d9b8a4a` after PIN-7/9, then verified this change on Node 24 with
fake Pi. Contracts: INV-02/03/04/05/11. No registry migration or deployment.

## Inventory and decisions

| Boundary | Recovery policy |
| --- | --- |
| Pi stdout framing, JSON/envelope, record capacity, reader failure or premature EOF | Fail the session, settle pending requests/writes, end queues, kill the unusable child. No replay. PIN-7/9 already supplied this path. |
| Pi stdin sink failure | Previously settled callers but left an uncontrollable live session. Now use the same terminal failure path, after failing writes/requests as transport-uncertain. Raw cause text is not delivered. |
| Pi record consumer | Unexpected processing failure now terminates the child and publishes closure after the consumer signals completion. Scope interruption is ordinary shutdown, not failure. |
| Pi exit observation | Unexpected failure terminates the child with a fixed diagnostic; ordinary scope interruption is not a crash. |
| Pi stderr reader | Continue RPC, with one server warning that exit diagnostics may be incomplete. Stderr is diagnostic-only; do not expose raw reader causes. |
| Kill after failure / shutdown | Best-effort kill errors remain suppressed: terminal state is already settled, and the scoped process resource still owns cleanup. Do not replace the original failure with a kill race. |
| RPC acknowledgement / write deadline | Report uncertain delivery, retain uncertainty for retirement, never retry a mutation. Capacity refusal is rejected before delivery, not uncertain. |
| Dialog deadline / abort cancellation | `resolveDialog` claims once and publishes written/uncertain/not-sent before returning its typed failure. Timer/abort callers suppress that already-reported error to continue resolving other dialogs. Exit resolution sends nothing. |
| Usage/context/state readbacks | Continue with retained values and existing refresh-error state. Obsolete observations cannot overwrite newer operations. Optional run-ledger reads retain last usage on failure; cursor reset retries only a read, never a mutation. |
| Socket reader | Peer close and scope interruption end the client scope normally. Unexpected read/dispatch failure sends 1011 with reconnect guidance. Session-owned Pi work survives; reconnect is snapshot-only. |
| Socket close write | Best effort: a dead peer cannot receive its close reason. Client scope still closes. No resend. |
| Bounded socket delivery | Overflow/encoding/write failure or missing ack resolves the first close reason. 1009 means oversized view; 1013 means reconnect for a snapshot. Writer failure never retries frames. |
| Client session attachment | DeliveryOverflow closes the socket via output. Stream completion detaches and releases readiness; next action may reopen an exited session. The trailing `Effect.ignore` has no remaining typed error after overflow handling (it does not catch defects). |
| Client catalog/host/sidebar subscriptions | Their streams/send have no typed failures; trailing `Effect.ignore` is redundant, not a hidden transport recovery policy. Actual socket writes belong to bounded delivery above. |
| SessionHosts observer | Retry snapshot subscription on delivery overflow so exit ownership is not lost. This retries observation only; cached-state persistence failures are already warned, not retried as user mutations. |
| Registry committed-write listeners | Keep catch-and-warn: SQL/config commit already succeeded. Failing the caller would falsely imply rollback and encourage duplicate mutation. |
| Generic subprocess group kill | Suppress already-exited process/group races; completion/timeout/abort still settles the original command. |

No permanent UI warning was added. Failure text appears only when the corresponding
session/connection fails. No raw transport causes are copied into new diagnostics.

## Evidence

- Extended the existing broken-stdin dialog test: before the fix it timed out waiting
  for closure; afterwards it observes failed closure, uncertain response delivery,
  no reopened dialog, and refusal of a second answer.
- Added a socket-delivery writer-defect regression: one write attempt, safe close
  reason, no frame retry. Existing protocol/overflow/readiness/race tests retained.
- Focused runtime suite: 54 passed. Full `npm test`: 381 passed.
- `npm run typecheck` and `npm run lint`: passed.
- `node test/browser-inbound-limits.mjs /tmp/piano-yej-evidence/10-browser`:
  passed via agent-browser on isolated 7171/7172. Observed overload while a dialog
  and delivery acks remained usable, recovery with a successful prompt, then
  visible protocol failure and exactly one submission of uncertain input.
- Outputs retained under `/tmp/piano-yej-evidence/10-*`, including browser commands,
  wire observations and screenshots. Scratch processes/storage removed by the runner.

Limitations: no real model calls; no direct injected socket-reader or projector defect
browser test. Those paths were reviewed for terminal cleanup; transport fault tests
cover the shared closure/delivery contract, not every possible OS failure.
