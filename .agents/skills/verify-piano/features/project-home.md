# Project home

A project's home at `/projects/<id>` lists its member sessions as hairline rows (title, folder,
branch, PR number, last activity) under a "Sessions" heading that carries their count, newest
first, and starts a new session filed in the project. Its header is the breadcrumb "Projects /
<name>". Users reach it from the session header, the sidebar's project groups and the Mod+K
palette, and the Projects index from its crumb. Deleting a project
moves its sessions to "No project"; unknown IDs show "Project not found".

## Sub-features

- `open-from-header`: the session header's project button opens the session's project home.
- `open-from-sidebar`: with sidebar Group by Project, the group's "New session in <name>" button.
- `project-menu`: the group's "Project menu for <name>" holds "Project settings", then a red
  "Delete project", as the home's header menu does.
- `open-from-palette`: Mod+K on a member session offers "Open project: <name>".
- `member-cards`: one `[data-slot=item]` row (`role=listitem`) per non-archived member session in
  the Sessions group's hairline list; its title button opens `/s/<id>`.
- `row-actions`: each row's "Session menu for <title>", revealed while pointed at, holds "Archive"
  and a red "Delete", the sidebar row's menu ([`open-session.md`](./open-session.md)
  `archive-delete`). Archive toasts "Session archived" and the row leaves, the count dropping;
  Delete asks "Delete session?" and toasts "Session deleted". The page stays.
- `new-in-project`: the composer above the cards ("First message") starts in the folder of the
  most recently active member, at the folder's own checkout;
  sending opens the new session, which joins the project.
- `header`: the pane header is one breadcrumb line, "Projects / <name>", the name being the `h1`,
  and ends with "Project menu for <name>": "Project settings", then a red "Delete project".
- `crumb`: the header's "Projects" button opens the Projects index at `/projects`.
- `sessions-heading`: the `h2` "Sessions" above the rows carries their count ("Sessions 1"); the
  header shows no count.
- `empty`: a project with no sessions shows its header, the composer on "Choose a folder", the
  heading "Sessions" with no count, and the line "No sessions yet".
- `settings`: "Project settings" (the header menu, the sidebar's project menu, Mod+K on the home) opens a
  dialog in place: Name and Instructions fields with a live count under Instructions ("0 / 20,000"
  on the seed, red past the limit with Save off), Save off until a field changes; saving closes it
  and toasts "Project saved". Scope selectors to `[role=dialog]`: the page's composer is a
  `textarea` too. What reaches Pi needs the real Pi: fake Pi ignores the extension, so check the
  model's request with a scripted loopback model, as `test/fixtures/RealPiDispatch.ts` does.
- `delete`: "Delete project" (the header menu, the sidebar's project menu, the Projects index's row
  menu, Mod+K on the home) asks first, saying how many sessions move to "No project"; confirming
  toasts "Project deleted", and on the project's own home or New page leaves for `/projects`.
  Anywhere else, the Projects index included, the page stays.
- `missing`: an unknown ID shows the alert "Project not found".

## How to get to it (user POV)

- Session page: click the header's project name (accessible name `Project: <name>`).
- Sidebar: View options → Group by → Project, then the group's "New session in <name>" button.
- Palette: Mod+K on a session that belongs to a project, type `open project`, choose the row.
- Address bar: `/projects/<id>`.

## Driving it with agent-browser

Preconditions: a seeded launch (`.agents/skills/verify-piano/scripts/launch.sh`), `. "$RUN/run.env"`, doctor passed;
`ab() { .agents/skills/verify-piano/scripts/ab.sh "$RUN" "$@"; }`.

- `open-from-header`
  - Action: open the member session and click its project button.
    `ab set viewport 1280 800; ab open "$WEB_URL/s/verify-plan"; ab wait --text "Answer 4.";
    .agents/skills/verify-piano/scripts/capture.sh "$RUN" project-home 01-session;
    ab find role button click --name "Project: Verify Project" --exact; ab wait --url "**/projects/verify"`
  - Result: `ab get url` ends in `/projects/verify`, `ab get title` is `Verify Project - Piano`,
    `ab eval "document.querySelector('main header').innerText"` is `Projects` / `/` /
    `Verify Project`, and `main`'s text continues with the composer's directory `repo` and the
    heading `Sessions` / `1`. Capture `02-home`.
- `crumb`
  - Action: `ab find role button click --name "Projects" --exact; ab wait --url "**/projects"`
  - Result: `ab get url` ends in `/projects` and `ab get title` is `Projects - Piano`. Capture
    `02b-index`.
- `member-cards`
  - Action: read the rows, then open the only one.
    `ab eval "[...document.querySelectorAll('main [data-slot=item]')].map(b => b.innerText.replace(/\n+/g, ' | '))"`;
    `ab click 'main [data-slot=item-title] button'; ab wait --url "**/s/verify-plan"`
  - Result: exactly one row, `Plan the verification | repo | main | Pull request | 222 | 1 hour ago`; "Loose
    session" (no project) is absent; the click lands on `/s/verify-plan`. Capture `03-card-opened`.
- `open-from-sidebar`
  - Action: `ab find role button click --name "View options" --exact;
    ab find role menuitem click --name "Group by Date" --exact;
    ab find role menuitemradio click --name "Project" --exact;
    ab wait --fn "!document.querySelector('[data-radix-popper-content-wrapper]')";
    ab find role button click --name "New session in Empty Project" --exact;
    ab wait --url "**/projects/empty"` (the button shows on hover; `find role button` reaches it)
  - Result: `/projects/empty`; the sidebar shows groups "Empty Project", "Verify Project" and "No
    project". Capture `04-empty`.
- `empty`
  - Action: read the page.
  - Result: the header reads `Projects` / `/` / `Empty Project`; main text continues `Choose a
    folder`, then `Sessions` (the `h2`, with no count) and `No sessions yet`; no row.
- `open-from-palette`
  - Action: `ab open "$WEB_URL/s/verify-plan"; ab wait --text "Answer 4."; ab press Control+k;
    ab wait "[cmdk-input]"; ab fill "[cmdk-input]" "open project";
    ab find role option click --name "Open project: Verify Project" --exact;
    ab wait --url "**/projects/verify"`
  - Result: `/projects/verify`; beside it, "Move to project: New project". On `/s/verify-loose`
    (no project) the query `project` offers no "Open project" row, only "Add to project: ..."
    rows (New project, Empty Project, Verify Project).
- `settings`
  - Action: on `/projects/verify`, `ab find role button click --name "Project menu for Verify Project" --exact;
    ab find role menuitem click --name "Project settings" --exact; ab wait "[role=dialog]";
    ab find role textbox fill --name "Instructions" --exact "Reply tersely.";
    ab find role button click --name "Save" --exact`
  - Result: the dialog read `Project settings` / `Name` / `Instructions` / `0 / 20,000` /
    `Cancel` / `Save` before filling and `14 / 20,000` after; Save closes it and toasts `Project
    saved`. Capture `05-settings`. Saving changes the database.
- `new-in-project`
  - Action: on `/projects/verify`, `ab fill '[aria-label="First message"]' "from project home";
    ab click '[aria-label="Send"]'; ab wait --text "echo: from project home"`
  - Result: combobox "Directory" read `repo` before sending, and no "Project" button; the send
    lands on `/s/<new id>`, and back on `/projects/verify` the heading reads `Sessions` / `2`
    with the new row first. Capture `05-new-in-project`. Sending changes the database; relaunch afterwards.
- `row-actions` (after `new-in-project`, on that new session, so the seed's row stays for
  `delete`)
  - Action: `ab find role button click --name "Session menu for from project home" --exact;
    ab find role menuitem click --name "Archive" --exact`; then send `to delete` from the home's
    composer, come back, and `ab find role button click --name "Session menu for to delete" --exact;
    ab find role menuitem click --name "Delete" --exact; ab wait --text "Delete session?"`,
    capture `08-delete-session`, `ab find role button click --name "Delete" --exact`
  - Result: toast `Session archived`, the row gone and the heading back to `Sessions` / `1`;
    the dialog reads `"to delete" and its transcript are removed from Pi's session store. This
    cannot be undone.`; toast `Session deleted`; still on `/projects/verify`.
- `delete`
  - Action: with Group by Project, on `/projects/verify`,
    `ab find role button click --name "Project menu for Verify Project" --exact;
    ab find role menuitem click --name "Delete project" --exact;
    ab wait --text "Delete project?"`, capture `06-confirm`, then
    `ab find role button click --name "Delete" --exact; ab wait --url "**/projects"`
  - Result: the dialog "Delete project?" reads `"Verify Project" is deleted; its session moves to No
    project. This cannot be undone.`; confirming lands on `/projects` without a "Verify Project" row, the sidebar has no "Verify
    Project" group and "Plan the verification" sits under "No project", and `/s/verify-plan`
    still opens with its history. Capture `06-deleted`. Deleting changes the database; relaunch
    afterwards.
- `missing`
  - Action: `ab open "$WEB_URL/projects/nope"; ab wait --text "Project not found"`
  - Result: `ab eval "document.querySelector('[role=alert]')?.innerText"` is
    `Project not found` / `This project is not in Piano's database.` Capture `07-missing`.
- Side effects: a project home starts no Pi session. Before `new-in-project`, `rg -c '"command":"prompt"' "$AUDIT"` finds
  nothing (prints nothing, exit 1) and `rg -vc '"sessionId":"probe"' "$AUDIT"` likewise: the audit
  holds only the `probe` entries from the session pages visited.

## Gotchas

- The palette's "Open project: <name>" row comes from the current session's menu, so it exists only
  on a member session's page; on the New page or a loose session it is absent, which is not a bug.
- The sidebar group name only folds the group; its "New session in <name>" button is the way home.
- "Group by" is a submenu whose trigger's name includes the current choice (`Group by Date`).
- `ab wait --text "X" --state hidden` is not a valid form; wait on a URL or a `--fn` predicate.
- Row times are relative ("1 hour ago") and age while you drive.
- The tab title briefly reads `Project - Piano` before the project loads; wait for the heading.
