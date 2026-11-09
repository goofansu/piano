# Projects index

`/projects` lists every project as one hairline-divided row: its name, the folders its sessions run
in with the session count ("repo · 1 session", or "No sessions yet"), and when a member last moved,
newest activity first with empty projects last by name. Done projects sit in a collapsed "Done"
group below the open projects, dated with "Done …" by when they were marked done. A row opens the project's home and
carries the sidebar's project menu, revealed while pointed at; the header's "New project" opens
the New project dialog. Rows carry no status: session state lives on the home. The page reads
only what the browser already holds.

## Sub-features

- `rows`: one `[data-slot=item]` row per open project, in order of newest member activity; archived
  sessions neither count nor date a project; clicking a row opens `/projects/<id>`.
- `context`: a row's second line is `<folders> · <n> session(s)`, each folder named once, or
  `No sessions yet`; the time at the row's end is absent for an empty open project.
- `row-menu`: "Project menu for <name>" over the row's end holds "Project settings", "Mark project
  done" ("Reopen project" once done), then a red "Delete project", as on the project home ([`project-home.md`](./project-home.md) `settings`,
  `delete`); deleting from here keeps the index open.
- `done`: Mark project done moves the row into the folded Done group without archiving its
  sessions. Expand "Done <n>" to open its home or use Reopen project to return it to the open list.
- `sidebar-row`: the sidebar's "Projects" row under New session opens the index and reads as the
  current row (`aria-current=page`) while it is open.
- `palette-row`: Mod+K offers "Projects" under Global commands on every screen, Settings included;
  on `/projects` it also offers the header's "New project", which opens the same dialog.
- `new-project`: the header's "New project" opens the New project dialog, shaped as Project
  settings is: Name and Instructions (optional), with a live count under Instructions
  ("0 / 20,000") that turns red past the limit while Create stays off. "Create project" saves both
  in one write, toasts "Project created" and lands on the new project's home (`/projects/<id>`),
  whose composer starts the project's first session with its instructions.
- `address`: the tab title is `Projects - Piano`; back from a home returns to the index.
- `empty`: with no projects the page shows one centred empty state, "No projects yet", and New
  project stays in the header.
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
    "Loose session" (no project) is absent from these main-pane rows. Capture `01-index`.
  - Action: `ab click 'main [data-slot=item]:has([aria-label="Project menu for Verify Project"]) [data-slot=item-title] button';
    ab wait --url "**/projects/verify"`
  - Result: the home's header reads `Projects` / `/` / `Verify Project`. Capture `02-home`.
- `row-menu`
  - Action: back on `/projects`, `ab click 'main [aria-label="Project menu for Verify Project"]';
    ab snapshot -i | rg menuitem; ab press Escape`
  - Result: menuitems `Project settings`, `Mark project done`, `Delete project`.
- `done` (seeded project, before creating other projects)
  - Action: `ab click 'main [aria-label="Project menu for Verify Project"]';
    ab find role menuitem click --name "Mark project done" --exact; ab wait --text "Done"`.
    Capture `03-done-folded`, then `ab find role button click --name "Done 1" --exact;
    ab wait '[aria-label="Done projects"]'`.
  - Result: Verify Project is under Done, still with `repo · 1 session`; Empty Project remains
    in the open list. Capture `04-done-expanded`. Open its title button as in `rows`: the home
    shows a Done badge and its session. Reopen through that home's menu (see
    [`project-home.md`](./project-home.md) `done`), then return to `/projects` for the next steps.
- `sidebar-row`
  - Action: `ab open "$WEB_URL/s/verify-plan"; ab wait --text "Answer 4.";
    ab find role button click --name "Projects" --exact; ab wait --url "**/projects"`
  - Result: `ab eval "document.querySelector('[aria-current=page]')?.innerText"` is `Projects`.
- `palette-row`
  - Action: on `/settings/providers`, `ab press Control+k; ab wait "[cmdk-input]";
    ab fill "[cmdk-input]" "projects"; ab wait '[cmdk-list][aria-busy="false"]';
    ab find role option click --name "Projects" --exact;
    ab wait --url "**/projects"`
  - Result: `/projects`, Settings closed, `main h1` reads `Projects`.
- `new-project`
  - Action: on `/projects`, `ab find role button click --name "New project" --exact;
    ab wait "[role=dialog]"; ab find role textbox fill --name "Name" --exact "Launch subscriptions";
    ab find role textbox fill --name "Instructions" --exact "Reply tersely.";
    ab find role button click --name "Create project" --exact; ab wait --text "Launch subscriptions"`
  - Result: the dialog read `New project` / `Name` / `Instructions` / `0 / 20,000` / `Cancel` /
    `Create project`, the count `14 / 20,000` once filled; Create project was off until Name had
    text; toast `Project created`; the page is now `/projects/<new id>`, the project's home,
    headed "Launch subscriptions"; back on `/projects` the new project is a row with `No sessions
    yet`, and its Project settings dialog shows the instructions. Creating changes the database;
    relaunch afterwards.
- `address`
  - Action: back on `/projects`, `ab click 'main [data-slot=item]:has([aria-label="Project menu for Verify Project"]) [data-slot=item-title] button';
    ab wait --url "**/projects/verify"; ab back;
    ab wait --url "**/projects"; ab get title`
  - Result: `Projects - Piano`.
- `empty`
  - Action: on an `--empty` launch, `ab open "$WEB_URL/projects"; ab wait --text "No projects yet"`.
  - Result: no `[data-slot=item]`; "New project" is in the header.
- `phone` (on a seeded run again, not the `--empty` instance)
  - Action: `ab set viewport 390 844; ab open "$WEB_URL/projects"; ab wait --text "Verify Project";
    ab eval "document.documentElement.scrollWidth + ' ' + document.documentElement.clientWidth"`
  - Result: `390 390`. Capture `07-phone`.
- Side effects: the index starts no Pi. Compare `start` audit counts immediately before and
  after index-only navigation (`rg -c '"command":"start"' "$AUDIT"`, treating an absent audit as
  zero). This multi-page recipe also opens populated project homes and session pages, which can
  start catalog probes; absence of `prompt` alone does not prove absence of Pi starts.

## Gotchas

- Rows are `[data-slot=item]` elements inside `role=listitem` wrappers, as the project home's
  rows are; the button inside is the
  row's title, named by the project, which a project-grouped sidebar repeats. Scope to `main`
  and identify the intended row by its project-menu label as above; the bare title selector
  matches every project, so the first match changes with activity order.
- `--exact` on "Projects" matters: the sidebar's group buttons and "New session in <name>" also
  contain the word on a project-grouped sidebar.
- Times are relative and age while you drive.
