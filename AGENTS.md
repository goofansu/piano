# AGENTS.md

## Feature granularity

Start new work in the feature that owns the user's task. Create a top-level `features/<name>/`
when you can name a distinct user outcome, the decisions it owns, and a concrete change it can
make independently of neighboring features. Keep steps that routinely change together in the same
feature. A screen can compose several features, and one feature can span browser and server code.

For example, image attachments belong to Sessions because they travel with a message from draft
to transcript. Voice input owns microphone access and transcription, which can evolve independently
of message delivery. Apply the same test when splitting a growing feature. See the
[feature layout](docs/development.md#feature-inventory) for where its code belongs.

## Verification

Follow the [testing policy](docs/testing.md) for every change, using its
[commands and prerequisites](docs/development.md#tests). Name the claim and prove it with a
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
| Finding a feature's owning modules, or verifying its behavior | Browse the [feature directories](features) for source and the [verification map](.agents/skills/verify-piano/map.md#features) for checks |
| Measuring performance | [Benchmarks](docs/performance.md) |
| Changing UI, including strings and controls | [UX](docs/ux.md), [UI](docs/ui.md) |
| Writing Effect code or upgrading Effect | [Effect](docs/effect.md) |
| Adding, renaming or moving browser-storage keys | [Browser storage](docs/development.md#browser-storage) |
| Changing architecture or workflow | [Architecture](docs/development.md#architecture), then its ADR and invariants; cite affected invariant IDs in the PR |
| User-authorized exe.dev deployment | The user-invoked [deploy-exe-dev](.agents/skills/deploy-exe-dev/SKILL.md) skill, run on the VM itself, installs or updates Piano there. There is no SSH or remote deployment. |

## Code comments

Write no comments in code. Keep only functional directives a tool reads, such as
`oxlint-disable-next-line`, `@ts-expect-error`, `/// <reference>` and `# shellcheck`, without a
reason. Let names, types and tests carry what a comment would say; a script describes its usage,
options and environment in `--help` output. What none of these can say follows [Docs](#docs).
Leave vendored code alone.

## Docs

Write feature READMEs and their linked feature topics for people using Piano. Describe tasks, visible controls, outcomes, and limits that affect a user’s decision. Keep maintainer decisions, benchmarks, and verification instructions in the development docs and verification recipes.

If a type, lint rule or test can enforce a rule, enforce it there instead of documenting it. Write
docs only for what code cannot explain: a decision and its reason, a contract others rely on, a
gotcha. When behavior changes, correct or delete the doc lines it made false.

Keep research notes out of Git: write them under `${TMPDIR:-/tmp}/piano-research/` and link the
findings from the issue or PR. Record a lasting decision as an ADR and a user-facing fact in the
owning feature's docs.

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

## Agent skills

### Issue tracker

Issues and specs live as local markdown under the gitignored `.scratch/<feature>/`. See
[issue tracker](docs/agents/issue-tracker.md).

### Triage labels

The five default triage roles, recorded as a `Status:` line in each issue file. See
[triage labels](docs/agents/triage-labels.md).

### Domain docs

Single-context: root [`GLOSSARY.md`](GLOSSARY.md) and [`docs/adr/`](docs/adr). See
[domain docs](docs/agents/domain.md).
