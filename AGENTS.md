# piano

Web UI that starts and continues pi sessions across projects and worktrunk worktrees. One piano
session is one pi session; each running session is one `pi --mode rpc` child. Server on Effect
4.0.0-rc.118 (pinned; bump deliberately, the RC line renames APIs), client on React + shadcn/ui.

## Words

Use these in code, UI and prose: **project** (a directory the user added), **worktree** (a checkout
created through piano with `wt`), **session** (one pi session; never "thread"), **registry** (the
config file that records selected projects, worktrees and session references; Pi owns session history).
See [the glossary](docs/glossary.md) for the planned workspace, task and evidence vocabulary.

## Direction and guardrails

For architecture and workflow changes, read [docs/README.md](docs/README.md), then the ADR,
development invariants and roadmap it links. Reference affected invariant IDs in implementation PRs.
They are target contracts, not claims that all gaps are fixed. Keep Pi authoritative for history,
Git authoritative for repository facts, Worktrunk behind the lifecycle adapter, and evidence outside
the registry config. Piano owns workspace and integration policy. Skills guide development without
defining product requirements or verification truth. A workspace is
the product context around a project root or worktree; retain the existing code vocabulary above.
On exe.dev, keep the unauthenticated server on loopback behind private authenticated access; follow
[the development handoff](docs/development-on-exe-dev.md).

## Running against the user's instance

The user's systemd instance serves the built UI on port 8000 through the backend on 8001
with the real registry (local instances may use 7070). Verify in separate scratch processes:

```bash
HOST=127.0.0.1 PIANO_CONFIG=<scratchpad>/piano-config.json PORT=7171 node server/main.ts &
PIANO_DEV_BACKEND=http://127.0.0.1:7171 npm run dev:web -- --host 127.0.0.1 --port 7172 --strictPort &
```

Use `npx agent-browser` against the scratch development UI on 7172, not the user's built UI.
Leave the real registry and running backend alone. Rebuild/deploy only when requested; see
[the hosted workflow](docs/hosted-development.md).

**Deploy preference:** When explicitly asked to deploy, complete the build/install steps and restart
`piano.service` promptly, even if it cuts off this session and other active Pi work. Interruption is
preapproved: do not wait for idle or request extra confirmation. Run the restart and health checks
outside `piano.service`'s process tree so deployment survives the cutoff.

Stop only the process you started, by its pid. Register only scratch directories (a throwaway git
repo in the scratchpad) in the scratch registry. When a check creates worktrees or pi session files,
remove them afterwards: `git worktree remove --force` plus `git branch -D` in the scratch repo, and
the session directory under `~/.pi/agent/sessions` whose name encodes the scratch path.

## Verification

Develop Piano using [evidence-based development and testing](docs/testing.md). Before changing
behavior, identify the claim, relevant invariant and smallest useful check. Add a regression test
only for a meaningful failure not already protected; test observable contracts, not private helpers,
mock choreography or implementation shape. No coverage quota or one-test-per-function requirement.
Documentation-only changes need document/link review, not new unit tests or an application run.

For application behavior changes, observe the affected journey through `npx agent-browser`, with output
kept. Model calls cost real credits; use short prompts such as "Reply with exactly: X" and read the
reply back. Radix
menus and popovers open on pointer events, so open them with `agent-browser click`, not a DOM
`.click()` from `eval`. `npm test` runs the module tests against `test/fake-pi.mjs` and needs no
credentials; run it and `npm run typecheck` for code or dependency changes. Retain command outcomes,
tested revision/environment and limitations. Stop expanding verification once the relevant risk is
covered and required gates pass; explain when existing tests or inspection suffice.

## Phase completion

After a phase passes its required verification and review, commit its changes and push the current
branch to its upstream. Report the commit and push outcome; a blocked push is not completion.
Pushing changes does not authorize rebuilding or deploying the user's instance.
Every work summary must state whether a restart is needed, which services are affected, any separate
build/browser-reload requirement, and whether those steps were performed. State "no restart needed"
for documentation-only changes.

## Design

Keep correctness in authoritative state handling and regression checks, not permanent protocol
caveats in the UI. Follow Codex/T3 Code's quiet interaction pattern: normal controls and concise
status in the main view, optional metadata on demand, persistent warnings for actionable problems.

`server/PiSessions.ts` is the deep module: `open`, `probe`, and per session `events`, `act`,
`state`, all in the browser's wire vocabulary from `shared/wire.ts`. Add capabilities as new
`SessionAction` or `SessionEvent` variants; everything pi-protocol-specific stays behind that seam.
Tests go through that interface only. Module files are PascalCase after their export; `main.ts` is
the sole entry point.

Two Effect v4 gotchas already paid for: on an upgraded socket, acquire `reader` before `writer`
(the reader performs the handshake and the writer waits on it); and a `forkScoped` fiber must not
`ensuring` on an exit that a later finalizer causes, or shutdown deadlocks.
