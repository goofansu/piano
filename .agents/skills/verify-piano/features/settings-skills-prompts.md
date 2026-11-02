# Settings › Skills and Prompts

Settings (`/settings/<section>`) holds Providers, MCP, Skills, Prompts and Webhooks. Skills and
Prompts are Piano-owned templates saved under the scratch database's skills and prompts folders:
the user creates one from the page header or the Mod+K palette, views or deletes it from the row
menu, and sessions started afterwards load what is saved (already-running sessions do not). The
sidebar's Settings opens Providers; the palette lists each section by name.

## Sub-features

- `open-settings`: the sidebar's Settings opens `/settings/providers`; Mod+K offers Providers,
  MCP, Skills, Prompts and Webhooks (and Radius under Providers); address bar `/settings/skills`,
  `/settings/prompts`.
- `skills-empty`: `/settings/skills` headed Skills with New skill; with none, "No skills".
- `new-skill`: New skill (header or palette) opens a dialog: Name, Description (live count
  "0 / 1,024"), Instructions ("0 / 20,000"), "Disable model invocation", Cancel and Create skill;
  description text "Saved in Piano. Sessions started from now can use it."; Create skill stays
  off until Name, Description and Instructions are valid; success toasts "Skill created" and the
  row appears (name mono, description under it).
- `skill-row-actions`: "Skill actions <name>" holds View then a red Delete. View shows the
  skill's SKILL.md with "Copy skill"; Delete asks "Delete skill?" (`<name> is removed. Sessions
  started from now no longer load it.`) and toasts "Skill deleted".
- `prompts-empty`: `/settings/prompts` headed Prompts with New prompt; with none, "No prompts".
- `new-prompt`: New prompt opens a dialog shaped as New skill (Name, Description "0 / 1,024",
  Instructions "0 / 20,000", Cancel, Create prompt; no Disable model invocation). Create prompt
  stays off until the three fields are valid; success toasts "Prompt created" and the row shows
  name plus description.
- `prompt-row-actions`: "Prompt actions <name>" holds View then a red Delete. View shows the
  prompt file with "Copy prompt"; Delete asks "Delete prompt?" with the same "sessions started
  from now" wording and toasts "Prompt deleted".
- `palette-new`: on Skills, Mod+K offers "New skill"; on Prompts, "New prompt" (and from other
  screens after typing `settings` / `prompt` / `skill`).

## How to get to it (user POV)

- Sidebar: Settings (lands on Providers), then the Settings sections nav → Skills or Prompts.
- Palette: Mod+K, choose Skills / Prompts / New skill / New prompt.
- Address bar: `/settings/skills`, `/settings/prompts`.

## Driving it with agent-browser

Preconditions: a seeded launch, `. "$RUN/run.env"`, doctor passed;
`ab() { .agents/skills/verify-piano/scripts/ab.sh "$RUN" "$@"; }`.

- `open-settings`
  - Action: `ab set viewport 1280 800; ab open "$WEB_URL/"; ab wait --text "Loose session";
    ab find role button click --name "Settings" --exact; ab wait --url "**/settings/**"`
  - Result: URL is `/settings/providers`. Capture `01-providers`.
  - Action: `ab open "$WEB_URL/settings/skills"; ab wait --text "Skills"`
  - Result: title `Settings - Piano`, main starts `Skills` / `New skill`.
- `skills-empty` and `new-skill`
  - Action: on `/settings/skills`, `ab wait --text "No skills";
    ab find role button click --name "New skill" --exact; ab wait "[role=dialog]"`
  - Result: dialog reads `New skill` / `Saved in Piano…` / `Name` / `Description` /
    `0 / 1,024` / `Instructions` / `0 / 20,000` / `Disable model invocation` / `Cancel` /
    `Create skill`. Capture `02-new-skill`. Escape closes it without saving.
- `prompts-empty` and `new-prompt`
  - Action: `ab open "$WEB_URL/settings/prompts"; ab wait --text "No prompts";
    ab find role button click --name "New prompt" --exact; ab wait "[role=dialog]";
    ab find role textbox fill --name "Name" --exact "verify-prompt";
    ab find role textbox fill --name "Description" --exact "A short verify prompt";
    ab find role textbox fill --name "Instructions" --exact "Reply with OK.";
    ab find role button click --name "Create prompt" --exact;
    ab wait --text "verify-prompt"`
  - Result: before Create, the dialog matches New skill minus Disable model invocation; after,
    toast `Prompt created` and main lists `verify-prompt` / `A short verify prompt`. Capture
    `03-prompt-created`. Creating changes the database; relaunch afterwards for a clean seed.
- `prompt-row-actions`
  - Action: after `new-prompt`, wait out the create toast first
    (`ab wait --fn "!document.querySelector('[data-sonner-toast]')"`), then
    `ab find role button click --name "Prompt actions verify-prompt" --exact;
    ab find role menuitem click --name "View" --exact; ab wait "[role=dialog]"`
  - Result: the View dialog is titled with the prompt name and offers "Copy prompt" (and Close).
    Escape, then Delete through the same menu; confirm on "Delete prompt?" /
    `verify-prompt is removed. Sessions started from now no longer load it.`: toast
    `Prompt deleted`, and "No prompts" again when it was the only one. Capture `04-prompt-view`,
    `05-prompt-delete`, `06-prompt-deleted`.
- `palette-new`
  - Action: on `/settings/prompts`, `ab press Control+k; ab wait "[cmdk-input]";
    ab fill "[cmdk-input]" "new prompt"; ab snapshot -i | rg 'New prompt'`
  - Result: option `New prompt` is listed (and `Prompts` / `Skills` when the query is `settings`).
- Side effects: Skills and Prompts pages start no Pi. A new session's fake-Pi `start` audit gains
  `--prompt-template "$RUN/db/prompts"` and `--skill "$RUN/db/skills"` (paths under the run's
  database dir); proving a template reaches Pi needs a real or scripted model, not fake Pi.

## Gotchas

- Pi's own prompt and skill folders are not listed; only Piano-created ones appear.
- "Sessions started from now" is literal: an already-running session keeps the set it started with.
- Name and Description are required; Create stays off while either is empty or over the limit.
- The create toast covers the row's actions button until it leaves; wait
  `!document.querySelector('[data-sonner-toast]')` before opening the menu.
- Fake Pi does not exercise slash-completion of a prompt or model invocation of a skill.
