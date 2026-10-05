# Phase 8 — Configured checks and bounded evidence

Date: October 5, 2026. Acceptance: **INV-01, INV-07–09, INV-13**, for one operator-configured,
dependency-free Node check type. This completes the bounded Phase 8 journey, not task-wide readiness,
managed apps, browser checks or integration. [Configuration and limits](../checks.md).

## Shipped contract and decisions

- **Checks** is available in the session menu and next to the new-session directory. It names the
  workspace, captured requirement/criterion, execution outcome, revision, observation time and
  current/stale/unknown validity separately. Passing a check never changes Pi session state. Output
  and full provenance are available on demand. Refresh/reload never sends another run automatically.
- `WorkspaceChecks.start / cancel / view` owns server-side execution, atomic evidence persistence,
  output retention and criterion evaluation. Registered workspace IDs are resolved by HTTP routing.
  The browser has no arbitrary command or policy-edit endpoint. No skill names or transcript claims
  participate in evaluation.
- One external operator file (`<PIANO_CONFIG>.checks.json`, overridable) defines one Node ES module
  check per project. It captures task source/content/version, criterion ID/content/version, script,
  timeout and check version. Their digest binds the policy. The policy and evidence store must be
  outside both the project root and selected checkout. Changing project files cannot silently replace
  the configured script. Unrestricted same-user shell access remains outside this policy boundary.
- `WorkspaceRevisions.materialize` revalidates manifest identity and bounded blob hashes, rejects
  symlinks and copies working files into a fresh private execution directory. No source reads, shared
  blob hardlinks, live dependencies or package-install step occur inside the check.
- Execution uses **Linux + bubblewrap 0.9.0** with private PID/network namespaces and a read-only
  root containing only captured regular files, captured operator script, and copied Node/loader/shared
  library bytes. A small writable tmpfs is separate. The environment is fixed and credential-free;
  runtime hashes, Node/version assertion, kernel/platform/architecture and isolation identity are
  recorded. Missing/unsupported isolation fails closed; there is no mutable-checkout fallback.
- Evidence lives at `<PIANO_CONFIG>.evidence` (overridable), separately from the registry and Pi
  history. Execution JSON and redacted output use fsync/atomic rename persistence; output is published
  before the terminal record. The saved revision references Phase 7's independent candidate store.
  Retention is explicit: 100 records/workspace, 1000/store, two concurrent jobs/backend, one/workspace,
  256 KiB raw output and a configured deadline up to five minutes. Limits refuse/stop work, not erase
  history. No automatic eviction or candidate garbage collection is introduced.
- Concurrent starts for the same active workspace return the same execution. Cancellation owns the
  process group; backend shutdown cancels, while abrupt loss is reconciled as unknown/interrupted.
  No saved PID is adopted and no external action is replayed. Abandoned execution directories are
  removed at startup. Missing/damaged artifacts and invalid policy/environment observations cannot
  satisfy a criterion; a historical pass remains inspectable without becoming current proof.

## Verification packet

Final tested base: `6cc4087042fb391c9a6bbf4ac9c298fe09d2d266`, plus the staged code/test/configuration-doc
patch at `/tmp/piano-phase8-evidence/tested.patch`:
`7d2824865a4abc7f082f1dca7a12f73f0cc08320531ca502b2d4321edde30781` (SHA-256).
This report and its index/plan links were added afterward and do not change runtime inputs.

Work moved to `/tmp/piano-phase8-worktree` after concurrent reconnect changes appeared in the original
checkout. Those changes were left untouched, then their completed `6cc4087` commit was incorporated
before the final gates below. Earlier exploratory results are not substituted for final integration
verification. Dependencies were installed there using the unchanged lockfile (`npm ci --offline
--ignore-scripts`); no dependency manifests, system packages or hosted assets were changed.

Environment (`environment.log`): Node **24.21.0**, Git **2.43.0**, Worktrunk **0.80.0**, bubblewrap
**0.9.0**, Effect **4.0.0-rc.118**, Pi **1.0.2**, Vite **8.3.1**, agent-browser **0.38.2**. Browser
catalog discovery used `/tmp/piano-phase8-worktree/test/fake-pi.mjs --mode rpc --no-session` via Node;
no model calls. The baseline suite still includes its isolated locked-CLI compatibility checks.

| Gate | Observed outcome / output under `/tmp/piano-phase8-evidence/` |
| --- | --- |
| `npm test` | **57/57 pass**, `tests-integrated.log`. |
| `npm run typecheck` | Pass, `typecheck-integrated.log`. |
| `npm --prefix web run build -- --outDir /tmp/piano-phase8-evidence/build` | Pass, `build-integrated.log`; existing large-chunk warning. No hosted `web/dist` build. |
| `node test/browser-phase8.mjs /tmp/piano-phase8-evidence/browser-integrated` | Pass, `browser-integrated.log`, command/snapshot/screenshot/result records below. |
| `git diff --cached --check` | Pass. |

Three new caller-facing check regressions and an extended revision test protect meaningful uncovered
contracts: coalesced start, real read-only isolated execution, no inherited secret environment/live
ignored dependency/host path, non-shared materialization, damaged blob refusal, real exit pass/fail,
output redaction, cancelled/deadline/overflow/missing-runtime outcomes, persistence/reopen, content and
requirement/check invalidation, missing output, symlink rejection, project-owned policy rejection and
interrupted-record recovery without replay. They use real scratch Git and bubblewrap, not mocked
process success. Existing Pi tests suffice because no Pi protocol behavior changed.

The browser fixture uses isolated HOME/agent/session/registry storage, a throwaway repository and
linked worktree, and scratch backend/UI on loopback **7171/7172**. It observed:

1. Run A, inspect passing output, criterion, workspace and revision.
2. Externally edit A: historical pass becomes stale; rerun fails the criterion on the new revision.
3. Restore source, pass again, remove its artifact: outcome remains passed but validity/evaluation
   become unknown. Change requirement content/version: earlier conclusions become stale.
4. Switch to B: its history starts empty, its failing result names B, and A's results are not relabeled.
5. Reload during an intentionally waiting check: same execution ID/count, then explicit cancellation.
6. Start another waiting check, observe its actual Node/supervisor process tree, **SIGKILL only the
   scratch backend**, restart it with the same evidence store, and inspect unknown/not-resumed with
   unchanged execution count. Old owned isolation/Node processes are gone or exited, not adopted.
7. A 390×844 viewport has no page-width overflow. Closing the inspector leaves the Pi session
   **Not running**, independently of check history.

Browser artifacts: `browser-integrated/{commands.json,result.json,process.log,*.txt,*.png}`. The fixture
removed its scratch worktree/branch, registry, isolated session storage and processes. The earlier
whole-fixture timeout's exact leftover scratch resources were separately removed; only retained
verification output remains. No user's registry, Pi history or running backend was modified.

### Failures retained, not counted as passes

- `checks-initial.log` exposed a real record-read race: atomic replacement unlinks the old open inode
  and changes ctime without changing its bytes. Bounded readers now accept that complete older atomic
  record while still rejecting content mutation. Final module and browser gates cover the reader.
- Early browser attempts overlapped changing reconnect behavior in the original checkout. The fixture
  initially assumed an inspector survived, then assumed it closed; both assumptions are incidental.
  It now observes either retained evidence or reopens a remounted inspector without executing again.
  `browser-initial`, `browser-restart` and `browser-timeout` retain available output; the whole-fixture
  timeout has incomplete diagnostic output and is **not** a recovery pass.
- `browser-isolated-restart` reached recovery/mobile observations but its final agent-browser command
  timed out. `browser-accepted` raced initial evidence loading when looking for Cancel. The final
  fixture waits for the actual observation before selecting controls; no application assertion was
  removed. The complete `browser-verified` and final `browser-integrated` runs passed after those
  fixture corrections, with no application-failure retry policy.

## Review and limits

Manual review checked store authority, content/materialization isolation, retained requirements and
policy ownership, process cancellation/recovery, artifact integrity, bounded output/history and
workspace-scoped browser projection against Phase 8 and INV-01/07–09/13. No independent reviewer or
hostile-sandbox escape/security certification was run. Bubblewrap adds a deliberate system prerequisite;
unsupported hosts fail explicitly rather than claiming current evidence.

The first check type supports captured regular files and the copied Node runtime only. Symlinks,
live ignored/generated dependencies, external configuration, shell/npm execution, mutable apps and
browser checks are unsupported. Requirements are captured operator statements, not live tracker
synchronization. There is one store writer, no CPU/memory sandbox guarantee and no adversarial
same-user protection. Evidence is current **at observation**, refreshed while the inspector is open;
there is no integration gate here. This is bounded criterion evidence, not task completion or
universal INV-13 workflow equivalence across skill collections.

## Activation

Deployment was **not requested or performed**. Activation requires the hosted UI build, a restart of
**`piano.service`**, and browser reload; proxy units need no restart. Only scratch-output builds and
scratch-process restarts were performed. Configure the operator check separately using
[docs/checks.md](../checks.md); policy edits afterward need only a checks refresh. No registry schema
migration is added by Phase 8.
