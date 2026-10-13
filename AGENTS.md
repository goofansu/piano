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

- **Code or dependency changes:** before committing, run `npm run typecheck` and `npm test`
  (module tests against `test/fake-pi.mjs`, no credentials); the pre-commit hook runs lint. Commit
  only when all three pass.
- **Application behavior:** observe the affected journey through `npx agent-browser` on a
  [scratch instance](#scratch-instance) and keep the output as PR evidence; the browser script
  stays uncommitted.
- **Critical paths** (start a session; open and continue one) live in `test/browser/`; add a
  journey there only for a new critical path.
- **Model calls** cost real credits: prompt "Reply with exactly: X" and read the reply back.
- **Radix menus and popovers** open on pointer events: use `agent-browser click`, not a DOM
  `.click()` from `eval`.

Report command outcomes, the tested revision and environment, and limitations. Stop once the
relevant risk is covered.

### Scratch instance

The user's own Piano (local on 7070; on exe.dev the systemd units on 8000/8001) uses the real
registry. Leave it, its backend and its registry alone, and verify in scratch processes:

```bash
HOST=127.0.0.1 PIANO_ALLOWED_ORIGINS=http://127.0.0.1:7172,http://localhost:7172 PIANO_DB_PATH=<scratchpad>/piano.db PORT=7171 node server/main.ts &
PIANO_DEV_BACKEND=http://127.0.0.1:7171 npm run dev:web -- --host 127.0.0.1 --port 7172 --strictPort &
```

Drive the scratch UI on 7172. A new scratch database starts empty; register only a throwaway git
repo in the scratchpad. Stop only the processes you started, by pid. When a check creates
worktrees or pi session files, remove them afterwards: `git worktree remove --force` plus
`git branch -D` in the scratch repo, and the directory under `~/.pi/agent/sessions` whose name
encodes the scratch path.

## Committing

After a change passes verification, commit it on the branch that is checked out (usually `main`)
and push that branch. Stay on that branch; create or switch branches only when the user asks.
Report the commit and push outcome; a blocked push is not completion.

## Design

Follow Codex/T3 Code's **quiet UI**: show only what helps users decide or act — useful values,
essential controls, concise status. Internal state and diagnostics go in on-demand details, if
anywhere. Show a persistent warning only for a problem the user can act on; keep correctness in
state handling and regression checks.

Build UI from shadcn/ui components (the `shadcn` skill: search the registry, add with
`npx shadcn@latest add`). Hand-written markup is for the case where no standard component exists,
and says so in a comment. `web/src/components/ui/` stays upstream-owned: Piano's variants, overlay
styling and focus policy live in the `Piano*` wrappers, `StatusBadge` and `PickerRadioItem` in
`web/src/components/`, and tokens in `web/src/index.css`. Before adding a customization or
upgrading shadcn, read [the ownership and upgrade guide](docs/shadcn-ui.md); review every
`--diff` before writing over a file in `ui/`.

The command palette on Mod+K (`web/src/components/CommandPalette.tsx`) is the keyboard surface for
navigation and view commands, grouped as Sessions (Recent sessions before searching), Global commands,
and Session commands (only with a selected session). A feature that adds an action the sidebar or
header offers also adds a row in the appropriate command group, named as its button is.
Global shortcuts are Mod+K (palette) and stock Sidebar's Mod+B; the composer alone binds Mod+/ to
its model picker. Other actions are reached through the palette or their control.

## Server

`server/PiSessions.ts` is the deep module: `open`, `probe`, and per session `events`, `act`,
`state`, all in the browser's wire vocabulary from `shared/wire.ts`. Add capabilities as new
`SessionAction` or `SessionEvent` variants; everything pi-protocol-specific stays behind that seam.
Tests go through that interface only. Module files are PascalCase after their export; `main.ts` is
the sole entry point.

Keep filesystem paths out of HTTP URLs, so access logs and proxies never record them. Address a
registered workspace or session by its ID (`?workspaceId=`, `/s/<sessionId>`); send an arbitrary
path, such as a directory that is not registered yet, in a POST JSON body.

## Effect

Keep Effect packages on aligned versions, and verify lockfile upgrades.

Before writing Effect code, read `node_modules/effect/AGENTS.md`: it is the installed version's own
guide, so prefer it to web docs or memory. For idioms, read the installed source and examples in
`node_modules/effect/{src,ai-docs/src}` and `node_modules/@effect/platform-node/{src,ai-docs}`
(child processes: `ai-docs/src/60_child-process`); reference only, import from the packages. Write
a named or service-method effectful function as `Effect.fn("Module.name")(function* …)`, or
`Effect.fnUntraced` on per-event hot paths, not as an arrow returning `Effect.gen`; keep
`Effect.gen` for inline programs and callbacks. Annotate a return type with `Effect.fn.Return<A, E>`.

Two Effect v4 gotchas already paid for: on an upgraded socket, acquire `reader` before `writer`
(the reader performs the handshake and the writer waits on it); and a `forkScoped` fiber must not
`ensuring` on an exit that a later finalizer causes, or shutdown deadlocks.

## Direction and guardrails

For architecture and workflow changes, read [docs/README.md](docs/README.md), then the ADR,
development invariants and roadmap it links, and cite affected invariant IDs in the PR. The short
form of INV-01: Pi owns history, Git owns repository facts, Worktrunk sits behind the lifecycle
adapter, Piano owns workspace and integration policy.

## README

`README.md` holds two guides and nothing else: **Use**, how a user sets up and uses Piano,
and **Develop**, how a developer sets up the project and starts developing. Put reference and
explanation in `docs/` and link to it from the guide that needs it.

## Deploy

Rebuild, restart or deploy only when the user asks. On an exe.dev VM, follow
[the shortest deploy path](docs/hosted-development.md#shortest-deploy-path); to update every
machine, the user runs the `sync-piano` skill (user-invoked only). On exe.dev the server has no
authentication: it stays on loopback behind exe.dev private access (INV-11).

## GitHub on exe.dev

When the git remote is `github.int.exe.xyz`, prefix `gh` with `GH_HOST=github.int.exe.xyz` and pass
`--repo goofansu/piano`. The integration supplies authentication, so try it before asking for
`gh auth login`. Setup and permission failures: [exe.dev GitHub integration](https://exe.dev/docs/integrations-github.md).
