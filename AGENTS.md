# AGENTS.md

## Feature granularity

Start new work in the feature that owns the user's task. Create a top-level `features/<name>/`
when you can name a distinct user outcome, the decisions it owns, and a concrete change it can
make independently of neighboring features. Keep steps that routinely change together in the same
feature. A screen can compose several features, and one feature can span browser and server code.

For example, image attachments belong to Sessions because they travel with a message from draft
to transcript. Voice input owns microphone access and transcription, which can evolve independently
of message delivery. Apply the same test when splitting a growing feature. See the
[feature layout](docs/README.md#feature-inventory) for where its code belongs.

## Verification

Follow the [testing policy](docs/testing.md) for every change. Name the claim and prove it with a
check that can go **red**; pick that check from
[what to add and run](docs/testing.md#what-to-add-and-run) and run the
[fresh-context review](docs/testing.md#fresh-context-review) it requires. After opening the PR,
wait for CI with `gh pr checks <number> --watch` and fix failures before reporting the task done.
Use `verify-piano` for scratch instances, and leave the user's real Piano, backend and database
alone (local 7070; exe.dev 8000/8001).

## Document routes

Read the matching entry before working on that surface; follow its linked detail when needed.

| When | Read |
| --- | --- |
| Choosing tests or evidence | [Testing policy](docs/testing.md), [commands and prerequisites](docs/development.md#tests) |
| Finding a feature's owning modules, or verifying its behavior | Browse the [feature directories](features) for source and the [verification map](.agents/skills/verify-piano/map.md#features) for checks |
| Measuring performance | [Benchmarks](docs/performance.md) |
| Naming code, UI or docs | [Glossary](docs/glossary.md); in UI strings use the user's names, such as "Piano's database"; code and docs say "registry" |
| Changing UI, including strings and controls | [Quiet UI](docs/quiet-ui.md), [UI evidence scope](docs/testing.md#ui-evidence-scope), [Linear design language](docs/design-moonstone.md#linear) |
| Writing Effect code or upgrading Effect | [Effect](docs/effect.md) |
| Adding, renaming or moving browser-storage keys | [Browser storage](docs/browser-storage.md) |
| Changing architecture or workflow | [Development direction](docs/README.md), then its ADR and invariants; cite affected invariant IDs in the PR |
| Adding or substantially changing a feature | [Feature verification map](docs/testing.md#feature-verification-map): connect owners and interfaces to tests and browser checks |
| User-authorized exe.dev deployment | [Deployment routes and policy](docs/hosted-development.md): `deploy-exe-dev`, run on the VM itself, installs or updates Piano there. It is user-invoked only; there is no SSH or remote deployment. |
| GitHub setup or permission failure on exe.dev | [GitHub integration](https://exe.dev/docs/integrations-github.md) |

## Code comments

Keep authored source comments to concise notes about concrete hacks, workarounds or compatibility
patches. Name the affected tool/platform and the problem or trigger; include a removal condition or
issue link when known, without inventing one. Judge a comment by necessity and accuracy, not keywords:
no fixed marker is required, and labeling narration a workaround does not justify it.

Preserve required legal notices and functional tooling directives. Give lint/type suppressions a
truthful, concise reason. Let names, types and tests carry module overviews, API explanations and
test narration; what they cannot say follows [Docs](#docs). Leave upstream/vendor comments intact.

## Docs

Write feature READMEs and their linked feature topics for people using Piano. Describe tasks, visible controls, outcomes, and limits that affect a user’s decision. Keep maintainer decisions, benchmarks, and verification instructions in the development docs and verification recipes.

If a type, lint rule or test can enforce a rule, enforce it there instead of documenting it. Write
docs only for what code cannot explain: a decision and its reason, a contract others rely on, a
gotcha. When behavior changes, correct or delete the doc lines it made false.

## Safeguards

Keep Pi protocol details behind `features/sessions/server/pi/PiSessions.ts`. Extend its public contract through
`SessionAction`/`SessionEvent` in `shared/wire.ts`; test through that contract.
Name server modules in PascalCase after their export, except a feature's re-export-only `server/index.ts`;
`main.ts` is the sole server entry point.

Use workspace/session IDs in URLs, never filesystem paths. Send arbitrary paths in POST JSON bodies
to keep them out of URL logs.

Bound every reply the server reads from outside itself (a provider, an MCP endpoint) with a
byte limit and a deadline. Size the limit against the largest real reply, with room to grow.

Rebuild, restart or deploy the user's running Piano only when asked; coding, committing and pushing
do not authorize it. Piano has no application authentication: on exe.dev keep it on loopback behind
private authenticated access (INV-11).

## Branches

- For a new implementation task, investigate here first, then use `piano_start_session` to dispatch
  into a dedicated worktree when available. Give the child the observed problem, scope and acceptance
  check. Explicitly delegated research may start directly in a child.
- Implement directly only when this session already owns the task in its dedicated worktree, the
  user requests it, or dispatch is unavailable.
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
