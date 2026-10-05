# Configured checks (Phase 8)

Piano can run one operator-configured **Node ES module check per project**, against a saved
workspace revision. **Checks** is in the session menu and beside the new-session directory.
Run a check, inspect its output/revision, edit the workspace and inspect the now-stale result.
Checks do not start Pi, settle a session, complete a task or authorize integration.

## Configure a bounded claim

Create `<PIANO_CONFIG>.checks.json` beside, **not inside**, the checkout. With the default registry
this is `~/.config/piano/config.json.checks.json`. `PIANO_CHECK_CONFIG` overrides the path.
Use a private file (0600); do not put credentials in scripts or requirement descriptions.
The server rereads configuration on run/refresh; configuration changes need no restart.
Use the exact registered project path, including for that project's worktrees.

Example: a useful dependency-free package metadata gate. Save JSON like this, replacing the project
path and recording your actual requirement. The module throws or exits nonzero to fail.

```json
{
  "version": 1,
  "projects": [{
    "project": "/absolute/project/path",
    "check": {
      "id": "package-contract",
      "name": "Package metadata",
      "version": "1",
      "task": {
        "id": "package-release",
        "source": "human:release requirements",
        "version": "1",
        "content": "Publish an ES module package with an explicit test command."
      },
      "criterion": {
        "id": "package-metadata",
        "version": "1",
        "content": "package.json declares type=module and a nonempty scripts.test."
      },
      "timeoutMs": 10000,
      "script": "import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'; const p=JSON.parse(readFileSync('package.json','utf8')); assert.equal(p.type,'module'); assert.ok(p.scripts?.test?.trim()); console.log('Package metadata assertions passed');"
    }
  }]
}
```

Task and criterion IDs, captured content/version and original source are required but have no
prescribed issue tracker or document template. A reference is a captured operator statement, **not**
a live issue/document synchronization service: update the captured requirement when its source changes.
The script, timeout, check version and all requirement fields form the configuration digest.
Changing any of them invalidates prior conclusions even with unchanged source files.

Policy is outside the candidate and there is no agent/session action to edit it or award acceptance.
Do not delegate an authoritative gate to mutable project tests without reviewing that delegation:
passing a script that only prints "verified" proves nothing beyond that configured claim. This first
slice has no required-gate catalog, task-wide readiness or integration permission. An unrestricted
same-user shell can still edit the operator file; this is **not** an authorization boundary.

## Supported execution inputs

This first check type deliberately supports only:

- Phase 7's captured regular working files (tracked and non-ignored untracked), with their raw bytes
  and executable bits. Base HEAD and index remain part of conservative revision identity.
- The operator's ES module, independent of editable project policy files.
- A copied Node executable and its resolved Linux loader/shared libraries. Their actual byte hashes,
  Node version, kernel, platform, architecture, environment policy and bubblewrap identity are recorded.
- Fixed environment: `PATH=/runtime`, `HOME=/tmp`, `LANG=C`, `TZ=UTC`. No inherited developer environment,
  credentials, `NODE_OPTIONS`, global Node modules, shell, network or home-directory configuration.

The runtime requires **Linux, bubblewrap 0.9.0, usable user/PID/network namespaces and `/usr/bin/ldd`**.
The installed Node must have the supported `/lib*` loader/library layout. Default isolation executable
is `/usr/bin/bwrap`; `PIANO_BWRAP` is an operator override and must still satisfy the version contract.
A missing/unsupported runtime or setup failure is an error, never a mutable-checkout fallback.

Every execution revalidates saved blob hashes and copies bytes into a new private directory. No
hardlinks or shared dependency mounts are used. Bubblewrap mounts that execution root read-only;
`/workspace` is the cwd, `/runtime/node /check.mjs` loads the captured `/policy.mjs`, and `/tmp` is a
fresh 64 MiB writable tmpfs. A private PID namespace and parent-death handling bound owned process
lifetime. Normal backend shutdown cancels active checks; abrupt loss yields **unknown/interrupted**
on restart, not resumed work. Refresh/disconnect does not cancel or replay a check.

**Unsupported:** live `node_modules`, package installation, external/ignored config or generated
inputs, symlinks (including internal links in this initial implementation), mutable apps, shell/npm
commands and browser checks. Vendor needed regular files into capture scope or wait for an explicitly
provisioned dependency check type. A command referencing an absent input fails; its success does not
claim to have checked excluded inputs. Do not add host-directory mounts as an availability shortcut.
Read-only execution also rejects tools that write generated output into the source tree; use `/tmp`.

This isolation prevents ordinary live-workspace edits, including transient edits, from changing check
inputs. It is not a general hostile-code sandbox, memory/CPU quota, deterministic-clock guarantee or
protection from privileged/adversarial same-user host writers. No remote-product security claim is made.

## History, validity and retention

The separate evidence store defaults to `<PIANO_CONFIG>.evidence/`; override with
`PIANO_EVIDENCE_STORE`. It must be outside the checked workspace. One backend owns each store; do not
point concurrent Piano backends at it. It contains private atomic execution JSON and redacted
`<execution-id>.output.txt` artifacts, not registry fields or Pi messages. JSON retains the original
operator definition and raw provenance; browser projection uses Piano's usual heuristic redaction.
Whole-output redaction handles secrets split between chunks; it is not credential containment.

Record publication uses file fsync, rename and parent-directory fsync. Output is published before the
terminal execution record. A crash between writes leaves an interrupted/unknown record, never an
invented pass. Startup removes abandoned `.run-*` directories and marks running records unknown.
Malformed/unreadable evidence is an explicit recovery failure; it is not reset. Restore a known-good
backup or repair/archive the store while the backend is stopped.

Historical **outcome** is independent of **validity** and **criterion evaluation**:

- `pass` / `fail`: actual exit zero/nonzero from the started configured Node command.
- `cancelled`, `error` (setup/spawn/signal/deadline/output limit), `unknown` (interrupted) do not satisfy
  the criterion. A running record has no conclusion.
- `current` means matching content, requirements/check policy and runtime **at the displayed observation
  time**, with an available, hash-matching artifact. A current failing check is still a failure.
- `stale` retains its historical outcome but cannot satisfy the current criterion.
- `unknown` covers missing/damaged artifacts, unsupported inputs, observation failure and incomplete
  execution. A transport failure disables reliance on the old browser projection.

While the inspector is open it refreshes every three seconds, starting the next refresh only after the
previous observation completes. Git capture failure is visible. Returning to byte-identical content,
HEAD/index and configuration restores identity; there is no content-equivalence shortcut for commits.
Refresh after external changes before relying on a result. No automatic retry or run is performed.

Bounds: two concurrent checks per backend, one per workspace, 100 executions per workspace and 1000
per store; 100–300000 ms configured execution deadline; 256 KiB raw combined stdout/stderr. Exceeding
output stops execution with an error and retains the incomplete prefix. Output is retained at completion,
not streamed. Reaching record limits blocks new runs rather than silently deleting evidence. Redaction
can expand the stored prefix. Current UI returns retained history and output (bounded by these limits).

Keep records and matching artifacts together when explicitly archiving them. No automatic eviction,
compression, multi-process store coordination or candidate garbage collection is provided. Phase 7's
revision store remains separate and retains manifests/blobs/diffs; deleting a referenced candidate
prevents future materialization but does not rewrite an already recorded historical execution. Keep
both stores private and back them up independently of the registry.

Activation of the code requires a UI build, `piano.service` restart and browser reload. Changing an
existing operator check definition requires only a checks refresh. Proxy units need no restart.
See [the phase plan](vertical-slice-plan.md#phase-8--run-one-configured-check-and-retain-bounded-evidence)
and [the invariant contracts](development-invariants.md) (INV-01, INV-07–09, INV-13).
