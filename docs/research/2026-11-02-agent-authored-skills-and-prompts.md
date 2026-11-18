# Agent-authored skills and prompts

A design for asking the agent, in a session, to create or change what two Piano screens show:
**Settings › Skills** and **Settings › Prompts**. It shipped with PIN-144
([saving from a session](../configuration.md#saving-from-a-session)). It follows [prompts](../prompts.md) and
[Piano's prompts and skills](../configuration.md#pianos-prompts-and-skills).

A project's instructions (Project settings › Instructions) stay the user's to write: the user
decided that a project is maintained by hand, so no tool edits them. The agent can still propose
text in its reply for the user to paste.

## The journey

In a session the user writes, in their own words, "turn what we just did into a skill" or
"make a `/triage` prompt that takes an issue number". The agent drafts the content and calls one
Piano tool. Above the composer, where `ask_user` puts its questions, Piano shows what would be
saved and asks once. The user saves or cancels. A save ends with the toast the Settings page shows
for the same change, a transcript row records what happened, and the thing is on its page:
Settings › Skills or Settings › Prompts. Nothing is written without that click.

## Why tools through Piano, not Pi's file tools

Skills and prompts created in Piano are Piano's, not the checkout's: they live in Piano's own
folders beside its database, outside any session's directory. The rules are Piano's too: the
shared draft rule (`shared/drafts.ts`) and the refusal of a name Pi already loads from one of its
own folders. A bundled Pi extension that calls Piano's server reuses `UserSkills` and `Prompts` as
Settings does, so the agent and the Settings pages cannot disagree about what is allowed (INV-01).
Pi keeps loading skills and prompts (INV-12); Piano never writes a repository file.

The checkout's own files (`AGENTS.md`, a repository's `.pi/skills/` and `.pi/prompts/`) are not
part of this design: the agent edits them with its ordinary file tools, and Git owns them. A
session that wants a repository skill needs no Piano feature.

## The extension

A new bundled extension, `piano-library`, follows `piano-dispatch`: it reaches the Piano that
started it through `PIANO_SESSION_WS_URL` and `PIANO_SESSION_ORIGIN`, registers two
model-callable tools and no slash command, and is not advertised when Piano gave the child no
endpoint. "Library" is the extension's name only; the UI names skills and prompts as it already
does.

| Tool                | Arguments                                                                | What it saves                                                                      |
| ------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `piano_save_skill`  | `name`, `description`, `instructions`, optional `disableModelInvocation` | `<name>/SKILL.md` in Piano's skills folder, new or replacing a skill Piano created |
| `piano_save_prompt` | `name`, `description`, `instructions`                                    | `<name>.md` in Piano's prompts folder, new or replacing a prompt Piano created     |

Each returns one of:

- `saved`, with the name and where it applies (see [Reach](#reach));
- `cancelled`, when the user cancelled or the run was stopped, with nothing written;
- `refused`, with the field (`name`, `description`, `instructions`) and the same sentence Settings
  shows, such as "Use lowercase letters, numbers and single hyphens, not at the start or end.", or
  with a detail about the save as a whole: a name Pi already loads from a folder that is not
  Piano's.

The tool checks the draft with `checkDraft` before it asks anything, so a malformed name or a
too-long text comes back to the model without a dialog. A cancellation is never a reason to ask
again or to save another way; the tool's guidelines say so, as `ask_user`'s do.

The agent already has what it needs to edit rather than create. Pi lists every loaded skill with
its file path in the system prompt, so a skill's current `SKILL.md` is a `read` away. Prompts are
not in the system prompt; an update to a prompt writes what the model supplies, and the proposal
shows what it replaces. No read tool is added.

### Approval

Each save is broad: a skill or prompt reaches every session Piano starts from then on. The content
may come from an untrusted repository the agent just read, so a save needs the user's own decision
(INV-11). The tool asks through the dialog `ask_user` uses, a Pi UI request Piano renders above
the composer, so the decision has the dialog lifecycle Piano already guarantees: one terminal
resolution, cancelled by Stop/Abort, a recovery deadline when nobody answers, never retried
automatically (INV-04).

The proposal card, where `ask_user`'s question appears and without replacing the composer's draft:

- a title that names the change: "New skill: `fix-flaky-tests`", "Update skill: `fix-flaky-tests`",
  "New prompt: `triage`";
- the content exactly as it would be saved, in the View dialog's shape from Settings (the file with
  its front matter, plain text, copyable), for a new skill or prompt; a change to an existing skill
  or prompt shows a diff against what is saved now, in the Changes view's shape, so the user sees
  what they would lose;
- two controls: the primary **Save skill** / **Save prompt**, and **Cancel**.

The card carries no explanation. Where the save applies is a fact in the transcript row's Details,
not a sentence on the card.

Piano tells the card from any other dialog by the prompt the extension sends, as it does for
`ask_user` (`shared/askUser.ts`), with the proposal in the dialog's message. A proposal is at most
20,000 characters of text, far inside [the 32 MiB RPC line limit](../runtime-input-limits.md).

### Saving

After the click the extension saves the way the browser does, through the HTTP endpoints Settings
uses (`Endpoints.userSkills`, `Endpoints.prompts`), with `PIANO_SESSION_ORIGIN` as `Origin`, as
`piano-dispatch` sends it on its WebSocket upgrade. The server can still refuse, for a name Pi
loads from another folder: the tool returns `refused` and the card's toast is the error's, as the
Settings page shows it. One addition on the server: `UserSkills.update` and `Prompts.update`, each
replacing the file of a skill or prompt Piano created and refusing any other name, so a skill in
`~/.agents/skills` or a repository can never be written over. Settings › Skills and
Settings › Prompts can grow an **Edit** on the same calls later; this design does not add it.

### Transcript and feedback

Once the server confirms, the card is replaced by the toast its Settings page shows for the same
change: "Skill created" and "Prompt created" for a new one, as the New skill and New prompt
dialogs say, and "Skill saved" and "Prompt saved" for an update. The transcript gets a row in the
**Answers** row's shape, rebuilt from Pi's saved tool call and result when the session is reopened:

| Outcome   | Row                                                                           |
| --------- | ----------------------------------------------------------------------------- |
| saved     | "Skill saved: `name`", with **View** opening the same View dialog as Settings |
| cancelled | "Skill not saved: `name`"                                                     |
| refused   | "Skill not saved: `name`", the refusal in its Details                         |

The row's Details hold where the save applies and, for a refusal, the sentence. The Settings
pages need no change to show the result: they list the folder.

## Reach

Where a saved skill or prompt applies is already decided by how Pi loads it; this design changes
none of it. The tool result states it and the agent relays it.

| Sessions started from now                                                           | Running sessions, the one that saved it included |
| ----------------------------------------------------------------------------------- | ------------------------------------------------ |
| Loaded: Piano starts every Pi with `--skill` and `--prompt-template` on its folders | Not until their next Pi start                    |

A session sees new skills and prompts when its Pi next starts. That is Piano's rule today and
Pi's own, where a new one appears in a new terminal session or after `/reload`. A session whose
Pi is not running (idle-stopped, or saved and not yet continued) completes `/` from a fresh
one-shot probe (`PiSessions.probe`) and starts a new Pi on its next prompt, so the new `/name` is
there at once. A session whose Pi is running completes from that Pi (`sessionCommands`), which
lists what it loaded at its start, until the idle stop ends it within `PIANO_IDLE_MINUTES`. The
transcript row's Details say "In sessions started from now".

No running session is reloaded. Pi's `/reload` is a command of its terminal mode only: RPC mode
has no `reload` command, and `/reload` sent as a prompt would reach the model as text. A bundled
extension could register a command whose handler calls `ctx.reload()`, but the user chose the
plain rule instead.

## Boundaries

| Invariant      | Consequence                                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-01         | Piano owns its skills and prompts folders; Pi owns the tool call and result in history; no repository file is written.                                                                              |
| INV-02, INV-03 | The save is a tool call in the session's own run; it starts no second run and no other session.                                                                                                     |
| INV-04         | The proposal is a dialog: one resolution, cancelled on abort, bounded by the recovery deadline, never auto-retried; cancellation is not approval.                                                   |
| INV-11         | Agent-written content is untrusted until the user saves it; the card shows it as plain text, never rendered; the extension reaches Piano only through the launch endpoint and origin Piano gave it. |
| INV-12         | Pi loads what is saved, at its start; Piano adds no second loader and reloads nothing.                                                                                                              |
| INV-13         | Piano enforces Pi's form (name rule, limits), not a method: how a skill is written is the user's and the agent's.                                                                                   |

Non-goals: editing a project's instructions, which the user maintains in Project settings; a
setting that lets the agent save without asking; deleting a skill or prompt from a session
(Settings does that, with its confirmation); skills or prompts in Pi's other folders or in a
repository.

## Verification

One slice: the extension with `piano_save_skill` and `piano_save_prompt`, the server `update`s,
the proposal card, the transcript row. Checks, by the [testing policy](../testing.md):

- `test/UserSkills.test.ts` and `test/Prompts.test.ts`: `update` replaces a Piano skill's or
  prompt's file and a real, isolated Pi offers the new content; a name from another folder is
  refused, as an unknown name is.
- An extension test in the dispatch tests' shape, against a scratch server: a save after approval
  writes the file and the list shows it; a cancel and a stop write nothing; a malformed draft is
  refused with its field before any dialog.
- A browser journey on a [scratch instance](../../AGENTS.md#scratch-instance) with one real model
  call ("Save a prompt named `x` with description `y` and instructions `z`"): the card, Save, the
  toast, the transcript row, the prompt on Settings › Prompts and in the New page's composer, and
  its absence from the saving session's composer. Screenshots are the evidence.
- The quiet-UI list of every string and control above, each run through
  [the checks](../quiet-ui.md#checks).
- `test/browser/transcript-rows.mjs` gains the new row kind, as the Answers row did.
