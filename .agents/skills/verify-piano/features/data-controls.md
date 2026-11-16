# Settings › Data controls

Contract and owning modules: [Data controls](../../../../docs/data-controls.md).
Launch, capture and cleanup follow [verify-piano](../SKILL.md). Use the seeded fake-Pi scratch
instance; no credentials or model calls are needed. Keep one instance/browser at a time.

## Journey

1. Open a seeded saved session. From its session menu choose Archive (an idle session archives at once), then open
   Settings → Data controls. Capture its title, small folder line (full path in `title`) and
   outline Unarchive button. Archived sessions is the last group; Sessions is first.
2. Unarchive it. Observe Session unarchived, disappearance from Archived sessions and return to
   the sidebar. Open it and read the seeded history. Check the audit: neither Unarchive nor
   reading saved history started a non-probe Pi. Explicitly sending a follow-up may start it.
3. Pin one stopped session. Start another with the fake-Pi prompt `hold`, leaving it Working.
   Keep at least one stopped, unpinned session. In Data controls choose Archive all: observe
   Archive N sessions?, Running and pinned sessions are kept. Transcripts are kept., and a
   neutral Archive all button. Cancel once, confirm once. The toast's count matches the changed
   references; the Working and pinned sessions remain. The audit has no shutdown for the live Pi.
4. Open Archive all again at zero: confirmation is disabled. Check the empty archived-list state
   by unarchiving rows individually. There is no Unarchive all.
5. Archive an unprojected session and close its folder. Unarchive from Data controls: observe
   Session unarchived · Folder remains closed. The folder remains closed. A session with a pin
   or project may remain visible; the toast must not claim otherwise.
6. Open Data controls through Mod+K. Capture it beside Webhooks at desktop and a narrow viewport:
   one Settings column, matching rows, no helper descriptions, readable long titles/paths and
   stationary text action targets. Check confirmation Cancel/Escape and busy label/spinner.

## Remote boundary

The default launch has no configured peer. Run the existing `remote-session.mjs` journey separately
(after cleanup) for remote Settings absence, and `test/PeerScope.test.ts` for both mutations and
count refused through `/ws/peer`. Label module-only evidence as such; do not configure a real peer
or start an extra manual scratch instance to fill this gap.

## Limits

A fake-Pi audit proves no process interruption, not a model or app runtime. App-owning/starting/
held-lock cases and archive/unarchive stale-write protection are module checks in the feature doc.
Record the tested revision, environment, commands and observed results with the captures.
