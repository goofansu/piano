# Piano verification map

The maintained source for verifying Piano's user-facing behavior. Read this index, then drive the
matching feature file. How to launch, check, drive, capture and clean up is in
[`../SKILL.md`](../SKILL.md); `S=.agents/skills/verify-piano/scripts` throughout.

## Baseline preconditions

- An instance from `.agents/skills/verify-piano/scripts/launch.sh` (seeded unless a file says `--empty` or `--fake-pi dialogs`),
  with `. "$RUN/run.env"` loaded in the driving shell.
- `.agents/skills/verify-piano/scripts/doctor.sh "$RUN"` exits 0.
- Seed: folder `repo` (`$REPO`); projects `verify` "Verify Project" and `empty` "Empty Project";
  sessions `verify-plan` "Plan the verification" (project
  `verify`, PR link `#222`, last active 1 hour ago) and `verify-loose` "Loose session" (no project,
  20 minutes ago), each with history `What is 2 + 2? (<title>)` / `Answer 4.`.
- Fake Pi `test/browser/fake-pi.mjs` replies `echo: <prompt>`; a prompt of exactly `hold` keeps
  running until Stop. Its audit is `$AUDIT`.
- Never drive an instance this run did not launch, and never the user's Piano on 7070, 8000 or 8001.

## Driving conventions

- Start every recipe from the baseline unless its preconditions say otherwise; relaunch rather
  than undo a mutation by hand.
- Prefer role plus accessible name (`.agents/skills/verify-piano/scripts/ab.sh "$RUN" find role button click --name "..." --exact`),
  then `aria-label` and `data-slot` selectors, then routes. Never coordinates or tab order.
- Treat quoted names and commands as literal.
- Wait for the state you assert (`wait --text`, `wait --fn`), not a fixed sleep.
- The repo harness (`test/browser/*.mjs`) covers a feature's critical path where it exists; run it
  first, then the agent-browser steps for the rest.

## Proof and skip reporting

- Capture the action and the resulting state: `.agents/skills/verify-piano/scripts/capture.sh "$RUN" <feature-id> <step>` before
  and after, plus the text that proves the step.
- UI proof is a screenshot, an accessibility snapshot and `state.json` (all from `capture.sh`).
- CLI proof is the command, stdout, stderr and exit code, saved under `$EVIDENCE/<feature-id>/`.
- Side-effect proof is a second, read-only view: the fake-Pi audit, `GET /api/folders`,
  `git -C "$REPO" worktree list`, files in `$REPO`.
- Record the feature ID and the entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition. Do not report a
  skipped entry point as verified through another one.
- Say when a step relied on a hand-written Pi history or only on a unit test.

## Feature entry contract

Each feature file starts with an H1 and one paragraph on the user-visible behavior, then exactly
four H2 sections in this order: `Sub-features` (short IDs, one line each), `How to get to it (user
POV)` (every entry point), `Driving it with agent-browser` (starts with `Preconditions:`, then
labeled bullets pairing each action with an exact command and the observable result), `Gotchas`.
Keep implementation details out; name user paths, handles, required state, commands and proof.

## Features

- [Start a session](./start-session.md): the New page, its directory, model, effort and project
  choices, restoring model defaults, the first message and reply, reload without resending,
  a kept draft when not sent.
- [Open and continue a session](./open-session.md): open from the sidebar, palette or project
  home; read history and cost; follow up; stop a running reply; archive and delete from the row's
  menu; responsive sidebar controls; the narrow session-menu sheet and its project picker;
  the published-artifact menu, including codemode receipts.
- [Projects index](./projects-index.md): `/projects` from the sidebar row and the palette; one row
  per project with folders, count, last activity and the project menu; New project in the header;
  Done / Reopen and the folded Done group; empty and phone.
- [Project home](./project-home.md): `/projects/<id>` from the sidebar, palette and session
  header; member rows and their Archive / Delete, order, PR number, new session in the project,
  settings, Done badge / Reopen and sidebar grouping; empty, deleted and missing projects.
- [Session dispatch](./session-dispatch.md): `scripts/dispatch-session.ts` start, `--worktree`,
  `follow-up`, `status` and `list --project`, project inheritance/opt-out, its refusals,
  and a dialog that needs input.
- [Changes and files](./changes-and-files.md): the Changes pane for a workspace's diff and its
  pull request, and the desktop session rail's Environment and Outputs (no Links section or narrow rail).
- [Settings › Skills and Prompts](./settings-skills-prompts.md): `/settings/skills` and
  `/settings/prompts` from the sidebar and palette; New skill / New prompt; View and Delete;
  empty states; the separate agent-authored approval path's real-Pi prerequisite.
- [Settings › Providers, Webhooks and Preferences](./settings-other.md): unsigned-in provider/Radius
  setup, the voice-input key prerequisite and cancellation, inactive webhook CRUD and URL refusal;
  authenticated setup, transcription and webhook delivery remain separate checks.
- [Settings › MCP](./settings-mcp.md): `/settings/mcp` over the scratch `mcp.json`; Connect,
  Add MCP server by form and JSON paste (URL/startup refusals and local command success),
  Manage → Edit / Delete, Connect cancellation, and Pi's MCP switch. Authenticated URL-server
  management is a separate prerequisite.

## Coverage boundaries

Report entry points individually: one visited path does not prove every branch in a feature file.
Keep these prerequisites visible when using the default launch:

- The dispatch recipe's Enter a value dialog needs `--fake-pi dialogs`; the browser fake also
  supports the separate Which checks? inline-question recipe in [Open a session](./open-session.md).
  See [Session dispatch](./session-dispatch.md). Neither fake proves that an agent-authored library
  save writes only the approved file; see [Settings](./settings-skills-prompts.md#gotchas).
- The dialogs fake can supply confirmed artifact results for the header menu, but does not
  publish to Radius or prove authenticated link access; see
  [Open a session](./open-session.md#driving-it-with-agent-browser).
- Dispatch extension waits, parent tool rows and child backlinks need real Pi/scripted model
  evidence; the CLI recipe proves creation, inheritance and status, not those UI paths.
- Voice input and authenticated Share require the setup described in
  [Providers and Preferences](./settings-other.md#gotchas). A fake echo or an unsigned-in page
  does not establish transcription, secret checking or sharing.
- Managed Preview (external tabs, rail actions and the same-sheet Preview pane) needs the isolated real-Pi/native
  supervisor journey in [`docs/testing.md`](../../../../docs/testing.md#managed-preview-host-journey),
  `node test/browser/preview.mjs <evidence-directory>`. The default fake's Changes/rail checks
  are not Preview evidence; authenticated exe.dev access and real-device touch remain separate.
