# Persisted context and cost — 2026-10-05

## Claim and implementation

INV-01/03: Piano retains Pi's last statistics observation across stopped sessions and backend
restarts, without reconstructing accounting from visible messages or copying Pi history.
This is the cached-summary responsibility already allowed by ADR 0001, not a new history store.

- Each registry session optionally holds one bounded `stats` summary: context, cost, full-session
  token totals and observation time. Version-1 and legacy registries without it remain readable.
  Statistics updates do not change session activity/order. Deletion removes the summary with the
  reference; alias-based references retain their original identity.
- `SessionHosts` caches live observations and flushes the final observation on retirement. Cache
  writes serialize against replacement/deletion; duplicate values do not rewrite the registry.
  Persistence failures log a warning without preventing Pi from continuing.
- File-only views restore that summary immediately and label context **last-known**. They still
  load messages from Pi's file and do not start a child just to display statistics.
- Continuing a cached session exposes the cache before its statistics readback finishes. Pi's
  fresh response replaces the summary, including zero totals, null post-compaction context and
  omitted context when no model/window is available. Failed reads retain the old values/time.
- Context is last-known while work/compaction/retry or refresh makes freshness uncertain, after
  exit, and while the browser is disconnected/resynchronizing. The composer, popover and session
  menu agree. Handled commands also schedule a statistics refresh because they can edit context.

Older sessions with no cached observation remain unavailable until Pi next reports statistics.
Viewing stopped history does not itself refresh from Pi; continuing the session does. The cache
is not restart-safe execution state and cannot establish that an interrupted command completed.

## Evidence and review

Tested Node 24.21.0, locked Pi 1.0.2, base `687db6d` plus the implementation in this commit.
Evidence is retained under `/tmp/piano-stats-evidence/` (scratch artifacts, not the registry).

- `red.log`: new public `SessionHosts` regression failed before implementation because reopened
  cost was `undefined` rather than `1.23`.
- `npm test`: **53 passed** (`tests.log`). The regression covers a new registry/host instance,
  alias ownership, unchanged Pi history, persistence while running, delayed and failed readbacks,
  subsequent replacement, zero/null/omitted values, crash/release, and uncached-session isolation.
  Existing tests retain lifecycle, authoritative-context and retention protection.
- `npm run typecheck`: passed (`typecheck.log`).
- `node test/browser-stats.mjs`: passed (`browser.log`, `browser/commands.json`, snapshots and
  screenshots). Through `npx agent-browser` on scratch loopback ports 7171/7172: live values,
  disconnect labeling, backend restart plus page reload, unchanged history with cached values,
  another uncached session, resume before withheld readback, fresh replacement, failed refresh,
  mobile menu/popover at 320px, and authoritative null context/zero cost.
- Diff/schema review checked that only the numeric summary enters registry, freshness never comes
  from stored flags, no transcript summation/backfill was introduced, and old observers cannot
  overwrite replacement hosts' summaries. Screenshot review confirmed concise labels and no
  horizontal overflow on the narrow viewport. `git diff --check` passed.

The browser journey uses deterministic fake Pi, not a paid provider; the installed Pi statistics
contract was inspected. Required existing real-Pi compatibility tests also passed in `npm test`.
Scratch processes and session files were cleaned up. No new dependencies or production build were
needed for these checks; the user's registry, backend and built UI were untouched.

## Rollout

Not deployed. Applying this change to the hosted instance needs a frontend build, a restart of
`piano.service`, and a browser reload. No restart of `piano-web.service` / `piano-web.socket` is
needed. None of those deployment steps was performed.
