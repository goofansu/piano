# AGENTS.md

## Verification

Before changing behavior, name the claim, relevant invariant and smallest check that could disprove
it. Inspect existing coverage first. Add a regression test only for a meaningful failure that is not
already protected; test observable contracts, not private helpers or mock choreography. For a bug,
reproduce it before fixing it when feasible, then show the same check passing.

### What to add and run

| Change | Verification |
| --- | --- |
| Documentation or comments only | Review accuracy, links and the diff; confirm no runtime or tooling directives changed. No tests or app run needed. |
| Logic, protocol or lifecycle behavior | Add or extend a focused module test for an uncovered failure at the public boundary. Run `node --test --import ./test/setup.ts test/<name>.test.ts`. |
| Application behavior | Observe the affected journey on scratch Piano, using an existing browser journey or a focused `agent-browser` check. Module tests alone do not prove the user journey. |
| UI strings, controls or styling | Apply Quiet UI and choose evidence using the [UI evidence scope](docs/testing.md#ui-evidence-scope): a focused capture for a local cosmetic edit, the affected journey for behavior, broader comparisons for shared styles. |
| New critical path | Add a journey in `test/browser/`; otherwise extend relevant existing coverage rather than adding another browser journey. |
| New transcript row kind | Extend and run `node test/browser/transcript-rows.mjs <evidence-directory>`. Its gutter glyph must centre on the first text line; a screenshot alone is insufficient. |

For **code or dependency changes**, run `npm run verify -- <evidence-directory>`: typecheck, lint
and the full module suite must all pass. It uses fake Pi and needs no model credentials. Focused
checks do not replace this baseline, and the baseline does not run browser journeys. Run an affected
journey with `node test/browser/<journey>.mjs <evidence-directory>`; `npm run test:browser` runs the
committed suite. Use the table above to choose the check, not every journey by default.

Keep local verification output under `~/piano-evidence/`, using the
[evidence directory convention](docs/testing.md#evidence-directories) before running checks.
Retain actual command/browser output on the PR, outside Git, tied to the tested revision and
environment. Report pass/fail, skipped or blocked checks, and limitations. Never weaken assertions
to make a change green. Stop once the claim and relevant risk are covered and required gates pass.

### Scratch instance

Use `verify-piano` for scratch launch, doctor, browser checks, evidence and cleanup. Committed
browser journeys own their scratch setup; do not launch another instance beside them. Leave the
user's real Piano, backend and database alone (local 7070; exe.dev 8000/8001).

Radix menus/popovers open on pointer events: use `agent-browser click`, not DOM `.click()` in `eval`.
Prefer fake Pi; when a real model call is needed, prompt "Reply with exactly: X" and read it back.

## Document routes

Read the matching entry before working on that surface; follow its linked detail when needed.

| When | Read |
| --- | --- |
| Choosing tests or evidence | [Testing policy](docs/testing.md), [commands and prerequisites](docs/development.md#tests) |
| Finding a feature's owning modules, or verifying its behavior | The [feature map](.agents/skills/verify-piano/features/README.md#features) links each feature's recipe and owning doc; [verify-piano](.agents/skills/verify-piano/SKILL.md) launches and drives scratch Piano |
| Measuring performance | [Benchmarks](docs/performance/README.md) |
| Naming code, UI or docs | [Glossary](docs/glossary.md); in UI strings use the user's names, such as "Piano's database"; code and docs say "registry" |
| Changing UI, including strings and controls | [Quiet UI](docs/quiet-ui.md), [UI evidence scope](docs/testing.md#ui-evidence-scope), [Linear design language](docs/design-moonstone.md#linear) |
| Writing Effect code or upgrading Effect | [Effect](docs/effect.md) |
| Adding, renaming or moving browser-storage keys | [Browser storage](docs/browser-storage.md) |
| Changing architecture or workflow | [Development direction](docs/README.md), then its ADR, invariants and roadmap; cite affected invariant IDs in the PR |
| Adding or substantially changing a feature | [Feature verification map](docs/testing.md#feature-verification-map): connect owners and interfaces to tests and browser checks |
| Proposing module-deepening candidates | [Architecture reviews](docs/architecture-reviews.md) |
| User-authorized exe.dev deployment | [Deployment routes and policy](docs/hosted-development.md): `deploy-exe-dev` provisions a new VM; `sync-exe-dev` updates all tagged VMs. Both skills are user-invoked only. |
| GitHub setup or permission failure on exe.dev | [GitHub integration](https://exe.dev/docs/integrations-github.md) |

## Code comments

Keep authored source comments to concise notes about concrete hacks, workarounds or compatibility
patches. Name the affected tool/platform and the problem or trigger; include a removal condition or
issue link when known, without inventing one. Judge a comment by necessity and accuracy, not keywords:
no fixed marker is required, and labeling narration a workaround does not justify it.

Preserve required legal notices and functional tooling directives. Give lint/type suppressions a
truthful, concise reason. Keep module overviews, API explanations and test narration in the owning
docs rather than source comments. Leave upstream/vendor comments intact.

## Safeguards

Keep Pi protocol details behind `server/PiSessions.ts`. Extend its public contract through
`SessionAction`/`SessionEvent` in `shared/wire.ts`; test through that contract.
Name server modules in PascalCase after their export; `main.ts` is the sole entry point.

Use workspace/session IDs in URLs, never filesystem paths. Send arbitrary paths in POST JSON bodies
to keep them out of URL logs.

Rebuild, restart or deploy the user's running Piano only when asked; coding, committing and pushing
do not authorize it. Piano has no application authentication: on exe.dev keep it on loopback behind
private authenticated access (INV-11).

## Branches

- Investigate before dispatching implementation; give the child the observed problem, scope and
  acceptance check. Explicitly delegated research may start directly in a child.
- Use a dedicated branch and worktree; reuse the one already assigned to the task. Run subsequent
  commands from that worktree.
- Before creating a worktree, fetch `origin` and base it on `origin/main` unless the task explicitly
  requires another base.
- Complete worktree tasks by passing [Verification](#verification), committing, pushing and opening
  a PR for the user's review and merge. If checks cannot pass or the next step needs a user decision,
  stop and ask, naming the blocker.

## GitHub on exe.dev

Prefix GitHub CLI commands with `GH_HOST=github.int.exe.xyz`. Pass `--repo goofansu/piano` where
supported; `gh repo view` takes `goofansu/piano` as a positional argument.
