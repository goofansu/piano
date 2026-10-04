# piano

Web UI that starts and continues pi sessions across projects and worktrunk worktrees. One piano
session is one pi session; each running session is one `pi --mode rpc` child. Server on Effect
4.0.0-rc.118 (pinned; bump deliberately, the RC line renames APIs), client on React + shadcn/ui.

## Words

Use these in code, UI and prose: **project** (a directory the user added), **worktree** (a checkout
created through piano with `wt`), **session** (one pi session; never "thread"), **registry** (the
config file that is the source of truth for all three; pi's session store is read only for history).

## Direction and guardrails

For architecture and workflow changes, read [docs/README.md](docs/README.md), then the ADR,
development invariants and roadmap it links. Reference affected invariant IDs in implementation PRs.
They are target contracts, not claims that all gaps are fixed. Keep Pi authoritative for history,
Worktrunk authoritative for checkout facts, and evidence outside the registry config. A workspace is
the product context around a project root or worktree; retain the existing code vocabulary above.
On exe.dev, keep the unauthenticated server on loopback behind private authenticated access; follow
[the development handoff](docs/development-on-exe-dev.md).

## Running against the user's instance

The user keeps their own piano running on port 7070 with the real registry. Verify on a scratch
instance and leave theirs alone:

```bash
PIANO_CONFIG=<scratchpad>/piano-config.json PORT=7171 node server/main.ts &
```

Stop only the process you started, by its pid. Register only scratch directories (a throwaway git
repo in the scratchpad) in the scratch registry. When a check creates worktrees or pi session files,
remove them afterwards: `git worktree remove --force` plus `git branch -D` in the scratch repo, and
the session directory under `~/.pi/agent/sessions` whose name encodes the scratch path.

## Verification

Done means observed in the browser through `agent-browser`, with the output kept. Model calls cost
real credits; use short prompts such as "Reply with exactly: X" and read the reply back. Radix
menus and popovers open on pointer events, so open them with `agent-browser click`, not a DOM
`.click()` from `eval`. `npm test` runs the module tests against `test/fake-pi.mjs` and needs no
credentials; run it and `npm run typecheck` before calling a change done.

## Design

`server/PiSessions.ts` is the deep module: `open`, `probe`, and per session `events`, `act`,
`state`, all in the browser's wire vocabulary from `shared/wire.ts`. Add capabilities as new
`SessionAction` or `SessionEvent` variants; everything pi-protocol-specific stays behind that seam.
Tests go through that interface only. Module files are PascalCase after their export; `main.ts` is
the sole entry point.

Two Effect v4 gotchas already paid for: on an upgraded socket, acquire `reader` before `writer`
(the reader performs the handshake and the writer waits on it); and a `forkScoped` fiber must not
`ensuring` on an exit that a later finalizer causes, or shutdown deadlocks.
