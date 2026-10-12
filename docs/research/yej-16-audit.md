# YEJ-16: dependency audit policy and triage

## Capture

2026-10-12, Node 24.21.0, npm 11.19.0, Linux. Initial reports at
`2c23cb07ed9206bc08550e65913e37c3ce8896fe`; repeated at
`1f3a5dd91f9cb67f7a66d67a76e94bca56b83960` with this policy change.
The intervening commit changes only MCP logos; dependency manifests and lockfile are unchanged.

Retained reports: [full before](yej-16-audit/full-before.json),
[production before](yej-16-audit/prod-before.json),
[full after](yej-16-audit/full-after.json),
[production after](yej-16-audit/prod-after.json),
[installed paths](yej-16-audit/dependency-paths.txt).
Commands: `npm audit --json`, `npm audit --omit=dev --json`, and `npm ls` for the affected packages.
Full audit exits 1 (seven high package findings); production exits 0 (no findings).

## Advisory-by-advisory decision

There is **one distinct advisory**, not seven distinct vulnerabilities:
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
stack-exhaustion denial of service from deeply nested brace patterns, affecting braces <=3.0.3.
Installed braces is 3.0.3. `npm view braces version` also returns 3.0.3; no patched release is
available from the configured registry at capture time.

Paths (all development tooling):

- web → shadcn 4.21.3 → fast-glob 3.3.3 → micromatch 4.0.8 → braces 3.0.3.
- shadcn → @shadcn/registry 0.1.2 → fast-glob (same resolved installation).
- shadcn and @shadcn/registry → ts-morph 26.0.0 → @ts-morph/common 0.27.0 → fast-glob.

The other six findings (micromatch, fast-glob, @ts-morph/common, ts-morph,
@shadcn/registry and shadcn) propagate that same advisory. Production audit has no finding;
this does not prove the absence of all production vulnerabilities. The reported chain is the
component generator, not a browser-request handler. A hostile glob supplied during component
or registry tooling could exhaust that local tooling process. Private authenticated deployment
is not a defense for developer tooling processing hostile inputs. Treat registry/configuration
inputs as trusted code; do not run generators on unreviewed third-party configurations.
Normal application build/lint does not invoke the shadcn generator, but the full development
installation still contains the vulnerable package.

npm proposes shadcn 1.0.0 (a major-version downgrade) as its fix. Do not take that downgrade:
it changes the component-management tool's contract and is not a compatible braces patch.
The current shadcn 4.21.4 metadata still depends on fast-glob ^3.3.3 and ts-morph ^26.0.0;
an unrelated patch upgrade would not remove this chain. No dependency or Effect version changes
are justified by this report; no force fix or lockfile rewrite was applied.

## Enforcement and exception

`npm run audit:check` runs both audits and retains raw reports under ignored `audit-reports/`.
The existing **Quality gates** CI job runs it after clean installation, preserving PR, main-push,
merge-group coverage, read-only permissions and credential-free checkout.

- Production: fail on every high or critical finding, with no exceptions.
- Full tree: fail on high or critical advisory leaves except the exact braces advisory above,
  at high severity and affected range <=3.0.3, until **2026-11-12 00:00 UTC**.
- The exception cannot apply to production, another advisory, a changed affected range or a
  severity escalation. Its expiry automatically fails the gate while the finding remains.
- Low/moderate findings remain in reports for triage; they are not blocking at this stage.
- Registry/network failures and unsupported/missing reports fail closed, not as a clean audit.

Review sooner when braces publishes a patch, the dependency path changes, shadcn changes its
parser, or these inputs become reachable from untrusted application requests. The owner must
review any exception renewal explicitly; do not extend it merely to obtain green CI.
This narrowly accepts a development-only availability risk for one month, not arbitrary future
high findings. No global full-tree gate deferral is needed.

Tests exercise the recorded seven-package report, production rejection, exact expiry,
new advisories, severity escalation and invalid reports. This is build-policy-only; application
behavior and runtime dependencies do not change, so no browser journey is implicated.
Verification on the base revision plus this policy diff: `npm run audit:check` passed both
scopes under the policy; `npm test` passed 385/385 with no skips; `npm run typecheck` and
`npm run lint` passed. `git diff --check` passed. Detailed local command output is retained in
`/tmp/piano-issue-audit/{tests,typecheck,lint}.log` (ephemeral).
Relevant contracts: INV-09 (bounded verification claim), INV-11 (trust boundary).

YEJ-17 remains a separate owner blocker: passing this CI job does not establish merge enforcement.
