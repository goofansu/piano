# piano

## Words

Use [the glossary](docs/glossary.md) for names in code, UI and docs. When talking to the user,
name what they see in the UI ("Piano's database", not "the registry").

## Code comments

Keep authored source comments to concise notes about concrete hacks, workarounds or compatibility
patches. Name the affected tool/platform and the problem or trigger; include a removal condition or
issue link when known, without inventing one. Judge a comment by necessity and accuracy, not keywords:
no fixed marker is required, and labeling narration a workaround does not justify it.

Preserve required legal notices and functional tooling directives. Give lint/type suppressions a
truthful, concise reason. Keep module overviews, API explanations and test narration in the owning
docs rather than source comments. Leave upstream/vendor comments intact.

## Verification

Before changing behavior, name the claim, relevant invariant and smallest useful check. Follow
[the testing policy](docs/testing.md) for regression tests and evidence. Documentation-only changes
need document/link review, not tests or an app run.

- **Code or dependency changes:** run `npm run verify`, the thin wrapper over `npm run typecheck`,
  `npm run lint` and `npm test` (module tests against `test/fake-pi.mjs`, no credentials). All three
  must pass; focused checks and browser journeys remain explicit ([commands](docs/development.md#tests)).
- **Application behavior:** observe the affected journey on a [scratch instance](#scratch-instance)
  and keep the output as PR evidence.
- **UI changes:** apply the [quiet UI checks](docs/quiet-ui.md#checks) and choose evidence using
  [UI evidence scope](docs/testing.md#ui-evidence-scope).
- **Critical paths** (start a session; open and continue one) live in `test/browser/`; add a
  journey there only for a new critical path.
- **Model calls** cost real credits: prompt "Reply with exactly: X" and read the reply back.
- **Transcript rows:** a new row's gutter glyph centres on its first text line. Add the row kind
  to `test/browser/transcript-rows.mjs` and run it; the journey measures every row (see
  [alignment](docs/testing.md#alignment)); a screenshot alone is insufficient.
- **Radix menus and popovers** open on pointer events: use `agent-browser click`, not a DOM
  `.click()` from `eval`.

Report command outcomes, the tested revision and environment, and limitations. Stop once the
relevant risk is covered.

### Scratch instance

The user's own Piano (local on 7070; on exe.dev the systemd units on 8000/8001) runs on their real
database: leave it, its backend and its database alone. Verify on a scratch instance that the
`verify-piano` skill launches, drives and tears down.

## Design

Follow Linear's design and interaction language (see [the Linear notes](docs/design-moonstone.md#linear)
and Linear's [agent interaction guidelines](https://linear.app/developers/aig)); Codex and T3 Code
remain references for the web harness around Pi, not for how Piano looks.

Before adding or changing UI, including strings and controls, read [Quiet UI](docs/quiet-ui.md).

## Server

Keep Pi protocol details behind `server/PiSessions.ts`. Extend its public contract through
`SessionAction`/`SessionEvent` in `shared/wire.ts`; test through that contract.
Name modules in PascalCase after their export; `main.ts` is the sole entry point.

Use workspace/session IDs in URLs, never filesystem paths. Send arbitrary paths in POST JSON bodies
to keep them out of URL logs.

## Effect

Before writing Effect code or upgrading Effect packages, read [Effect](docs/effect.md).

## Browser storage

Before adding, renaming or moving a `localStorage` or `sessionStorage` key, read
[browser storage](docs/browser-storage.md).

## Direction and guardrails

For architecture and workflow changes, read [docs/README.md](docs/README.md), then the ADR,
development invariants and roadmap it links, and cite affected invariant IDs in the PR. The short
form of INV-01: Pi owns history, Git owns repository facts, Worktrunk sits behind the lifecycle
adapter, Piano owns workspace and integration policy.

### Feature locality

For a new or substantially changed feature, group what genuinely changes together within its
runtime behind a small interface; preserve `web → shared ← server`. Give it one obvious starting
place: a `docs/<feature>.md` page naming the owning modules per runtime, their exposed interface,
module tests, and the `verify-piano` feature entry / browser journey. Link that page from the
feature’s entry in the [verification map](.agents/skills/verify-piano/features/README.md#features).
This is not a folder migration and does not apply retroactively.

## Architecture reviews

Before proposing module-deepening candidates, read [architecture reviews](docs/architecture-reviews.md).

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

## Deploy

Rebuild, restart or deploy only when the user asks. On an exe.dev VM, follow
[the shortest deploy path](docs/hosted-development.md#shortest-deploy-path); to update every
machine, the user runs the `sync-exe-dev` skill (user-invoked only). On exe.dev the server has no
authentication: it stays on loopback behind exe.dev private access (INV-11).

## GitHub on exe.dev

Prefix GitHub CLI commands with `GH_HOST=github.int.exe.xyz`. Pass `--repo goofansu/piano` where
supported; `gh repo view` takes `goofansu/piano` as a positional argument. Setup and permission
failures: [exe.dev GitHub integration](https://exe.dev/docs/integrations-github.md).
