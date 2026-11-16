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
existing Archived view, which refuses further input: its menus keep read and copy actions but
disable Rename, Pin, Archive, Delete, project assignment and Pull request. An archived session
cannot be deleted until it is unarchived. Unarchive is one session at a time. Opening an archived session's address
(`/s/<id>`) shows **Session archived** instead of trying to open it; its **Data controls** button
opens Settings → Data controls, or, on a remote machine, the page points to that machine's Piano.

A mutation keeps running on the server after the client disconnects. A lost connection or a
missing reply (75 s) is therefore not reported as a failure: the warning says the change may have
finished and to check Archived sessions. A refusal reads **Could not …:** followed by the
server's reason; only a request that never left the browser reads plain **Could not …**.

## Ownership and interfaces

- `web/src/components/DataControlsSettings.tsx`: the Settings page, neutral confirmation and row
  actions. The web view-model/controller in `web/src/lib/dataControls.ts` shares the catalog's
  display projection rather than inventing title/folder formatting, and keeps only its state and
  wording. `web/src/lib/correlatedRequest.ts` sends each request and decides its outcome: not
  sent, failed with the server's detail, confirmed, or unconfirmed (connection lost or no reply).
  The worktree picker (`web/src/lib/worktreeOperation.ts`) uses the same module.
- `shared/wire.ts`: local `unarchive_session`, `archive_all_sessions`, and read-only
  `archive_sessions_count`; each carries `requestId`. `data_controls_result` correlates terminal
  success/count or failure. Mutations additionally emit one server-confirmed success toast.
- `server/ClientDispatch.ts`: ordinary admission, correlated failures and success feedback;
  `ClientSessions.clearArchived` clears the requesting client's selection after bulk archive.
- `server/SessionHosts.ts`: `unarchive`, `archiveCount`, `archiveAll` own serialization.
  Bulk skips live and starting sessions and takes only immediately available locks. Those locks
  remain held through one batched write; a concurrent start either already owns its lock (and is
  kept) or re-resolves after the archive (and is refused).
- `server/SessionReferences.ts`: one grouping maps saved references to canonical checkout/session
  keys. `reference` (used by `resolve` and `unarchive`) refuses a conflicting group;
  `canonical` yields the non-conflicting entries Archive all may consider, so it skips conflicting
  aliases. `unarchive` uses the same resolution as ordinary reads, without reading or rewriting
  history. Ordinary `resolve` still refuses archived references. Missing directories retain their
  known canonical identity.
- `server/Registry.ts`: owns retention. `archiveSession`, `unarchiveSession` and `archiveSessions`
  mutate saved references only, through one transition that flips `archived` and bumps the
  retention generation. `archivable` (not archived, not pinned) is the one rule for bulk archive;
  `archiveSessions` rechecks it and the generation inside the write, and `archivableCount` counts
  what that write would archive for the same expected entries. Pin, Changes scope and project
  assignment pass one gate that refuses an archived reference. Integration link writes
  (`setSessionLink`, used for pull request links) save nothing on an archived reference, so a
  pull request read keeps the saved link and a link change fails as a stale write. The batch returns
  the actual count and emits one revision/change, or none for an empty batch. Retention generations
  protect delayed integration writes across archive → unarchive (ABA); database migration 17
  persists the generation.
  It is internal metadata, excluded from the sidebar projection.
- `web/src/lib/sessionContext.ts`: `sessionReferenceChangeable` is the client's matching rule;
  `sessionMutable` adds selection readiness for Rename, Archive and Delete.
- `server/PeerScope.ts` keeps all three requests outside the peer allowlist.

These preserve INV-01 (Pi history versus Piano references), INV-02 (canonical process ownership),
INV-05 (correlated completion without replay), and INV-11 (unchanged peer boundary).

## Verification

`test/Registry.test.ts` covers preserved metadata, one revision, pinned references, unknown/already
restored refusal, stale writes across archive → unarchive and database reopen, and the gate's
single refusal for every reference write, including a link write on an archived reference.
`test/SessionPullRequests.test.ts` covers an archived session's pull request read saving nothing and
link, discover and remove being refused.
`test/SessionHosts.test.ts` covers live/working/idle and starting hosts, canonical alias locks,
conflicting alias references skipped by both count and Archive all, closed/missing checkouts, app ownership/cleanup, and read/reopen after unarchive without an implicit
start. `test/ClientDispatch.test.ts` covers count, confirmation, selection clearing and admission
refusal. `test/PeerScope.test.ts` exercises refusal through `/ws/peer`.

Web tests cover archived row formatting/order, outcome wording, Settings navigation, and
(`test/SessionCommands.test.ts`) an archived session's menus offering no change;
`test/CorrelatedRequest.test.ts` covers the four request outcomes.
Use [the Data controls verification entry](../.agents/skills/verify-piano/features/data-controls.md)
for the scratch browser journey and Quiet UI comparison with Webhooks. These are observation
instructions, not a claim that a particular revision passed. The recipe runs on fake Pi and Local
only: it does not show an app-owning or real-Pi session surviving Archive all.
