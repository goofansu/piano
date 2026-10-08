# exe.dev GitHub integration for session PRs

Implemented against `faaad77` + working tree. Follow-up to
[the session PR display](2026-10-08-session-pull-request-display.md); supersedes its
exe.dev-remote and separate-gh-login limitations for attached integrations.

## Behavior and authority

`https://github.int.exe.xyz/goofansu/pi-chat.git` is recognized as a GitHub head
repository. Discovery runs `gh` with a child-local `GH_HOST=github.int.exe.xyz` and
an explicit integration-host repository selector. No login, token extraction,
global environment mutation or `gh` configuration writes are performed.

PR status lookup uses the PR number plus `--repo HOST/OWNER/REPO`, not the public
URL (which would direct `gh` back to github.com despite GH_HOST). Browser URLs
remain canonical `https://github.com/OWNER/REPO/pull/NUMBER` URLs. Explicit proxy PR
URLs are accepted and canonicalized too.

New associations retain an optional allowlisted `apiHost` alongside URL/source in
the registry, preserving integration routing after restart or checkout removal.
Existing associations without the field infer it from the current checkout when
available. Ordinary GitHub remotes still use github.com; a new explicit association
uses its URL/workspace route, not the previous link's transport. Failed proxy reads
report integration access as unknown rather than claiming no PR or healthy checks.

This preserves INV-01 (only association/transport metadata in Registry; live facts
from GitHub) and INV-07 (session/check-out scoping, existing mutation fences).
The browser UI, Pi execution/history, integration attachment and Git remotes are
not changed. Proxy discovery queries the repository named by the remote; an upstream
PR outside that repository can be linked explicitly if the integration permits it.

## Primary source

[exe.dev GitHub Integration](https://exe.dev/docs/integrations-github.md) documents
aggregate remotes, GitHub CLI use via `GH_HOST=github.int.exe.xyz`, and attached
integration authentication without tokens stored on the VM. Read 2026-10-08.
The proxy endpoint was accessed locally from the VM, not through a third-party
web-fetch service.

## Evidence

Environment: Node 24.21.0, gh 2.101.0, locked dependencies.

- `npm run typecheck`: passed (`/tmp/piano-exe-pr-typecheck.log`).
- `npm test`: 77 passed, zero failed/skipped (`/tmp/piano-exe-pr-tests.log`).
  Added a module regression covering per-child host/repository routing, ordinary
  GitHub isolation, canonical browser URLs, old associations, detached HEAD,
  explicit proxy URLs, near-miss host rejection, restart/removed checkout, and
  integration denial. Fake gh checks the routing at the process boundary.
- Real read-only `GH_HOST=github.int.exe.xyz gh pr list -R goofansu/pi-chat ...`:
  passed without a separate CLI login (`/tmp/piano-exe-pr-live.json`).
- Live `SessionPullRequests` module in a throwaway Git repository with that proxy
  remote and an existing PR's head branch: discovered PR #13, persisted the
  integration route, then read its status after deleting the scratch checkout.
  Passed (`/tmp/piano-exe-pr-module-live.log`). No user repository/registry changes,
  forge mutations or paid model calls. Scratch registry/repository removed.
- `PR_GITHUB_HOST=github.int.exe.xyz PR_BACKEND_PORT=7271 PR_FRONTEND_PORT=7272
  node test/browser-session-pr.mjs /tmp/piano-exe-pr-evidence/browser`: passed.
  Actual scratch browser journey with controlled gh/Pi: branch discovery, public
  header link, remove/reload/rediscover, explicit linking, cross-session switching,
  reload, unavailable-integration state without stale approval, and mobile layout.
  Commands, screenshots, process logs and observations are retained there. Processes
  and fixture files created by the check were cleaned up.
- `git diff --check`: passed; reviewed the host allowlist, subprocess environment,
  backwards-compatible optional schema field and canonical link handling.

No deployment of this follow-up was performed. The earlier requested deployment
completed successfully (`DEPLOY OK` in `/tmp/piano-deploy.log`).
