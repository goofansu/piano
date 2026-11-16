# Data controls

Settings → Data controls manages session references on the current Piano. It is also a palette
destination. Settings is unavailable while a remote machine is selected; use that machine's own
Piano to unarchive its sessions. The peer boundary is unchanged (ADR 0004).

## Retention

**Unarchive** restores an existing archived reference, retaining its identity, title, project,
pin, activity times, integration links and Pi history. It never starts Pi or an app. A closed
folder stays closed: the confirmation says **Session unarchived · Folder remains closed**.
This does not claim the session is invisible: a pin or project may still list it. Otherwise the
confirmation is **Session unarchived**. Unknown and already-unarchived references are refused.

**Archive all** archives every unarchived, unpinned reference without a running session. This
includes closed folders and missing checkouts. It never stops Pi or apps. The confirmation reads
**Running and pinned sessions are kept. Transcripts are kept.** Running follows the UI's existing
“Not running” vocabulary, rather than confusing “Open” with viewing saved history. It includes
Working, Waiting for input and Ready/idle Pi, app owners, startup, and any session whose execution
ownership lock is held (including shutdown). A count read is only an observation; execution
rechecks eligibility and the success toast reports the actual count written.

The initiating client's selected stopped session is cleared if archived. Other clients keep the
existing Archived view, which refuses further input. Unarchive is one session at a time.

## Ownership and interfaces

- `web/src/components/DataControlsSettings.tsx`: the Settings page, neutral confirmation and row
  actions. The web view-model/controller in `web/src/lib/dataControls.ts` shares the catalog's
  display projection rather than inventing title/folder formatting.
- `shared/wire.ts`: local `unarchive_session`, `archive_all_sessions`, and read-only
  `archive_sessions_count`; each carries `requestId`. `data_controls_result` correlates terminal
  success/count or failure. Mutations additionally emit one server-confirmed success toast.
- `server/ClientDispatch.ts`: ordinary admission, correlated failures and success feedback;
  `ClientSessions.clearArchived` clears the requesting client's selection after bulk archive.
- `server/SessionHosts.ts`: `unarchive`, `archiveCount`, `archiveAll` own serialization.
  Bulk groups canonical checkout/session keys, skips conflicting aliases, and takes only immediately
  available locks. Those locks remain held through one batched write; a concurrent start either
  already owns its lock (and is kept) or re-resolves after the archive (and is refused).
- `server/SessionReferences.ts`: `unarchive` uses the same canonical reference resolution as
  ordinary reads, without reading or rewriting history. Ordinary `resolve` still refuses archived
  references. Missing directories retain their known canonical identity.
- `server/Registry.ts`: `unarchiveSession` and `archiveSessions` mutate saved references only.
  The batch rechecks generation and pinned state inside the write, returns the actual count and
  emits one revision/change, or none for an empty batch. Retention generations protect delayed
  integration writes across archive → unarchive (ABA); database migration 17 persists the generation.
  It is internal metadata, excluded from the sidebar projection.
- `server/PeerScope.ts` keeps all three requests outside the peer allowlist.

These preserve INV-01 (Pi history versus Piano references), INV-02 (canonical process ownership),
INV-05 (correlated completion without replay), and INV-11 (unchanged peer boundary).

## Verification

`test/Registry.test.ts` covers preserved metadata, one revision, pinned references, unknown/already
restored refusal and stale writes across archive → unarchive and database reopen.
`test/SessionHosts.test.ts` covers live/working/idle and starting hosts, canonical alias locks,
closed/missing checkouts, app ownership/cleanup, and read/reopen after unarchive without an implicit
start. `test/ClientDispatch.test.ts` covers count, confirmation, selection clearing and admission
refusal. `test/PeerScope.test.ts` exercises refusal through `/ws/peer`.

Web tests cover archived row formatting/order, operation correlation and Settings navigation.
Use [the Data controls verification entry](../.agents/skills/verify-piano/features/data-controls.md)
for the scratch browser journey and Quiet UI comparison with Webhooks. These are observation
instructions, not a claim that a particular revision passed. The recipe runs on fake Pi and Local
only: it does not show an app-owning or real-Pi session surviving Archive all.
