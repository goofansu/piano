# YEJ-19: worktree admission recovery

Base `2e39011`, plus this implementation diff; Node 24.21.0, npm 11.19.0,
Effect/platform-node 4.0.2. Contracts: INV-02/06/07.

The rejection branch ran before the worktree handler and emitted only a generic error.
The existing picker state machines already accept correlated operation receipts and
folder-scoped discovery errors. Return those existing wire outcomes directly on rejection:
create/add receive `worktree_result` with their requestId and status error; discovery receives
`worktrees` with its folder and an error observation. No lifecycle handler runs and nothing
is automatically retried. Detail explicitly says the request was not started. Genuine missing
receipts still retain their timeout/uncertain-delivery behavior; that code is unchanged.

Verification:

- New ClientDispatch → browser reducer → WorktreeRequest regression failed before the fix:
  receipt requestId was undefined instead of `create`.
- After the fix it covers create/add matching receipts, unrelated receipt rejection, immediate
  pending completion, folder-scoped discovery failure, refresh completion, unchanged registry
  and no replay command. Existing lost-receipt tests remain unchanged and pass.
- `node test/browser-worktree-admission.mjs /tmp/piano-yej19-browser` passed through
  agent-browser against scratch backend 7171/UI 7172 and fake Pi. Saturated the same client
  socket with eight held requests. Discovery failure left Refresh enabled; after abort released
  capacity, explicit Refresh restored the worktree list. Saturated again: clicking a checkout
  and creating a branch both produced immediate matching error receipts; controls became usable
  without the 75-second timer. Exactly two mutation requests, no replay, no branch created,
  no reconnect and no browser errors. Screenshots, commands, wire and process logs are retained
  in that directory. Scratch processes and files were removed.
- `npm test`: 389 passed, zero failures/skips. `npm run typecheck`, `npm run lint` and
  `git diff --check` passed. Local logs: `/tmp/piano-issue-audit/worktree-*.log` and
  `browser-worktree.log` (ephemeral).

Inspection confirmed existing WorktreesPopover only observes discovery for its current folder;
an unrelated folder response cannot clear its refresh. No UI or registry schema change was
needed. No runtime dependency change, real model call, real registry mutation or deployment.
