# Runtime ownership behind PiSessions

PiRecords is deliberately not split by size, and SessionDialogs/SessionReadbacks take the session's
`SessionPublication` itself (lock and gates included), not a bag of functions: one atomicity
boundary with one owner.

## Saved-history SDK compatibility

`PiHistoryFile` imports Pi's non-public `core/session-manager.js` so `PiHistoryWorker` skips the SDK
root's interactive modules; this is an explicit upgrade cost (INV-12). Only a missing module or a
missing parser/`inMemory` export may fall back to the public SDK; other load/parse errors must not.

On each Pi upgrade, check the root's re-exports and package layout, prefer a public history subpath
if one exists, run `HistorySdkCompatibility.test.ts`, `SessionHistory.test.ts` and the scratch
open/continue journey, and recheck cold-worker latency and memory.

### Developer navigation: session creation and recovery

Start at `create` in `server/SessionHosts.ts`; `shared/creationVerdict.ts` reads the answer.

## Publication mutation contract (PIN-28)

`SessionPublication.transaction(use)` is the only capability exposing `publish` and `mergeState`.
Do not nest `apply` or `patchState` inside a transaction: they take the lock themselves. Use the
capability inline; never retain it or pass it to forked work. Types do not stop that escape.

## Transport failure policy (PIN-10)

These suppressions and retries are deliberate. No path replays a mutation, and no raw transport
cause is copied into a diagnostic.

| Boundary | Policy to preserve |
| --- | --- |
| Pi stderr reader | Continue RPC with one server warning; stderr is diagnostic-only. |
| Kill after failure / shutdown | Kill errors stay suppressed: terminal state is settled and the scoped process owns cleanup. Never replace the original failure with a kill race. |
| Dialog deadline / abort | `resolveDialog` publishes its outcome before failing; timer/abort callers suppress that reported error to keep resolving other dialogs. |
| Client attachment and catalog/host/sidebar subscriptions | The trailing `Effect.ignore` has no typed error left; it is not a hidden recovery policy. |
| SessionHosts observer | Retries the snapshot subscription on delivery overflow so exit ownership is not lost; observation only. |
| Registry committed-write listeners | Keep catch-and-warn: the commit already succeeded, and failing the caller would imply rollback. |
| Generic subprocess group kill | Suppress already-exited process/group races. |
