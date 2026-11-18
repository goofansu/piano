# Prompts

Open **Settings → Prompts**, or choose **New prompt** from Mod+K on that page. A prompt is a
[Pi prompt template](https://pi.dev/docs/latest/prompt-templates): its name becomes a `/name`
command in the composer and its description shows in completion. Its instructions take Pi's substitutions (`$1`, `$@`, `${1:-default}`, …), expanded by Pi.

- **Create prompt** stays off until the name, description and instructions are filled and within their
  limits, the same check the server applies (`checkDraft` in `shared/drafts.ts`). It saves
  `<name>.md` in Piano's prompts folder, `prompts/` beside the [registry database](configuration.md#environment-variables)
  (`~/.local/share/piano/prompts/` by default). Names, descriptions and instructions follow the
  [draft rule Settings › Skills shares](configuration.md#pianos-prompts-and-skills). Piano writes no
  argument hint: Pi does not pass it to the composer. An existing name is refused, never overwritten.
- In a session, asking the agent to create or change a prompt shows the file (or a diff) above the
  composer; **Save prompt** saves it here, **Cancel** writes nothing
  ([saving from a session](configuration.md#saving-from-a-session)).
- **View** shows the template file exactly as saved, front matter included, with a copy button.
- **Delete** removes that file, after confirmation.
- The page lists that folder only. Prompts in Pi's own folders (`~/.pi/agent/prompts/`, a
  project's `.pi/prompts/`) stay Pi's: the composer still offers them, Settings does not list them.

Every Pi child Piano starts loads the folder with `--prompt-template`, so a change reaches sessions
started from then on; a running session keeps the templates it started with. A prompt created in
Piano is not loaded by Pi run outside Piano.
