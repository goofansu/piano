# Deleted-worktree session access

## Claim and cause

INV-01/02/06: removing a checkout must not make its surviving Pi history inaccessible or
prevent explicit archive/delete. It must not start Pi in another checkout to work around deletion.

`SessionHosts.get` and `peek` required checkout `realpath` before locating history. A focused
`node --test --test-name-pattern='deleted checkout' test/SessionHosts.test.ts` reproduced the
reported `Cannot resolve checkout … ENOENT … realpath` failure before the fix.

Missing paths now retain exact registry identity for history/retention. Observed aliases retain
their canonical ownership key during the server lifetime; unknown alias relationships after restart
are not guessed. Non-ENOENT filesystem failures still fail. Execution requires the original cwd;
abort remains allowed. Accessing a missing checkout's live session retires that child before reading
its final history. No history relocation, registry migration, or automatic worktree restoration.

The browser shows the transcript and a read-only notice instead of a composer/model request.
Rename and “New session here” are disabled; archive/delete remain available. Restoring the checkout
at its original path and reloading enables continuation.

## Verification

Tested on base `5b66eb60b0e988c273560f5d8170677f5401a105` plus this change, Node v24.21.0,
Worktrunk v0.80.0, Linux. Fake Pi only; no paid model calls.

- `npm test`: **69 passed**. New regressions cover preserved history, no child startup,
  explicit archive/delete, restoration, and live ownership after physical-checkout or alias removal.
  Existing conflict, concurrency, shutdown and stale-reopen checks remain green.
- `npm run typecheck`: **passed** (server/shared and web).
- `node test/browser-deleted-worktree.mjs /tmp/piano-missing-evidence/browser`: **passed**.
  Real scratch Git worktree removed through Worktrunk; isolated registry and Pi storage;
  loopback backend 7171 and development UI 7172. `agent-browser` observed desktop (1280×900)
  and mobile (390×844) history, reload, no error toast, read-only controls and palette,
  archive preserving its file, delete removing only its file, and restored checkout enabling the composer.
- `git diff --check`: **passed**. Reviewed identity fallback, execution guards and UI control parity;
  inspected the mobile screenshot. Scratch processes, repository/worktree/branch and histories removed.

Raw browser commands, screenshots and result/environment record are under
`/tmp/piano-missing-evidence/browser`; suite output is in the parent directory.

## Boundaries

This is on-access recovery, not a filesystem watcher: an already-open tab may need reload to show
read-only state, while new execution requests are rejected at the server. A child can keep doing
previously admitted work until retirement/abort. Unrelated processes are not reaped. Custom session
storage that was itself deleted cannot be recovered; no history is reconstructed. Restore was checked
through composer availability, not a paid continuation. The user's registry and running instance
were untouched; this change was not deployed.
