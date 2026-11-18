# Piano verification map

The maintained source for verifying Piano's user-facing behavior. Read this index, then drive the
matching feature file. How to launch, check, drive, capture and clean up is in
[`../SKILL.md`](../SKILL.md).

## Baseline preconditions

- An instance from `.agents/skills/verify-piano/scripts/launch.sh` (seeded unless a file says `--empty` or `--fake-pi dialogs`),
  with `. "$RUN/run.env"` loaded in the driving shell.
- `.agents/skills/verify-piano/scripts/doctor.sh "$RUN"` exits 0.
- The seed data and fake Pi behavior described under [Launch](../SKILL.md#launch).

## Driving conventions

- Plan recipes serially from their stated preconditions, reusing the run and browser. Use newly
  created scratch entries for destructive checks so later recipes keep their prerequisites.
  A recipe needing a fresh baseline or another fake requires confirmed Cleanup before relaunch;
  follow the skill's Run limits, rather than undoing database mutations by hand.
- Use the stable handles listed under [Drive](../SKILL.md#drive). Never coordinates or tab order.
- Treat quoted names and commands as literal.
- Wait for the state you assert (`wait --text`, `wait --fn`), not a fixed sleep.
- The repo harness (`test/browser/*.mjs`) covers a feature's critical path where it exists; run it
  first, then the agent-browser steps for the rest.

## Proof and skip reporting

The [proof standards](../SKILL.md#evidence) apply to every recipe. In addition:

- CLI proof is the command, stdout, stderr and exit code, saved under `$EVIDENCE/<feature-id>/`.
- Record the feature ID and the entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.

## Feature entry contract

Each feature file is an H1, then `Driving it with agent-browser` (starts with `Preconditions:`,
then labeled bullets pairing each action with an exact command and the observable result) and
`Gotchas`. Keep implementation details out; name user paths, handles, required state, commands and
proof.

In the Features list below, give each feature with an existing `docs/` page one short link to that
page; keep file maps there, not in the feature files. New or substantially changed features follow
the [feature verification mapping policy](../../../../docs/testing.md#feature-verification-map).

## Features

- [Start a session](./start-session.md).
  Docs: [Session creation and recovery](../../../../docs/runtime-ownership.md#developer-navigation-session-creation-and-recovery),
  [Image attachments](../../../../docs/image-attachments.md),
  [Remote Pianos](../../../../docs/remote-piano.md#developer-navigation).
- [Open and continue a session](./open-session.md).
  Docs: [Session navigation](../../../../docs/sidebar-session-navigation.md#developer-navigation),
  [Transcript performance](../../../../docs/session-performance.md),
  [Radius artifacts](../../../../docs/radius-artifacts.md),
  [Remote Pianos](../../../../docs/remote-piano.md#developer-navigation).
- [Projects index](./projects-index.md).
  Docs: [Projects UX](../../../../docs/project-centered-ux.md),
  [Remote Pianos](../../../../docs/remote-piano.md#developer-navigation).
- [Project home](./project-home.md).
  Docs: [Project grouping](../../../../docs/outcome-projects.md),
  [Remote Pianos](../../../../docs/remote-piano.md#developer-navigation).
- [Session dispatch](./session-dispatch.md).
  Docs: [Session dispatch](../../../../docs/session-dispatch.md),
  [Session creation and recovery](../../../../docs/runtime-ownership.md#developer-navigation-session-creation-and-recovery).
- [Changes and files](./changes-and-files.md).
  Docs: [File previews](../../../../docs/file-previews.md),
  [Managed live previews](../../../../docs/live-previews.md),
  [Remote Pianos](../../../../docs/remote-piano.md#developer-navigation).
- [Settings › Skills and Prompts](./settings-skills-prompts.md).
  Docs: [Prompts](../../../../docs/prompts.md).
- [Settings › Providers, Webhooks and Preferences](./settings-other.md).
  Docs: [Provider sign-in](../../../../docs/provider-sign-in.md),
  [Radius setup](../../../../docs/radius-setup.md), [Webhooks](../../../../docs/webhooks.md).
- [Settings › Data controls](./data-controls.md).
- [Settings › MCP](./settings-mcp.md).
  Docs: [MCP setup](../../../../docs/mcp-setup.md).

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
- Voice input requires the setup described in
  [Providers and Preferences](./settings-other.md#gotchas). A fake echo or an unsigned-in page
  does not establish transcription or secret checking.
- Remote sessions, projects, session actions, Changes/files/rail, directory trust, machine-memory
  isolation, image preparation/preview isolation and peer voice checks need configured, reachable
  peers. The default launch has none; use the explicit prerequisite routes in the feature files and
  [Open a session](./open-session.md). The committed `remote-session.mjs` and `remote-inputs.mjs`
  portions each own three isolated instances under the [narrow run-limit exception](../SKILL.md#run-limits),
  serially with other checks. Their voice helper is not independently runnable.
- Managed Preview (external tabs, rail actions and the same-sheet Preview pane) needs the isolated real-Pi/native
  supervisor journey in [`docs/testing.md`](../../../../docs/testing.md#managed-preview-host-journey),
  `node test/browser/preview.mjs <evidence-directory>`. The default fake's Changes/rail checks
  are not Preview evidence; authenticated exe.dev access and real-device touch remain separate.
