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
- **Application behavior:** observe the affected journey through `npx agent-browser` on a
  [scratch instance](#scratch-instance) and keep the output as PR evidence.
- **UI changes:** list every string, control and action the change adds, from its screenshots,
  and run each through the [quiet UI](#quiet-ui) checks; take each action once and screenshot its
  answer. The change is done when every listed item passes or is gone.
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

The user's own Piano (local on 7070; on exe.dev the systemd units on 8000/8001) uses the real
registry. Leave it, its backend and its registry alone, and verify in scratch processes:

```bash
HOST=127.0.0.1 PIANO_ALLOWED_ORIGINS=http://127.0.0.1:7172,http://localhost:7172 PIANO_DB_PATH=<scratchpad>/piano.db PORT=7171 node server/main.ts &
PIANO_DEV_BACKEND=http://127.0.0.1:7171 npm run dev:web -- --host 127.0.0.1 --port 7172 --strictPort &
```

Drive the scratch UI on 7172. A scratch Vite started detached stops picking up edits: when the UI
still shows old markup, compare a module with and without a cache-busting query, for example
`curl http://127.0.0.1:7172/src/components/X.tsx` against the same URL with `?t=1`. If they
differ, restart that Vite process; a fresh browser session does not help. A new scratch database
starts empty; register only a throwaway git repo in the scratchpad. Record each pid with `$!` as
you start it and stop only those pids; do not look pids up with `pgrep -f` or `ps`, which on macOS
can print other processes' environment variables, secrets included. When a check creates
worktrees or pi session files, remove them afterwards: `git worktree remove --force` plus
`git branch -D` in the scratch repo, and the directory under `~/.pi/agent/sessions` whose name
encodes the scratch path.

## Design

Follow Linear's design and interaction language (see [the Linear notes](docs/design-moonstone.md#linear)
and Linear's [agent interaction guidelines](https://linear.app/developers/aig)); Codex and T3 Code
remain references for the web harness around Pi, not for how Piano looks.

### Quiet UI

A screen carries only what helps the user decide or act, and explains itself (Krug's "don't make
me think") through structure, names and defaults. Every string, control and action a change adds
passes these checks:

- **Kind:** a value, a control's name, a state, or an empty state's one line. Explaining the screen
  (helper sentences, field descriptions, placeholders, intro lines) means a name or layout needs
  work: fix that instead. A fact only words can carry waits in a Details popover or a dialog's
  description line.
- **Once:** each fact appears once per screen. A header's context line, a title or a placeholder
  holds only what the screen does not already show.
- **Same names:** things are named as the UI and [the glossary](docs/glossary.md) already name
  them, case included ("No project", "Delete project").
- **Same shape:** a new screen matches an existing screen of its kind (a settings page matches
  Webhooks); compare their screenshots side by side. A destructive action is the red
  `destructive` menu item and asks first.
- **Feedback:** every action answers where it was taken, once the server confirms it: a saved,
  deleted or sent change ends with a toast that names it ("Project saved", "Session deleted"),
  a failure with the error's toast, a read in progress with its own control turning.
- **Details on demand:** internal state and diagnostics go in on-demand details, if anywhere; a
  persistent warning appears only for a problem the user can act on.

Shared structure, so every pane reads as one app: one header shape on the session, the right
sidebar and Settings (a title, context beside or beneath it when that adds something, controls at
the end; the session header is one line, with its menu beside the title);
one status glyph, `StatusDot`, for every state (an app preview, a webhook delivery), breathing
(`pulse`) only while something is in progress, and each state shown once: the sidebar row owns a
session's state, so the header repeats nothing; a refresh control turns its own icon while it
reads; a Settings page listing things (providers, webhooks) is `SettingsGroup`s and
`SettingsList`s of hairline-divided rows with `outline` row actions and its one primary action
in its header; editing one thing's few fields (Project settings) is a dialog opened where the
thing is shown, its fields in place and Save in its footer.

An icon-only button takes its size from its place, `size="header"`, `"list"`, `"row"` or
`"inline"` on `PianoButton` and `IconButton`, never a pixel size or a touch override of its own:
a header or toolbar (a pane's, the sidebar's, a picker's, a Settings group's) and a list row's
action outside the sidebar are 32px, 44px on touch; a sidebar row's are 24px, 36px on touch;
a control inside content (a code block, a quote, the PDF toolbar) is 24px. A one-off (the
composer's Attach and Send, Scroll to bottom, the phone sheet's) and a button inside a field
(`InputGroupButton`) keep their own sizes. A row's actions are `RowActions`: over the row's end,
revealed while it is pointed at, focused or has its menu open, its title fading or its value
stepping aside beneath them, so the row reserves no empty slot.

Build UI from shadcn/ui components (the `shadcn` skill: search the registry, add with
`npx shadcn@latest add`). Hand-written markup is for the case where no standard component exists,
and says so in a comment. `web/src/components/ui/` stays upstream-owned: Piano's variants, overlay
styling and focus policy live in the `Piano*` wrappers and `StatusBadge` in
`web/src/components/`, and tokens in `web/src/index.css`. Before adding a customization or
upgrading shadcn, read [the ownership and upgrade guide](docs/shadcn-ui.md); review every
`--diff` before writing over a file in `ui/`.

An outgoing link in Settings is a `SettingsExternalLink` (text followed by the external-link icon,
opened in a new tab); a button that leaves Piano ends with the same icon as `data-icon="inline-end"`.

Branding icons use [Simple Icons](https://simpleicons.org/). Bundle SVGs locally, preserve source
and license attribution, and use `currentColor` to match the UI; see `web/public/mcp-logos.svg`.

The command palette on Mod+K (`web/src/components/CommandPalette.tsx`) is the keyboard surface for
navigation and view commands, grouped as Sessions (Recent sessions before searching), Global commands
and Session commands (only with a selected session). A session's outputs and links are read in its
Details view, not searched from the palette. A feature that adds an action the sidebar or header offers also adds
a row in the appropriate command group, named as its button is.
Global shortcuts are Mod+K (palette) and stock Sidebar's Mod+B; the composer alone binds Mod+/ to
its model picker. Other actions are reached through the palette or their control.

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

## Architecture reviews

When proposing deepening candidates (`/mattpocock-skills:improve-codebase-architecture`), judge
the code as it stands this round. A candidate qualifies when it names a cost the code pays now:

- a reachable bug;
- one decision made in two or more places;
- a recent `feat` or `fix` commit that touched several modules for one concept;
- consequential behavior (security, data, protocol, concurrency) that today's interface cannot test;
- code the deletion test shows can go.

Find hot spots in `feat` and `fix` commits since the last review; `refactor` commits mark settled
ground. When no candidate qualifies, report "no useful candidates" and stop.

## README

`README.md` holds two guides and nothing else: **Use**, how a user sets up and uses Piano,
and **Develop**, how a developer sets up the project and starts developing. Put reference and
explanation in `docs/` and link to it from the guide that needs it.

## Branches

Start each new branch in its own worktree. In Claude Code, run `/worktrunk:wt-switch-create`,
which moves the session into the new worktree. Elsewhere, run `wt switch -c <branch>`
(`wt switch -h` lists the options) and run every later command from that worktree's directory.

## Deploy

Rebuild, restart or deploy only when the user asks. On an exe.dev VM, follow
[the shortest deploy path](docs/hosted-development.md#shortest-deploy-path); to update every
machine, the user runs the `sync-exe-dev` skill (user-invoked only). On exe.dev the server has no
authentication: it stays on loopback behind exe.dev private access (INV-11).

## GitHub on exe.dev

Prefix GitHub CLI commands with `GH_HOST=github.int.exe.xyz`. Pass `--repo goofansu/piano` where
supported; `gh repo view` takes `goofansu/piano` as a positional argument. Setup and permission
failures: [exe.dev GitHub integration](https://exe.dev/docs/integrations-github.md).
