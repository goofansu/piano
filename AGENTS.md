# piano

Web UI that starts and continues pi sessions across folders and their worktrees. Server on
Effect 4, client on React + shadcn/ui.

## Words

Name things as [the glossary](docs/glossary.md) does in code, UI and docs: it is the source of
truth for folder, worktree, workspace, project, session, registry and the planned task and evidence
terms. When talking to the user, name what they see in the UI ("Piano's database", not "the
registry").

## Verification

Follow [evidence-based development and testing](docs/testing.md): before changing behavior, name
the claim, the relevant invariant and the smallest useful check. Add a regression test only for a
meaningful failure not already protected, testing observable contracts rather than private helpers
or mock choreography. Documentation-only changes need document/link review, not tests or an app run.

- **Code or dependency changes:** run `npm run typecheck`, `npm run lint` and `npm test`
  (module tests against `test/fake-pi.mjs`, no credentials). All three must pass.
- **Application behavior:** observe the affected journey on a [scratch instance](#scratch-instance)
  and keep the output as PR evidence.
- **UI changes:** list every string, control and action the change adds, from its screenshots,
  and run each through the [quiet UI](docs/quiet-ui.md#checks) checks; take each action once and
  screenshot its answer. The change is done when every listed item passes or is gone.
- **Critical paths** (start a session; open and continue one) live in `test/browser/`; add a
  journey there only for a new critical path. `test/browser/style-shots.mjs` is evidence, not a
  journey: run it before and after a shadcn upgrade, a style change or an edit to the `Piano*`
  wrappers or `index.css` tokens, into two directories, and compare the pairs.
- **Model calls** cost real credits: prompt "Reply with exactly: X" and read the reply back.
- **Transcript rows:** a new row's gutter glyph centres on its first text line. Add the row kind
  to `test/browser/transcript-rows.mjs` and run it; the journey measures every row (see
  [alignment](docs/testing.md#alignment)). Eyeballing a screenshot has missed a 4px offset twice.
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

Before adding or changing UI (a screen, string, control, icon button, component or palette
command), read [Quiet UI](docs/quiet-ui.md): the checks every addition passes and the structure
every pane shares.

## Server

`server/PiSessions.ts` is the deep module: `open`, `probe`, `history` (saved sessions read without
Pi), and per session `events`, `act`, `state`, `commands`, all in the browser's wire vocabulary from
`shared/wire.ts`. Add capabilities as new
`SessionAction` or `SessionEvent` variants; everything pi-protocol-specific stays behind that seam.
Tests go through that interface only. Module files are PascalCase after their export; `main.ts` is
the sole entry point.

Keep filesystem paths out of HTTP URLs, so access logs and proxies never record them. Address a
registered workspace or session by its ID (`?workspaceId=`, `/s/<sessionId>`); send an arbitrary
path, such as a directory that is not registered yet, in a POST JSON body.

## Effect

Before writing Effect code or upgrading Effect packages, read [Effect](docs/effect.md).

## Direction and guardrails

For architecture and workflow changes, read [docs/README.md](docs/README.md), then the ADR,
development invariants and roadmap it links, and cite affected invariant IDs in the PR. The short
form of INV-01: Pi owns history, Git owns repository facts, Worktrunk sits behind the lifecycle
adapter, Piano owns workspace and integration policy.

## Architecture reviews

Before proposing deepening candidates (`/mattpocock-skills:improve-codebase-architecture`), read
[architecture reviews](docs/architecture-reviews.md).

## README

`README.md` holds two guides and nothing else: **Use**, how a user sets up and uses Piano,
and **Develop**, how a developer sets up the project and starts developing. Put reference and
explanation in `docs/` and link to it from the guide that needs it.

## Branches

Develop each new change in a dedicated branch and worktree. A session already assigned the change
in its dedicated worktree performs the work there. Otherwise, use `piano_start_session` when
available to dispatch the change into a new worktree. When unavailable, or when the user asks to
keep the work in the current session, create the worktree with `/worktrunk:wt-switch-create` in
Claude Code or `wt switch -c <branch>` elsewhere (`wt switch -h` lists the options). Run every
later command from that worktree's directory.

A worktree ends in one of two outcomes:

- **Pull request:** once the work passes [Verification](#verification), commit, push and open a
  pull request. Starting the worktree is the request for all three; the user reviews and merges.
- **User's decision:** when the work cannot pass Verification, or the next step is the user's to
  choose (scope, design, a trade-off), stop and ask, naming what stands between the work and its
  pull request.

## Deploy

Rebuild, restart or deploy only when the user asks. On an exe.dev VM, follow
[the shortest deploy path](docs/hosted-development.md#shortest-deploy-path); to update every
machine, the user runs the `sync-exe-dev` skill (user-invoked only). On exe.dev the server has no
authentication: it stays on loopback behind exe.dev private access (INV-11).

## GitHub on exe.dev

Prefix GitHub CLI commands with `GH_HOST=github.int.exe.xyz`. Pass `--repo goofansu/piano` where
supported; `gh repo view` takes `goofansu/piano` as a positional argument. Setup and permission
failures: [exe.dev GitHub integration](https://exe.dev/docs/integrations-github.md).
