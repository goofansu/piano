# T3 Code: settlement and session-associated pull requests

## Scope and provenance

Source inspection on 2026-10-08. T3 Code revision
`d720210996a514368ba99f4860063110033d93fa`; Piano baseline
`4ea1986a2be9eaf7b21398c65a96069a6e37a9a9`.
This is research, not an approved implementation plan. No application behavior changed.
No background-agent tool was available, so research was performed directly.

## Findings

### Settle is not a pull request

T3 calls its conversation a “thread”; Piano calls this a session.
Settlement is a separate lifecycle/attention state: explicitly settle or un-settle a
conversation, independently of its PR identity. The command handler records
`settledOverride: "settled"` and a settlement timestamp; un-settle records an active
override. The UI offers both actions. This is not “create PR”, “merge PR”, or delete
history. Archive is a separate action. [1][2]

Automatic settlement connects that attention state to external outcomes and inactivity:

- A merged PR can settle the conversation when auto-settle-on-merge is enabled.
- Closed PRs can also qualify; inactivity can qualify under a configured age threshold.
- A user message after the PR's terminal timestamp prevents that old PR event from
  settling the newer work.
- Open or unsynced visible PR links prevent automatic settlement, including the
  inactivity path. Active work, pending user requests, pins and overrides also gate it.
- The service runs under its automatic-settlement configuration, so the closed-PR
  rule should not be read as an unconditional global behavior. [3]

Thus **settled means put aside as done for now**, not “this session is a PR” and not
proof that the work passed verification.

### The PR UI is associated with the session, not a bag of transcript URLs

There are several authoritative association paths:

- A successful PR-creation/open-existing action links the result to its session,
  recording source `created`. Identity comes from the PR URL, with project identity
  as fallback, rather than assuming a fork's remote owns the PR. [4]
- Branch discovery groups sessions by project, worktree path and branch, resolves
  the branch PR, checks repository identity, and rechecks workspace/branch state
  before applying a result. Branch discovery is not proof of exclusive ownership:
  sessions sharing the branch can share its PR. [5]
- Agents can explicitly link a PR through a structured command (`source: "agent"`). [6]
- Provider-reported native stack siblings can be auto-linked (`source: "stack"`). [7]

Current T3 Code is **not restricted to exactly one PR per session**. It has a collection
of links, canonical host/repository/number identity, dismissal of stack members, and
selection rules for compact single-slot UI surfaces:

1. Prefer open work (unsynced links provisionally count as open).
2. For stacked open work, select the highest open layer in the ordered chain.
3. A completed single chain points to its top; unrelated terminal links use the most
   recently updated request.

A tooltip/list can show the associated PR collection and chain indentation. So the
useful interpretation of “only the current session's PR” is **session-scoped relevance**,
not a one-to-one cardinality constraint. [8][9]

## Why Piano's current stack feels different

Piano's `web/src/lib/links.ts` scans user and assistant prose for GitHub PR/issue and
local-server URLs, skips fenced code and tool messages, sorts by most recent mention,
and keeps six. `web/src/components/LinkStack.tsx` presents these as a visual pile.
`server/GitHubLinks.ts` enriches those URLs with GitHub status; it does not establish
that a PR belongs to the session's work.

Consequences established by code inspection:

- A PR pasted for research or comparison gets the same prominence as the session's
  deliverable; the latest mention determines the front card.
- A PR that exists on the working branch but is never mentioned in prose is absent.
- Issues, local servers and PRs compete for the same six slots.
- This visual pile is not a Git branch/PR dependency stack.
- Parsing and status lookup disagree: the frontend accepts query strings, fragments
  and trailing slashes on PR/issue URLs, while `server/Router.ts`'s status endpoint
  only accepts the bare path ending in digits. Deduplication also operates on URL
  strings rather than canonical PR identity. These are inspection findings, not
  browser-reproduced failures.

## Suggested direction for discussion

The primary fix is **separating referenced links from associated work**, rather than
making URL extraction more aggressive:

- Use a compact current-PR surface for the selected session's associated work.
- Discover a candidate from the session's repository/worktree/branch and support
  explicit association/removal; do not equate a pasted URL with ownership.
- Keep unrelated research links in the transcript. Treat local-server access as a
  different kind of action, not another PR card.
- Start with one primary displayed PR if that fits Piano's needs; keep the meaning
  distinct from a real dependency stack and acknowledge branch-sharing ambiguity.
- Consider “Settle” independently as a reversible attention action. Any later
  merge-triggered settlement needs explicit policy and must not mean “verified”.

This recommendation does not select a persistence schema, change registry ownership,
introduce outcome-project requirements, or authorize a new lifecycle feature.

## Sources (revision-pinned primary code)

1. [Orchestrator settlement commands](https://github.com/pingdotgg/t3code/blob/d720210996a514368ba99f4860063110033d93fa/apps/server/src/orchestration-v2/Orchestrator.ts#L2763-L2795)
2. [Session action menu](https://github.com/pingdotgg/t3code/blob/d720210996a514368ba99f4860063110033d93fa/apps/web/src/components/threadActionMenu.logic.ts#L145-L215)
3. [Automatic settlement service and gates](https://github.com/pingdotgg/t3code/blob/d720210996a514368ba99f4860063110033d93fa/apps/server/src/orchestration-v2/ThreadSettlementService.ts#L111-L260)
4. [Linking created PRs](https://github.com/pingdotgg/t3code/blob/d720210996a514368ba99f4860063110033d93fa/apps/server/src/git/linkCreatedPullRequest.ts)
5. [Branch PR discovery and stale-result protection](https://github.com/pingdotgg/t3code/blob/d720210996a514368ba99f4860063110033d93fa/apps/server/src/orchestration-v2/ThreadPullRequestService.ts#L170-L325)
6. [Agent PR link command](https://github.com/pingdotgg/t3code/blob/d720210996a514368ba99f4860063110033d93fa/apps/server/src/mcp/toolkits/pullRequests/handlers.ts#L275-L300)
7. [PR synchronization and stack association](https://github.com/pingdotgg/t3code/blob/d720210996a514368ba99f4860063110033d93fa/apps/server/src/orchestration-v2/PullRequestSyncReactor.ts#L138-L260)
8. [Canonical identity and current-PR selection](https://github.com/pingdotgg/t3code/blob/d720210996a514368ba99f4860063110033d93fa/packages/shared/src/threadPullRequests.ts#L16-L152)
9. [Session PR badge and associated PR mini-list](https://github.com/pingdotgg/t3code/blob/d720210996a514368ba99f4860063110033d93fa/apps/web/src/components/ThreadStatusIndicators.tsx#L260-L374)

## Verification and limits

Reviewed cited source paths and relevant implementations in the cached checkout, and
compared Piano's link parser, card component, status lookup and endpoint filter.
No T3 UI runtime observation, Piano browser run, model calls or test suite: this is a
document-only research change. Findings describe the pinned upstream revision, not
necessarily an older T3 build the user has seen. Existing unrelated staged design
changes were left untouched.
