# Projects index

## Driving it with agent-browser

Preconditions: a seeded launch. Mod+K is `Control+k` on Linux and `Meta+k` on macOS.

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
- `palette-projects` and `palette-filter` (before marking the seed done)
  - Action: `ab press Control+k; ab wait '[cmdk-input]'` shows active Verify Project and Empty
    Project in Projects. Capture `08-active-projects`. Then `ab fill '[cmdk-input]' '!';
    ab wait '[cmdk-list][aria-busy="false"]'`; capture `09-filter-discovery`.
    `ab find role option click --name 'Projects only · !p' --exact;
    ab wait --fn "document.querySelector('[cmdk-input]').value === '!p '";
    ab wait '[cmdk-list][aria-busy="false"]'`.
  - Result: the palette stays open with only the Projects group. Capture `10-projects-only`.
    `ab fill '[cmdk-input]' '!p Verify'; ab wait '[cmdk-list][aria-busy="false"]';
    ab find role option click --name 'Verify Project' --exact;
    ab wait --url '**/projects/verify'` opens the home.
  - Done/reopen: after the `done` action, query `!p Verify` and wait for settled results:
    `No sessions, projects or commands match.` appears. Escape and reopen the project through
    its menu; the same query offers Verify Project again. Capture both results.
  - Paging prerequisite: more than 50 active projects, created through New project (or an
    explicitly identified pre-launch scratch fixture), not an edited live database. Query `!p`,
    wait for settled results, then `ab find role option click --name 'Next projects' --exact`.
    The range changes and Previous projects appears; choosing it returns to the first page
    without navigation or closing the palette. Capture both pages. The two-project seed cannot
    prove paging; report this branch separately when it is not exercised.
- `palette-keyboard` (desktop, unfiltered catalog taller than the palette)
  - Action: on `/projects`, `ab press Control+k; ab wait '[cmdk-list][aria-busy="false"]'`;
    capture the list, then `ab press End`.
  - Result: the last row is selected and fully visible; capture it and record
    `ab eval "(() => { const row=document.querySelector('[cmdk-item][aria-selected=true]'), list=document.querySelector('[cmdk-list]'); return {selected:row.textContent,row:row.getBoundingClientRect().toJSON(),list:list.getBoundingClientRect().toJSON(),scrollTop:list.scrollTop}; })()"`.
    The row's top/bottom stay within the list's bounds and `scrollTop` is positive. No action
    ran; `ab press Escape` closes the palette. A list that fits without scrolling cannot prove this.
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
