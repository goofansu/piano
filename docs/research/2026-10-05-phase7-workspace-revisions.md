# Phase 7 — Workspace identity and captured revision/diff

Date: October 5, 2026. Acceptance: **INV-01, INV-07, INV-08**, supported local Git capture scope.
This completes the Phase 7 slice, not the evidence/check/app milestones or universal filesystem isolation.

## Shipped journey

- Registry version 1 assigns persistent workspace IDs to project roots, registered worktrees and
  retained session cwd references. Closing/reopening a project preserves its ID. Original path
  spellings, archived sessions, titles and Pi session references survive; no Pi files are imported
  and discovery does not register terminal sessions.
- An unversioned registry (including the old session-field spelling) is validated before migration.
  Original bytes are backed up beside it as `<config>.pre-v1-<uuid>.bak`, mode 0600. Updates use
  temporary-file/rename persistence before replacing memory. Malformed/unsupported/unreadable data
  stops initialization with recovery guidance instead of resetting to an empty registry. Registry
  symlinks are rejected; point `PIANO_CONFIG` at the actual file rather than replacing a symlink.
- Workspace identity is projected with registered worktrees and session summaries. **Changes** is
  available beside the new-session directory and in the session header. The inspector names its
  workspace path, captured revision, HEAD and branch, and separates staged from unstaged/untracked
  differences. Scope and the full versioned manifest are available on demand.
- Refresh captures the selected workspace only. A saved capture is labeled with its observation time,
  not a current-verification badge. Errors/unsupported/inconclusive outcomes replace the old diff;
  transport failure leaves any previous result explicitly labeled not refreshed. A response for an
  unmounted/older inspector cannot relabel a new workspace. React renders diff text, not raw HTML;
  the existing outbound redaction projection also covers this HTTP result.

## Revision v1 contract

`WorkspaceRevisions.capture(workspace)` hides Git reads, candidate storage, race checks and diff
production. `POST /api/workspace/capture?workspaceId=...` resolves only registered workspace IDs.
The registry stores workspace references, **not manifests, diffs or blobs**.

A revision is `v1-<sha256(JSON.stringify(manifest))>`. The manifest has fixed construction order and
path-sorted entries containing path, canonical Git mode, SHA-256 of raw bytes and byte count:

- base HEAD commit plus the complete captured base tree;
- stage-0 index tree;
- actual working files, including non-ignored untracked files; missing entries represent deletions;
- scope description, exclusions and the sorted ignored-path inventory.

Consequently staging/unstaging changes identity even without changing working bytes; returning to
identical HEAD/index/content/scope restores the same identity. Rebase/commit changes invalidate
conservatively by HEAD. Branch name is observed separately: changing only a branch label does not
change content identity. Executability is Git's owner-executable bit, not a full Unix ACL model.
Symlinks are link bytes/mode, never a dereferenced copy of external contents. Renames appear as
add/delete; binary files retain raw hashes/blobs with Git's binary-difference summary.

The capture reads Git objects directly (batch plumbing), not clean/smudge filters. Git receives no
inherited Git-directory/index/object overrides or global/system configuration; local repository ignore
rules apply. Fsmonitor, external diff and textconv execution are disabled. Candidates are stored
outside the checkout at `<PIANO_CONFIG>.revisions/<revision>/`, or `PIANO_REVISION_STORE` when set:

- `manifest.json`, `diff.json` and SHA-256-named files in `blobs/`;
- private temporary directory, atomically renamed only after a complete capture;
- read-only blob/record files; repeated captures validate existing bytes instead of trusting a
  potentially damaged record;
- diffs generated from temporary trees of **those captured bytes**, never the moving source.

This is a stable, content-addressed, materializable candidate, not a second Git lifecycle backend.
It needs no writes to the source index, repository object store, branch or Worktrunk configuration.
Storage is private because original bytes may contain secrets even when display output is redacted.

### Capture boundary and limits

Capture installs local recursive filesystem watches, checks per-file identity/mode/ctime/mtime
across bounded no-follow reads, repeats the content scan and Git inventory, and rejects observed
changes (including transient ABA edits) before publication. Subsequent live edits cannot change the
saved candidate. This was tested on this Linux local filesystem: it is not a kernel-wide atomic
snapshot, a remote-filesystem guarantee, or protection against adversarial same-user writers.
Read-only modes are not a sandbox; any future execution must validate content again when preparing
its inputs and must not execute directly against mutable shared artifacts.

Supported bounds: 10,000 paths/tree, 8 MiB/file, 64 MiB unique base/index plus working content,
2 MiB/diff output, 30-second active-capture deadline, one capture at a time. Exceeding a bound is an
explicit failure, not truncated proof. Failed/cancelled temporary candidates are removed; hard-crash
cleanup and a candidate-retention/garbage-collection policy remain future evidence-store work.

Conflicts, gitlinks/submodules, sparse/skip-worktree and intent-to-add index entries, special files,
non-UTF-8/unsafe paths, symlinked parent directories and non-root project subdirectories cannot be
claimed exact. Missing/broken/unborn repositories fail explicitly. A non-Git directory remains usable
for chat. No passing verification or approval can be inferred from a successful capture.

Ignored **contents**, external configuration/dependencies, empty directories, timestamps and other
permission bits are excluded explicitly. Ignored-path names are recorded, not their contents. Checks
that need ignored/generated/external inputs must explicitly identify/provision them before execution
or extend the versioned scope. Symlink referents outside the candidate require the same treatment.
Registry aliases keep separate identities/references rather than silently merging Pi history;
physical checkout identity is exposed in capture details. Multiple independent registry writers are
not coordinated by this phase.

## Verification retained

Tested base: `6a4d56126f0805ed61ce311c684fab7506c788eb` plus the complete code/test dirty patch
at `/tmp/piano-phase7-evidence/tested.patch`:
`ba07b0b55d9deaa4f8b34ea4ec3adc499773cb18784fdadbbddc6d095a4161be` (SHA-256).
This report and the plan's observed-slice link were added afterward; they do not change runtime inputs.

Environment: Node **24.21.0**, Git **2.43.0**, Worktrunk **0.80.0**, Effect **4.0.0-rc.118**,
locked Pi **1.0.2**, Vite **8.3.1**. No dependencies changed. Browser catalog probing used
`/home/exedev/piano/test/fake-pi.mjs --mode rpc --no-session` via the current Node executable;
no model calls. The baseline suite also retains the existing isolated locked-CLI fixture checks.

| Check | Observed result / retained output |
| --- | --- |
| `npm test` | **52/52 pass**, `tests-final.log`; includes four new caller-facing registry/capture tests. |
| `npm run typecheck` | Pass, `typecheck-final.log`. |
| `node test/browser-phase7.mjs` | Pass, `browser.log`, browser commands/snapshots/screenshots/result below. |
| `npm --prefix web run build -- --outDir /tmp/piano-phase7-evidence/build` | Pass, `build.log`; existing large-chunk warning. Hosted `web/dist` was not rebuilt. |
| `git diff --cached --check` | Pass. |

New regressions use actual Git and the public Registry/WorkspaceRevisions interfaces. They protect:
backed-up migration/reopen, ID/reference retention, malformed input and failed-write memory rollback;
tracked edits, stage/unstage, unusual untracked names, deletion, executable and symlink changes,
ignored-input scope, damaged stored bytes, exact recapture and actual rebase; conflicts/gitlinks/intent
and a missing repository. A Git process wrapper delegates to real Git while changing/restoring a
source file during diff production: capture returns **inconclusive**, with no published/abandoned
candidate despite identical before/after bytes. It does not replace Git semantics with a mock.

Browser gate used scratch backend/UI on loopback **7171/7172**, isolated HOME/agent/session/config
storage, a throwaway repository and a linked checkout. The migrated registry held two session
references without starting those Pi sessions. Observed:

1. Session A names root A and shows only A's staged content/revision.
2. Session B names checkout B and shows only B's unstaged content/different revision.
3. An external B edit refreshes B's content/identity; an external commit/detached checkout refreshes
   HEAD/branch and shows no changes **in capture scope**.
4. Temporarily removing B's Git marker produces **Capture failed**, no old revision/clean diff;
   restoring it and refreshing recovers.
5. Returning to A preserves A's unchanged revision. The full manifest and scope are inspectable.
6. A 390×844 viewport has no page-width overflow. Reload preserves workspace identity and A's capture
   identity without running or replaying a prompt.

Artifacts: `/tmp/piano-phase7-evidence/browser/{commands.json,result.json,process.log,*.txt,*.png}`.
Earlier attempts remain in `browser-initial/` (an unsupported test-selector syntax stopped the details
step after the core journey passed) and `browser-before-review/` (passing before bounded-read/store
hardening). The initial module check exposed RegistryError's missing human-readable `message`;
that was fixed rather than suppressing the recovery assertion. All final gates passed without retries
masking an application failure.

Review checked migration/authority, path containment, no-follow bounded reads, candidate/diff agreement,
error-state rendering and request cleanup against Phase 7 and INV-01/07/08. Small hardening changes
were followed by the final gates above. No independent reviewer or model-quality trial was run.
Scratch processes, worktree, branch, registry and isolated Pi storage were removed by the fixture;
only evidence output/build artifacts remain. The user's registry and services were not touched.

## Activation

Deployment was **not** requested or performed. To activate this backend/wire/UI change, build the
hosted UI, restart **`piano.service`**, and reload browsers. The proxy units need no restart. Only a
scratch-output build was performed. Registry backup/migration occurs at the next deliberate backend
start; retain that backup for rollback. Checks, applications, evidence evaluation and integration are
still Phases 8 onward, not hidden behind a successful capture.
