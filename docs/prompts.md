# Prompts

Open **Settings → Prompts**, or choose **New prompt** from Mod+K on that page. A prompt is a
[Pi prompt template](https://pi.dev/docs/latest/prompt-templates): its name becomes a `/name`
command in the composer and its description shows in completion. Its instructions take Pi's substitutions (`$1`, `$@`, `${1:-default}`, …), expanded by Pi.

- **New prompt** stays off until the name, description and instructions are filled and within their
  limits, the same check the server applies (`checkPromptDraft`). It saves `<name>.md` in Piano's
  prompts folder, `prompts/` beside the [registry database](configuration.md#environment-variables)
  (`~/.local/share/piano/prompts/` by default). Names, descriptions and instructions follow the
  [draft rule Settings › Skills shares](configuration.md#pianos-prompts-and-skills). Piano writes no
  argument hint: Pi does not pass it to the composer. An existing name is refused, never overwritten.
- **View** shows the template file exactly as saved, front matter included, with a copy button.
- **Delete** removes that file, after confirmation.
- The page lists that folder only. Prompts in Pi's own folders (`~/.pi/agent/prompts/`, a
  project's `.pi/prompts/`) stay Pi's: the composer still offers them, Settings does not list them.

Every Pi child Piano starts loads the folder with `--prompt-template`, so a change reaches sessions
started from then on; a running session keeps the templates it started with. A prompt created in
Piano is not loaded by Pi run outside Piano.

## Boundaries

`server/Prompts.ts` owns the folder (INV-01). Pi parses and expands templates (INV-12): the list
reads front matter with Pi's `parseFrontmatter` and falls back to the instructions' first line as Pi does.
The list sends each prompt's file with it, so View opens without another request; prompts are
text the person wrote in Piano, so they leave without display redaction, as project instructions do.
No registry records are added.

## Verification

`test/Prompts.test.ts` creates prompts and probes a real, isolated Pi: Pi offers Piano's prompts
beside a personal one, the list holds only Piano's, refusals name their field, and a deleted prompt
is no longer offered. The browser journey (create, duplicate refusal, palette row, composer
completion, delete, phone dialog) ran on a scratch instance with fake Pi, which lists each
`--prompt-template` folder's files by name.
