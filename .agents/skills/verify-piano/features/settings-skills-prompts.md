# Settings › Skills and Prompts

Settings (`/settings/<section>`) holds Providers, MCP, Skills, Prompts, Webhooks and Preferences. Skills and
Prompts are Piano-owned templates saved under the scratch database's skills and prompts folders:
the user creates one from the page header or the Mod+K palette, views it by clicking its name,
deletes it from the row menu, and sessions started afterwards load what is saved (already-running sessions do not). The
sidebar's Settings opens Providers; the palette lists each section by name.

## Sub-features

- `open-settings`: the sidebar's Settings opens `/settings/providers`; Mod+K offers Providers,
  MCP, Skills, Prompts, Webhooks and Preferences (Radius is inside Providers, not a separate
  palette destination); address bar `/settings/skills`,
  `/settings/prompts`.
- `skills-empty`: `/settings/skills` headed Skills with New skill; with none, "No skills yet".
- `new-skill`: New skill (header or palette) opens a dialog: Name, Description (live count
  "0 / 1,024"), Instructions ("0 / 20,000"), "Disable model invocation", Cancel and Create skill;
  description text "Saved in Piano. Sessions started from now can use it."; Create skill stays
  off until Name, Description and Instructions are valid; success toasts "Skill created" and the
  row appears (name mono, description under it).
- `skill-row-actions`: the row's name button opens View, which shows the skill's SKILL.md with
  "Copy skill"; "Skill actions <name>" (shown while the row is pointed at or focused) holds a red
  Delete, which asks "Delete skill?" (`Sessions started from now no longer load <name>.`) and
  toasts "Skill deleted".
- `prompts-empty`: `/settings/prompts` headed Prompts with New prompt; with none, "No prompts yet".
- `new-prompt`: New prompt opens a dialog shaped as New skill (Name, Description "0 / 1,024",
  Instructions "0 / 20,000", Cancel, Create prompt; no Disable model invocation). Create prompt
  stays off until the three fields are valid; success toasts "Prompt created" and the row shows
  name plus description.
- `prompt-row-actions`: the row's name button opens View, which shows the prompt file with
  "Copy prompt"; "Prompt actions <name>" holds a red Delete, which asks "Delete prompt?" with the
  same "sessions started from now" wording and toasts "Prompt deleted".
- `palette-new`: on Skills, Mod+K offers "New skill"; on Prompts, "New prompt". From other
  screens, search `skill` / `prompt` to open that Settings section first.

## How to get to it (user POV)

- Sidebar: Settings (lands on Providers), then the Settings sections nav → Skills or Prompts.
- Palette: Mod+K, choose Skills / Prompts / New skill / New prompt.
- Address bar: `/settings/skills`, `/settings/prompts`.

## Driving it with agent-browser

Preconditions: a seeded launch, `. "$RUN/run.env"`, doctor passed;
`ab() { .agents/skills/verify-piano/scripts/ab.sh "$RUN" "$@"; }`. Mod+K is `Control+k` on Linux,
`Meta+k` on macOS.

- `open-settings`
  - Action: `ab set viewport 1280 800; ab open "$WEB_URL/"; ab wait --text "Loose session";
    ab find role button click --name "Settings" --exact; ab wait --url "**/settings/**"`
  - Result: URL is `/settings/providers`. Capture `01-providers`.
  - Action: `ab open "$WEB_URL/settings/skills"; ab wait --text "Skills"`
  - Result: title `Settings - Piano`, main starts `Skills` / `New skill`.
- `skills-empty` and `new-skill`
  - Action: on `/settings/skills`, `ab wait --text "No skills yet";
    ab find role button click --name "New skill" --exact; ab wait "[role=dialog]"`
  - Result: dialog reads `New skill` / `Saved in Piano…` / `Name` / `Description` /
    `0 / 1,024` / `Instructions` / `0 / 20,000` / `Disable model invocation` / `Cancel` /
    `Create skill`. Capture `02-new-skill`. Escape closes it without saving; reopen with
    `ab find role button click --name "New skill" --exact` before the next step.
  - Action: in the open New skill dialog,
    `ab find role textbox fill --name "Name" --exact "verify-skill";
    ab find role textbox fill --name "Description" --exact "Maintain verification";
    ab find role textbox fill --name "Instructions" --exact "Reply with OK.";
    ab find role button click --name "Create skill" --exact; ab wait --text "verify-skill"`
  - Result: toast `Skill created`; the row reads `verify-skill` / `Maintain verification`.
    Capture `02b-skill-created`.
- `skill-row-actions`
  - Action: `ab wait --fn "!document.querySelector('[data-sonner-toast]')";
    ab find role button click --name "verify-skill" --exact; ab wait '[role=dialog]'`
  - Result: the dialog shows the complete SKILL.md and "Copy skill". Capture `02c-skill-view`.
    `ab press Escape; ab find role button click --name "Skill actions verify-skill" --exact;
    ab find role menuitem click --name "Delete" --exact; ab wait --text "Delete skill?"`;
    capture `02d-skill-delete`, then `ab find role button click --name "Delete" --exact;
    ab wait --text "No skills yet"`. Capture `02e-skill-deleted`.
- `prompts-empty` and `new-prompt`
  - Action: `ab open "$WEB_URL/settings/prompts"; ab wait --text "No prompts yet";
    ab find role button click --name "New prompt" --exact; ab wait "[role=dialog]";
    ab find role textbox fill --name "Name" --exact "verify-prompt";
    ab find role textbox fill --name "Description" --exact "A short verify prompt";
    ab find role textbox fill --name "Instructions" --exact "Reply with OK.";
    ab find role button click --name "Create prompt" --exact;
    ab wait --text "verify-prompt"`
  - Result: before Create, the dialog matches New skill minus Disable model invocation; after,
    toast `Prompt created` and main lists `verify-prompt` / `A short verify prompt`. Capture
    `03-prompt-created`. Creating writes a file beside the scratch database; continue with
    `prompt-row-actions` before relaunching for a clean seed.
- `prompt-row-actions`
  - Action: after `new-prompt`, wait out the create toast first
    (`ab wait --fn "!document.querySelector('[data-sonner-toast]')"`), then
    `ab find role button click --name "verify-prompt" --exact; ab wait "[role=dialog]"`
  - Result: the View dialog is titled with the prompt name and offers "Copy prompt" (and Close).
    Escape, then Delete through the same menu; confirm on "Delete prompt?" /
    `Sessions started from now no longer load verify-prompt.`: toast
    `Prompt deleted`, and "No prompts yet" again when it was the only one. Capture `04-prompt-view`,
    `05-prompt-delete`, `06-prompt-deleted`.
- `palette-new`
  - Action: on `/settings/prompts`, `ab press Control+k; ab wait "[cmdk-input]";
    ab fill "[cmdk-input]" "new prompt"; ab wait '[cmdk-list][aria-busy="false"]';
    ab find role option click --name "New prompt" --exact; ab wait '[role=dialog]'`
  - Result: the New prompt dialog opens. Capture `07-palette-new`; Escape closes it.
    Search `prompt` or `skill` for `Prompts` / `Skills`; the query `settings` does not match them.
- Side effects: Settings CRUD starts no user session. A cold Settings deep link can start a
  catalog `probe` for the underlying directory; count probes separately. A new session's fake-Pi
  `start` audit gains `--prompt-template "$RUN/db/prompts"` and `--skill "$RUN/db/skills"` (paths under the run's
  database dir); proving a template reaches Pi needs a real or scripted model, not fake Pi.

## Gotchas

- Pi's own prompt and skill folders are not listed; only Piano-created ones appear.
- "Sessions started from now" means no automatic refresh of an already-running session's set;
  Pi's explicit `/reload` is a separate path, not proved by this CRUD recipe.
- Name and Description are required; Create stays off while either is empty or over the limit.
- The create toast covers the row's actions button until it leaves; wait
  `!document.querySelector('[data-sonner-toast]')` before opening the menu.
- The browser fake discovers saved prompt/skill names for slash-completion, but does not expand
  templates or invoke skills. For a separate completion check, keep both entries instead of
  deleting the skill first. Choose a fresh scratch directory in `/new` through Directory →
  Browse… (a previously visited directory may have a cached catalog),
  then `ab fill '[aria-label="First message"]' '/verify'; ab wait --text "verify-prompt"`:
  listbox "Slash commands" offers `/verify-prompt` and `/skill:verify-skill`. Capture this
  separately from Settings CRUD; clear the draft rather than claiming a model used either file.
- Agent-authored saves are a separate user path: ask a session to create or update a Piano skill
  or prompt; its proposal shows the new file or update diff, with Create skill / Create prompt for a new
  file, Save skill / Save prompt for an update, and Cancel. A proposal containing hidden text offers only Cancel. Manual Settings CRUD does not
  prove this approval path. The default browser fake only echoes `propose visible`; the dialogs
  fake can render a proposal but does not save the file. End-to-end proof requires an isolated
  real-Pi session with a scripted model calling `piano_save_skill` / `piano_save_prompt`, then
  observing Save or Cancel and the resulting Settings list. Report that prerequisite as unmet
  when using only the default launch; never use the owner's real session to fill this gap.
