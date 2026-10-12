# piano

Web UI that starts and continues pi sessions across projects and worktrunk worktrees. One piano
session is one pi session; each running session is one `pi --mode rpc` child. Server on Effect 4
(keep Effect packages aligned and verify lockfile upgrades), client on React + shadcn/ui.

## Words

Use these in code and prose: **folder** (a directory the user added, shown with its worktrees),
**project** (a named group of sessions from any folders, toward one outcome), **worktree** (a
checkout created through piano with `wt`), **session** (one pi session; never "thread"),
**registry** (the SQLite store that records folders, projects, worktrees and session references;
Pi owns session history). Pi's own "project trust" keeps Pi's name.
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
HOST=127.0.0.1 PIANO_ALLOWED_ORIGINS=http://127.0.0.1:7172,http://localhost:7172 PIANO_DB_PATH=<scratchpad>/piano.db PORT=7171 node server/main.ts &
PIANO_DEV_BACKEND=http://127.0.0.1:7171 npm run dev:web -- --host 127.0.0.1 --port 7172 --strictPort &
```

Use `npx agent-browser` against the scratch development UI on 7172, not the user's built UI.
Leave the real registry and running backend alone. Rebuild/deploy only when requested; see
[the hosted workflow](docs/hosted-development.md).

**Deploy preference:** When explicitly asked to deploy, complete the build/install steps and restart
`piano.service` promptly, even if it cuts off this session and other active Pi work. Interruption is
preapproved: do not wait for idle or request extra confirmation. Run the restart and health checks
outside `piano.service`'s process tree so deployment survives the cutoff.

**Shortest deploy path** (changes already verified, dependencies installed):

```bash
cd /home/exedev/piano
npm run build && sudo systemd-run --collect /bin/bash -c '
  exec > /tmp/piano-deploy.log 2>&1
  systemctl restart piano.service &&
  curl --retry 20 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:8001/api/folders -o /dev/null &&
  curl -fsS http://127.0.0.1:8000/ -o /dev/null && echo "DEPLOY OK"
'
```

Confirm `DEPLOY OK` in `/tmp/piano-deploy.log`, then reload the browser. No proxy restart needed.
Keep deploy-only requests to this path; no new documents or repeat verification suite required.

Stop only the process you started, by its pid. Register only scratch directories (a throwaway git
repo in the scratchpad) in the scratch registry. When a check creates worktrees or pi session files,
remove them afterwards: `git worktree remove --force` plus `git branch -D` in the scratch repo, and
the session directory under `~/.pi/agent/sessions` whose name encodes the scratch path.
Use a scratch-local `PIANO_DB_PATH`; a new database starts empty.
See [registry storage and backup guidance](README.md#registry-storage).

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
credentials; run it, `npm run typecheck` and `npm run lint` (Biome) for code or dependency changes. Retain command outcomes,
tested revision/environment and limitations. Stop expanding verification once the relevant risk is
covered and required gates pass; explain when existing tests or inspection suffice.

## Phase completion

After a phase passes its required verification and review, commit its changes and push the current
branch to its upstream. Report the commit and push outcome; a blocked push is not completion.
Pushing changes does not authorize rebuilding or deploying the user's instance.

## GitHub on exe.dev

When the git remote uses `github.int.exe.xyz`, use the exe.dev integration for GitHub CLI
operations too: prefix `gh` commands with `GH_HOST=github.int.exe.xyz` and specify `--repo owner/repo`.
The integration supplies authentication; a plain `gh` login error is not evidence that access is
missing. Try the integration before asking the user to run `gh auth login` or provide a token.

```bash
GH_HOST=github.int.exe.xyz gh pr list --repo goofansu/piano
GH_HOST=github.int.exe.xyz gh pr create --repo goofansu/piano --head "$(git branch --show-current)" --title "..." --body "..."
```

Check for an existing PR before creating one, and report the returned GitHub URL.
See the [exe.dev GitHub integration docs](https://exe.dev/docs/integrations-github.md) for setup
or integration permission failures.

## Design

Follow Codex/T3 Code's **quiet UI**: show only what helps users decide or act. Keep the main view
to useful values, essential controls and concise status. Internal state, cache freshness and
diagnostics belong in on-demand details only when useful; persisting data does not justify adding
an inline label. Surface persistent warnings only for problems the user can act on.
Keep correctness in authoritative state handling and regression checks, not permanent UI caveats.

Build UI from shadcn/ui components: search the registry first, add with `npx shadcn@latest add`,
and compose as the `shadcn` skill describes. Hand-written markup is for the case where no
standard component exists, and says so in a comment.

Keep `web/src/components/ui/` upstream-owned. Piano's variants, overlay styling and focus policy
live in the `Piano*` wrappers, `StatusBadge` and `PickerRadioItem` in `web/src/components/`; use
those for customized controls, and raw `ui/` imports for standard controls. Tokens and the few
internal-slot CSS exceptions live in `web/src/index.css`. The only retained `piano:` patch in
`ui/` disables Sidebar's Mod+B shortcut. When adding a customization or upgrading shadcn, read
[the ownership and upgrade guide](docs/shadcn-ui.md). Preview with
`add <name> --dry-run --diff <file>`; never `--overwrite` unreviewed.

The command palette on Mod+K (`web/src/components/CommandPalette.tsx`) is the keyboard surface for
navigation and view commands, grouped as Sessions (Recent sessions before searching), Global commands,
and Session commands (only with a selected session). A feature that adds an action the sidebar or
header offers also adds a row in the appropriate command group, named as its button is.
Mod+K stays the only global shortcut; other actions are reached through the palette or their control.

`server/PiSessions.ts` is the deep module: `open`, `probe`, and per session `events`, `act`,
`state`, all in the browser's wire vocabulary from `shared/wire.ts`. Add capabilities as new
`SessionAction` or `SessionEvent` variants; everything pi-protocol-specific stays behind that seam.
Tests go through that interface only. Module files are PascalCase after their export; `main.ts` is
the sole entry point.

Keep filesystem paths out of HTTP URLs, so access logs and proxies never record them. Address a
registered workspace or session by its ID (`?workspaceId=`, `/s/<sessionId>`); send an arbitrary
path, such as a directory that is not registered yet, in a POST JSON body.

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
