# Projects index

`/projects` lists every project as one hairline-divided row: its name, the folders its sessions run
in with the session count ("repo · 1 session", or "No sessions yet"), and when a member last moved,
newest activity first with empty projects last by name. A row opens the project's home; the
header's "New project" opens the New project dialog. Rows carry no menu and no status: operations
and session state live on the home. The page reads only what the browser already holds.

## Sub-features

- `rows`: one `[data-slot=item]` row per project, in order of newest member activity; archived
  sessions neither count nor date a project; clicking a row opens `/projects/<id>`.
- `context`: a row's second line is `<folders> · <n> session(s)`, each folder named once, or
  `No sessions yet`; the time at the row's end is absent for an empty project.
- `sidebar-row`: the sidebar's "Projects" row under New session opens the index and reads as the
  current row (`aria-current=page`) while it is open.
- `palette-row`: Mod+K offers "Projects" under Global commands on every screen, Settings included.
- `new-project`: the header's "New project" opens the New project dialog, shaped as Project
  settings is: Name and Instructions (optional), with a live count under Instructions
  ("0 / 20,000") that turns red past the limit while Create stays off. "Create project" saves both in one write, toasts
  "Project saved" and lands on the new project's New page, as the sidebar's New project does, so
  the project's first session already carries its instructions.
- `address`: the tab title is `Projects - Piano`; back from a home returns to the index.
- `empty`: with no projects the list is one line, "No projects yet", and New project stays in the
  header.
- `phone`: at 390px the header keeps its sidebar button, title and New project; no horizontal scroll.

## How to get to it (user POV)

- Sidebar: the "Projects" row under "New session".
- Palette: Mod+K, type `projects`, choose "Projects".
- Address bar: `/projects`.

## Driving it with agent-browser

Preconditions: a seeded launch (`.agents/skills/verify-piano/scripts/launch.sh`), `. "$RUN/run.env"`, doctor passed;
`ab() { .agents/skills/verify-piano/scripts/ab.sh "$RUN" "$@"; }`. Mod+K is `Control+k` on Linux and `Meta+k` on macOS.

- `rows` and `context`
  - Action: `ab set viewport 1280 800; ab open "$WEB_URL/projects"; ab wait --text "Verify Project";
    ab eval "[...document.querySelectorAll('main [data-slot=item]')].map(b => b.innerText.replace(/\n+/g, ' | '))"`
  - Result: `["Verify Project | repo · 1 session | 1 hour ago", "Empty Project | No sessions yet"]`;
    "Loose session" (no project) appears nowhere. Capture `01-index`.
  - Action: `ab click 'main [data-slot=item]'; ab wait --url "**/projects/verify"`
  - Result: the home's header reads `Verify Project` / `1 session`. Capture `02-home`.
- `sidebar-row`
  - Action: `ab open "$WEB_URL/s/verify-plan"; ab wait --text "Answer 4.";
    ab find role button click --name "Projects" --exact; ab wait --url "**/projects"`
  - Result: `ab eval "document.querySelector('[aria-current=page]')?.innerText"` is `Projects`.
- `palette-row`
  - Action: on `/settings/providers`, `ab press Control+k; ab wait "[cmdk-input]";
    ab fill "[cmdk-input]" "projects"; ab find role option click --name "Projects" --exact;
    ab wait --url "**/projects"`
  - Result: `/projects`, Settings closed, `main h1` reads `Projects`.
- `new-project`
  - Action: on `/projects`, `ab find role button click --name "New project" --exact;
    ab wait "[role=dialog]"; ab find role textbox fill --name "Name" --exact "Launch subscriptions";
    ab find role textbox fill --name "Instructions" --exact "Reply tersely.";
    ab find role button click --name "Create project" --exact; ab wait --text "Launch subscriptions"`
  - Result: the dialog read `New project` / `Name` / `Instructions` / `Cancel` / `Create project`;
    Create project was off until Name had text; the page is now
    `/projects/<new id>/new` titled "Launch subscriptions"; back on `/projects` the new project is
    a row with `No sessions yet`, and its Project settings dialog shows the instructions. Creating
    changes the database; relaunch afterwards.
- `address`
  - Action: `ab click 'main [data-slot=item]'; ab wait --url "**/projects/verify"; ab back;
    ab wait --url "**/projects"; ab get title`
  - Result: `Projects - Piano`.
- `empty`
  - Action: on an `--empty` launch, `ab open "$WEB_URL/projects"; ab wait --text "No projects yet"`.
  - Result: no `[data-slot=item]`; "New project" is in the header.
- `phone`
  - Action: `ab set viewport 390 844; ab open "$WEB_URL/projects"; ab wait --text "Verify Project";
    ab eval "document.documentElement.scrollWidth + ' ' + document.documentElement.clientWidth"`
  - Result: `390 390`. Capture `07-phone`.
- Side effects: the index starts no Pi. `rg -c '"command":"prompt"' "$AUDIT"` finds nothing.

## Gotchas

- Rows are `Item`s with `role=listitem`, as the project home's cards are, so `find role button`
  does not reach them; click by `data-slot`.
- `--exact` on "Projects" matters: the sidebar's group buttons and "New session in <name>" also
  contain the word on a project-grouped sidebar.
- Times are relative and age while you drive.
