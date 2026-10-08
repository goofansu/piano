# Session-associated pull request display

Implemented against `a42b7cb` + working tree on 2026-10-08, following
[the T3 Code research](2026-10-08-t3code-settlement-and-session-prs.md).

## Contract and scope

- The selected session shows one compact associated PR in the header, not recent
  URLs mined from its transcript. Research references remain ordinary transcript text.
- `Pull request` in the header menu and Session commands opens the same dialog for
  explicit linking, removal and branch discovery. No settlement/archive behavior changed.
- Initial discovery uses the checkout's current branch and GitHub head repository;
  identically named branches in unrelated forks do not qualify. Multiple matching
  PRs require an explicit choice. Discovered identity is pinned to the session, so
  subsequent branch changes cannot silently replace its PR.
- A canonical explicit GitHub PR URL can be saved even without GitHub access. Removal
  disables automatic discovery until `Find from branch` is requested. Failed discovery
  does not discard an existing association.
- Registry stores only `{url, source}` (or null to suppress discovery); live status
  comes from `gh`. Existing registries accept the optional additive field without a
  version migration. Session history and activity timestamps are unchanged (INV-01).
- Session identity scopes all requests; checkout revalidation and compare-and-set
  protect association writes from late discovery after removal, manual replacement,
  deletion or a branch/remote change. Client identity/request guards keep late responses
  out of a newly selected session (INV-07). No Pi child is started for these operations.
- Only the selected session is polled (one minute, focus and execution-state changes).
  A failed refresh retains the link but removes old check/review success. Diagnostics
  are in the on-demand dialog, not permanent main-view warnings.

Removed the transcript link parser/hook, decorative card pile and CSS, issue/status
wire types, `/api/links`, `GitHubLinks.ts`, and the tests for that deliberately retired
contract. New module and browser tests protect the association contract instead.
No new dependencies, build, deployment or production-registry writes.

## Verification

Environment: Node 24.21.0, locked project dependencies, Git, gh 2.101.0.

- `npm run typecheck`: passed (`/tmp/piano-pr-typecheck.log`).
- `npm test`: 76 passed, zero failed/skipped (`/tmp/piano-pr-tests.log`). The three new
  module checks exercise real scratch Git/Registry with a controlled `gh` subprocess:
  branch/head-repository matching, canonicalization, session isolation, restart,
  sticky removal, merged/closed status, unknown/auth/malformed results, missing
  checkout, explicit offline association, ambiguity, and delayed mutation races.
- `PR_BACKEND_PORT=7271 PR_FRONTEND_PORT=7272 node test/browser-session-pr.mjs
  /tmp/piano-session-pr-evidence/final-browser`: passed. Uses `npx agent-browser`,
  fake Pi and fake GitHub, with a scratch registry/repository only. Observed the
  compact PR alongside unrelated transcript references, header and palette actions,
  remove/reload/rediscover, invalid URL, explicit link/canonicalization, switch to a
  different session and back, reload persistence, unknown status without stale
  approval, and a 390px mobile dialog/header without overflow. Screenshots, commands,
  observations and process logs are in that directory.
- The first browser run on 7171/7172 passed. Later attempts collided with another
  process using those scratch ports. One reached an unrelated scratch UI before
  timing out; added a startup identity/child-exit check so this now fails at startup.
  Did not stop those processes. The final run used 7271/7272 and stopped only its own
  children; its scratch files were removed. Collision output is retained under
  `/tmp/piano-session-pr-evidence/occupied-ports/`.
- `git diff --check` passed. Source review and search found no remaining production
  consumers of the retired link stack/parser/status API. Reviewed desktop/mobile
  screenshots. Existing historical research documents are retained as history.

## Limits

Live GitHub access was attempted with a read-only `gh pr list` and blocked by missing
CLI authentication (exit 4); no live-forge compatibility pass is claimed. The existing
`gh` dependency remains. Manual links still work; discovery and live status require
CLI access to the repository.

Automatic discovery currently recognizes github.com HTTPS/SSH remotes, not custom
hosts or the internal `github.int.exe.xyz` proxy used by this checkout. Such a checkout
gets an actionable on-demand message to link explicitly; it is not reported as a
successful empty GitHub lookup. GitHub Enterprise and multiple/stacked PR UI are not
part of this slice.

Before a session has an association, discovery uses the checkout's current branch,
not reconstructed historical branch ownership. Sessions sharing a checkout can share
its PR. For an older session after that checkout was repurposed, explicitly link the
intended PR or remove the inferred one. Once associated, the session's link is durable.
No claim of exclusive branch ownership or verification/integration status is made.
