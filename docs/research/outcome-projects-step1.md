# Outcome projects — Step 1 implementation evidence

Date: 2026-10-08. Scope: [Step 1](../outcome-projects.md#step-1--organize-sessions-across-repositories),
not shared instructions or orchestration. Preserves INV-01–02, INV-05–07 and INV-11–13;
organization does not confer verification or approval (INV-09–10).

## Shipped boundary

- Registry v2 adds stable outcome IDs, names, optional goals, archive state and zero/one project
  association on each existing `(cwd, sessionId)` reference. Existing directory/workspace fields
  keep their meaning. Legacy/unversioned and v1 registries migrate with an exact private backup;
  duplicate/dangling identities and incompatible/malformed data fail without resetting the file.
- Projects and Directories have distinct UI labels. Project pages support empty projects, editing,
  explicit working-location choice for new sessions, existing-session selection, confirmed moves,
  unlinking, archive/reopen and direct routes. Command-palette entries mirror these actions.
- Closed directories and archived sessions retain references, routing and workspace identity.
  Missing history/checkout is explained on the project page. History remains readable when only
  the checkout is missing. No missing session is recreated by grouping.
- Archive updates are independent of name/goal edits, so an editor opened before archive cannot
  implicitly reopen a project. Membership is metadata only: no Pi action, trust change or
  checkout operation. Goals are not delivered to Pi.

## Tested inputs and environment

Base: `a42b7cbf54364167a37d2b4d79f8660ae2e1a343` plus this implementation's dirty source.
The retained `source-manifest.json` hashes server/shared/browser/test sources and package manifests;
its SHA-256 is `e3922cc9931ec374db7c0e17cdce1f25eef09372b4f4f458b3912c59e0879deb`.
This avoids claiming that tests ran against the untouched base commit.

Node `24.21.0`, Effect `4.0.0-rc.118`, installed Pi `1.0.4`, Worktrunk `0.80.0`.
The browser fixture uses `test/fake-host-pi.mjs --audit <scratch>/audit.jsonl`, not a paid model.
Pi agent/session storage and registry are scratch-only; backend/frontend listen on loopback
7171/7172. No real registry or running user service was changed. The worktree build was not deployed.

## Observed checks

| Check | Result |
| --- | --- |
| `npm test` | 78/78 pass. New registry test covers v1 backup, cross-repository membership, reused repository, move/unlink/archive/reopen, closed directory, reference removal, restart, stale-editor archive preservation and malformed/dangling rejection. Existing migration test retains legacy and write-failure coverage. |
| `npm run typecheck` | Pass. |
| `npm run build` | Pass; existing large-chunk advisory. Run before the final path-tooltip/truncation and missing-reference wording polish, which subsequently passed typecheck and browser checks. |
| `node test/browser-outcome-projects.mjs /tmp/piano-outcome-evidence` | Pass through `npx agent-browser`; assertions and screenshots retained. |
| `git diff --check` and local Markdown-link review | Pass. |

The browser journey creates one project spanning API/web scratch repositories and another using a
separate API session; opens each transcript and verifies its own cwd/diff; creates/reloads an empty
project; renames a project; starts a grouped session only after choosing its cwd; archives/reopens,
moves and unlinks that running session; observes one spawn and no abort/exit during organization;
reopens the ungrouped session directly; exercises palette membership; closes a directory without
losing membership or direct-route history; removes a history file and a checkout; observes explicit
unavailable states and remaining readable history; restarts the backend and compares the registry.
The v1 backup matches the input byte-for-byte. Mobile assertions protect title width and non-overlap.

Early browser attempts exposed fixture gaps (missing `get_commands`, an unrendered tool label and an
unsupported selector). Those were corrected without weakening the lifecycle assertions. Screenshot
review also caught cramped mobile member actions; an overflow menu and responsive title fixed it.
The final journey passed after these corrections. Manual diff review checked ownership, wire
projection, preserved path references, archive/edit separation and palette parity.

## Retained artifacts and limits

Artifacts are in `/tmp/piano-outcome-evidence/`: `commands.json`, `process.log`, `result.json`
(including the fake-Pi audit), `source-manifest.json`, command-result text files and desktop/mobile
screenshots. The browser fixture is committed for reproduction. All scratch processes, repositories
and isolated session storage were removed by the fixture's cleanup.

No paid Pi compatibility check was needed: Pi protocol/configuration/loading and host acquisition
were unchanged. Existing module coverage plus the audited fake subprocess checks the changed
organization boundary. This is not a new certification of all runtime invariants. Availability is
an observation refreshed with the project list/reload, not a filesystem watcher. Group membership
is single-project; shared context/instructions and task/evidence/integration features remain deferred.
