# Data controls

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

Web tests cover archived row formatting/order, outcome wording, Settings navigation,
(`test/Navigation.test.ts`) an unavailable session's page opening the session once it is
available, and
(`test/SessionCommands.test.ts`) an archived session's menus offering no change;
`test/CorrelatedRequest.test.ts` covers the four request outcomes. `test/SessionContext.test.ts`
and `test/SessionNotices.test.ts` cover an archived session, with or without its checkout, reading
Archived and never offering Archive.
Use [the Data controls verification entry](../.agents/skills/verify-piano/features/data-controls.md)
for the scratch browser journey and Quiet UI comparison with Webhooks. These are observation
instructions, not a claim that a particular revision passed. The recipe runs on fake Pi and Local
only: it does not show an app-owning or real-Pi session surviving Archive all.
