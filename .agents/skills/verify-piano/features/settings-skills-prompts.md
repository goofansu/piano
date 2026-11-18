# Settings › Skills and Prompts

## Driving it with agent-browser

Preconditions: a seeded launch. Mod+K is `Control+k` on Linux, `Meta+k` on macOS.

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

- The browser fake discovers saved prompt/skill names for slash-completion, but does not expand
  templates or invoke skills. For a separate completion check, keep both entries instead of
  deleting the skill first. Choose a fresh scratch directory in `/new` through Directory →
  Browse… (a previously visited directory may have a cached catalog),
  then `ab fill '[aria-label="First message"]' '/verify'; ab wait --text "verify-prompt"`:
  listbox "Slash commands" offers `/verify-prompt` and `/skill:verify-skill`. Capture this
  separately from Settings CRUD; clear the draft rather than claiming a model used either file.
- Agent-authored saves are a separate user path: ask a session to create or update a Piano skill
  or prompt; its proposal shows the new file or update diff, with Create skill / Create prompt for a new
  file, Save skill / Save prompt for an update, and Cancel. Token-like text stays visible in the
proposal and does not disable approval. Manual Settings CRUD does not
  prove this approval path. The default browser fake only echoes `propose visible`; the dialogs
  fake can render a proposal but does not save the file. End-to-end proof requires an isolated
  real-Pi session with a scripted model calling `piano_save_skill` / `piano_save_prompt`, then
  observing Save or Cancel and the resulting Settings list. Report that prerequisite as unmet
  when using only the default launch; never use the owner's real session to fill this gap.
