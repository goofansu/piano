# Piano verification map

The index of Piano's verification recipes. Each recipe lives with the feature it checks, at
`features/<feature>/verify/<recipe>.md`; read this index, then drive the matching recipe. How to
launch, check, drive, capture and clean up is in [`SKILL.md`](./SKILL.md).

## Baseline preconditions

- An instance from `.agents/skills/verify-piano/scripts/launch.sh` (seeded unless a file says `--empty` or `--fake-pi dialogs`),
  with `. "$RUN/run.env"` loaded in the driving shell.
- `.agents/skills/verify-piano/scripts/doctor.sh "$RUN"` exits 0.
- The seed data and fake Pi behavior described under [Launch](./SKILL.md#launch).

## Driving conventions

- Plan recipes serially from their stated preconditions, reusing the run and browser. Use newly
  created scratch entries for destructive checks so later recipes keep their prerequisites.
  A recipe needing a fresh baseline or another fake requires confirmed Cleanup before relaunch;
  follow the skill's Run limits, rather than undoing database mutations by hand.
- Use the stable handles listed under [Drive](./SKILL.md#drive). Never coordinates or tab order.
- Treat quoted names and commands as literal.
- Wait for the state you assert (`wait --text`, `wait --fn`), not a fixed sleep.
- The repo harness (`test/browser/*.mjs`) covers a feature's critical path where it exists; run it
  first, then the agent-browser steps for the rest.

## Proof and skip reporting

The [Evidence](./SKILL.md#evidence) apply to every recipe. In addition:

- CLI proof is the command, stdout, stderr and exit code, saved under `$EVIDENCE/<feature-id>/`.
- Record the feature ID and the entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.

## Feature entry contract

Each recipe is named for the user journey it drives; that name is its `<feature-id>` for
captures. A recipe is an H1, then `Driving it with agent-browser` (starts with `Preconditions:`,
then labeled bullets pairing each action with an exact command and the observable result) and
`Gotchas`. Keep implementation details out; name user paths, handles, required state, commands and
proof.

Add a recipe to [Features](#features) when you create one. Link each recipe to the guide for the user task it exercises. Keep test commands and evidence requirements in the recipe. See [Feature verification map](../../../docs/testing.md#feature-verification-map).

## Features

- [Start a session](../../../features/sessions/verify/start-session.md).
  Docs: [Start or continue a session](../../../features/sessions/README.md),
  [Attach an image](../../../features/sessions/image-attachments.md).
- [Open and continue a session](../../../features/navigation/verify/open-session.md).
  Docs: [Navigate between sessions](../../../features/navigation/README.md),
  [Performance](../../../docs/performance.md),
  [Publish a document to Radius](../../../features/radius/radius-artifacts.md).
  - **Recover queued text when the connection drops during Edit or Stop.** The
    [session integration tests](../../../test/integration/sessions/ClientSessions.test.ts) cover both
    actions when Pi clears the queue and the connection drops before the reply arrives. The
    [client tests](../../../test/Client.test.ts) check that the originating tab restores the text once.
    The [open-session browser journey](../../../test/browser/open-session.mjs) drops the reply to
    Edit and checks the composer after reconnect.
- [Share a session](../../../features/sharing/verify/session-sharing.md).
  Docs: [Share a saved session](../../../features/sharing/README.md).
- [Projects index](../../../features/projects/verify/projects-index.md).
  Docs: [Review project activity](../../../features/projects/project-centered-ux.md).
- [Project home](../../../features/projects/verify/project-home.md).
  Docs: [Projects](../../../features/projects/README.md).
- [Session dispatch](../../../features/dispatch/verify/session-dispatch.md).
  Docs: [Delegate work to another session](../../../features/dispatch/README.md),
  [Start or continue a session](../../../features/sessions/README.md).
- [Changes and files](../../../features/workspace/verify/changes-and-files.md).
  Docs: [Work with a checkout](../../../features/workspace/README.md).
- [Settings › Skills and Prompts](../../../features/library/verify/settings-skills-prompts.md).
  Docs: [Skills and prompts](../../../features/library/README.md).
- [Settings › Providers](../../../features/providers/verify/settings-providers.md).
  Docs: [Connect a model provider](../../../features/providers/README.md),
  [Set up Radius](../../../features/radius/README.md).
- [Settings › Preferences › Voice input](../../../features/voice-input/verify/settings-voice-input.md).
  Docs: [Dictate a message](../../../features/voice-input/README.md).
- [Settings › Webhooks](../../../features/webhooks/verify/settings-webhooks.md).
  Docs: [Send session events to a webhook](../../../features/webhooks/README.md).
- [Settings › Data controls](../../../features/data-controls/verify/data-controls.md).
- [Settings › MCP](../../../features/mcp/verify/settings-mcp.md).
  Docs: [Connect Pi to an MCP server](../../../features/mcp/README.md).

### Checked in other recipes

These features have no recipe of their own; drive the named steps. Add a recipe when a change
needs a check none of these steps makes.

- Search palette ([Search sessions, projects and commands](../../../features/commands/README.md)): `palette-row`,
  `palette-projects`, `palette-filter` and `palette-keyboard` in
  [Projects index](../../../features/projects/verify/projects-index.md); other recipes open it
  to reach their own feature. Unchecked: matching a session by folder or branch, and which actions
  each page offers.
- Model and effort ([Choose a model and effort level](../../../features/models/README.md)): `model-defaults` in
  [Start a session](../../../features/sessions/verify/start-session.md). Unchecked: Refresh
  models, which needs a real provider account.
- Radius ([Set up Radius](../../../features/radius/README.md)): `providers` in
  [Settings › Providers](../../../features/providers/verify/settings-providers.md) (signed-out
  controls), `artifacts` in [Open and continue a session](../../../features/navigation/verify/open-session.md)
  (dialogs fake) and Sign-in in [Share a session](../../../features/sharing/verify/session-sharing.md).
  Unchecked: sign-in, tool installation and publishing, which need controlled credentials.

## Coverage boundaries

Report entry points individually: one visited path does not prove every branch in a recipe.
Keep these prerequisites visible when using the default launch:

- The dispatch recipe's Enter a value dialog needs `--fake-pi dialogs`; the browser fake also
  supports the separate Which checks? inline-question recipe in [Open and continue a session](../../../features/navigation/verify/open-session.md).
  See [Session dispatch](../../../features/dispatch/verify/session-dispatch.md). Neither fake proves that an agent-authored library
  save writes only the approved file; see [Settings › Skills and Prompts](../../../features/library/verify/settings-skills-prompts.md#gotchas).
- The dialogs fake can supply confirmed artifact results for the header menu, but does not
  publish to Radius or prove authenticated link access; see
  [Open and continue a session](../../../features/navigation/verify/open-session.md#driving-it-with-agent-browser).
- Dispatch extension waits, parent tool rows and child backlinks need real Pi/scripted model
  evidence; the CLI recipe proves creation, inheritance and status, not those UI paths.
- Voice input requires the setup described in
  [Settings › Preferences › Voice input](../../../features/voice-input/verify/settings-voice-input.md#gotchas). A fake echo or an unsigned-in page
  does not establish transcription or secret checking. The committed
  `node test/browser/voice-input.mjs <evidence-directory>` journey covers composer visibility and
  draft ownership with a fake microphone and a stubbed transcription reply.
