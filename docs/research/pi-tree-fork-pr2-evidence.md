# Bookmarks — PR 2 evidence

Delta from `pi-tree-fork` / `6ee8136`; implements [PR 2](../pi-tree-fork-plan.md#pr-2--bookmark-conversation-entries).
Contracts: INV-01–05, INV-11–12. Node 24.21.0, locked Pi 1.1.0, Linux.
Scratch SQLite/Pi config/history, loopback 7171/7172; no deployment or paid calls.

## Before / after

Before, labels could only be inspected. After, the menu and palette's **Bookmark**
open the shared picker; a selected entry can be named, renamed or unbookmarked.
The browser journey bookmarked an abandoned entry, filtered/searched for its label,
renamed it, reloaded, restarted the scratch backend, and removed it. Saved Pi label
entries matched each operation and were appended at the active leaf, not the target
branch. Real-Pi module checks compare model-visible context before and after.

A second browser tab deliberately retained an older tree: its attempted overwrite
was rejected, leaving the newer label intact. Switching the scratch backend to a
missing-extension fixture showed an actionable error, left previews available and
disabled bookmarking; its prompt-write audit stayed empty. During this check, a
selection refresh initially hid the mutation error; it now remains visible until
the next attempt rather than disappearing with the selected row.

## Gates

```text
npm test           100 passed
npm run typecheck  passed
npm run lint       passed
node test/browser-bookmarks.mjs /tmp/piano-bookmark-evidence/browser
PASS: add/rename/filter, stale second-tab rejection, reconnect/backend restart,
      palette parity, removal, Pi saved labels and missing-extension fail-closed
      behavior; no model requests.
```

Retained `/tmp/piano-bookmark-evidence/`: commands, screenshots, process/fixture
observations, environment/revision and gate output. Scratch processes and fixtures
removed. Module cases also cover incompatible version/source, rejected operation,
lost result, wrong result correlation, uncertain-delivery pinning, abort availability,
concurrent admission, stale generation and reopen persistence. Review also caught
that a label append can evict its target from the bounded outline: readback now
checks Pi's global label entries, and a real-Pi 2,000-row boundary case proves that
this succeeds rather than incorrectly reporting uncertain delivery.

## Standards / spec review

- Pi remains the only writer: the explicit bundled extension calls `pi.setLabel`
  with the chosen Pi ID. SQLite receives no labels or copied history.
- The private bridge announces a version and random session-local command name.
  Before dispatch, PiSessions validates the command's extension source path. Missing
  or incompatible capability fails closed before any prompt write. Private frames
  never appear as ordinary notifications or completion suggestions.
- Mutation admission is session-owned and survives caller disconnection; it rejects
  concurrent/stale history changes and gates other mutations, but not abort/dialog
  responses. Quiescence includes queued work, retry, compaction, dialogs and pending
  readbacks. The extension also validates the append revision immediately before
  writing. Results correlate both session and operation and require readback.
- Lost acknowledgements/results stay uncertain, pin the host against idle retirement,
  and block blind repeats. Explicit restart remains the recovery boundary after
  inspection; an uncertain write is not represented as rollback.
- Read-only history still works without loading an inactive child. A first bookmark
  can start that child; startup changes invalidate the request rather than choosing
  a different target. Live generations prevent replay after a host restart.
- Menu/palette parity and the on-demand quiet UI are preserved. No navigation,
  filesystem operation or fork is exposed in this slice.

Reviewed locally along Standards and Spec axes, not by independent agents. The
browser covered missing capability and stale tabs; lost/wrong acknowledgements and
incompatible capability versions were deterministic module checks, not browser
fault injection. The capability/source check is an integration compatibility guard,
not a security boundary against trusted extensions executing inside Pi.
