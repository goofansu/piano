# Project home

A project's home at `/projects/<id>` lists its member sessions as cards (title, folder, branch, PR
number, last activity), newest first, and starts a new session filed in the project. Users reach it
from the session header, the sidebar's project groups and the Mod+K palette. Archived projects say
so and offer Unarchive; unknown IDs show "Project not found".

## Sub-features

- `open-from-header`: the session header's project button opens the session's project home.
- `open-from-sidebar`: with sidebar Group by Project, "Project menu for <name>" → "Open project".
- `open-from-palette`: Mod+K on a member session offers "Open project: <name>".
- `member-cards`: one `button[data-slot=item]` card per member session; clicking opens `/s/<id>`.
- `new-in-project`: the composer above the cards ("First message", placeholder "New session in
  <name>") starts in the folder of the most recently active member, at the folder's own checkout;
  sending opens the new session, which joins the project.
- `header`: the pane header names the project with its session count beneath ("1 session"; "· Archived" when archived).
- `empty`: a project with no sessions shows its header ("0 sessions") and the composer on "Choose a folder".
- `archived`: "This project is archived." with an "Unarchive project" button.
- `missing`: an unknown ID shows the alert "Project not found".

## How to get to it (user POV)

- Session page: click the header's project name (accessible name `Project: <name>`).
- Sidebar: View options → Group by → Project, then the project's menu → Open project.
- Palette: Mod+K on a session that belongs to a project, type `open project`, choose the row.
- Address bar: `/projects/<id>`.

## Driving it with agent-browser

Preconditions: a seeded launch (`$S/launch.sh`), `. "$RUN/run.env"`, doctor passed;
`ab() { $S/ab.sh "$RUN" "$@"; }`.

- `open-from-header`
  - Action: open the member session and click its project button.
    `ab set viewport 1280 800; ab open "$WEB_URL/s/verify-plan"; ab wait --text "Answer 4.";
    $S/capture.sh "$RUN" project-home 01-session;
    ab find role button click --name "Project: Verify Project" --exact; ab wait --url "**/projects/verify"`
  - Result: `ab get url` ends in `/projects/verify`, `ab get title` is `Verify Project - Piano`, and
    `ab eval "document.querySelector('main').innerText"` starts with `Verify Project` and
    `1 session`, then the composer's directory `repo`. Capture `02-home`.
- `member-cards`
  - Action: read the cards, then open the only one.
    `ab eval "[...document.querySelectorAll('main button[data-slot=item]')].map(b => b.innerText.replace(/\n+/g, ' | '))"`;
    `ab click 'main button[data-slot=item]'; ab wait --url "**/s/verify-plan"`
  - Result: exactly one card, `Plan the verification | repo | main | #222 | 1 hour ago`; "Loose
    session" (no project) is absent; the click lands on `/s/verify-plan`. Capture `03-card-opened`.
- `open-from-sidebar`
  - Action: `ab find role button click --name "View options" --exact;
    ab find role menuitem click --name "Group by Date" --exact;
    ab find role menuitemradio click --name "Project" --exact;
    ab wait --fn "!document.querySelector('[data-radix-popper-content-wrapper]')";
    ab find role button click --name "Project menu for Empty Project" --exact;
    ab find role menuitem click --name "Open project" --exact; ab wait --url "**/projects/empty"`
  - Result: `/projects/empty`; the sidebar shows groups "Empty Project", "Verify Project", "No
    project" and no "Archived Project". Capture `04-empty`.
- `empty`
  - Action: read the page.
  - Result: main text starts `Empty Project` / `0 sessions` / `Choose a folder`, and no card.
- `open-from-palette`
  - Action: `ab open "$WEB_URL/s/verify-plan"; ab wait --text "Answer 4."; ab press Control+k;
    ab wait "[cmdk-input]"; ab fill "[cmdk-input]" "open project";
    ab find role option click --name "Open project: Verify Project" --exact;
    ab wait --url "**/projects/verify"`
  - Result: `/projects/verify`. On `/s/verify-loose` (no project) the same query offers no "Open
    project" row, only "Add to project: ..." rows.
- `new-in-project`
  - Action: on `/projects/verify`, `ab fill '[aria-label="First message"]' "from project home";
    ab click '[aria-label="Send"]'; ab wait --text "echo: from project home"`
  - Result: combobox "Directory" read `repo` before sending, and no "Project" button; the send
    lands on `/s/<new id>`, and back on `/projects/verify` the header reads `2 sessions` with the
    new card first. Capture `05-new-in-project`. Sending changes the database; relaunch afterwards.
- `archived`
  - Action: `ab open "$WEB_URL/projects/archived"; ab wait --text "This project is archived."`
  - Result: main text `Archived Project`, `This project is archived.`, `Unarchive project`.
    Capture `06-archived`. Clicking Unarchive changes the database; relaunch afterwards.
- `missing`
  - Action: `ab open "$WEB_URL/projects/nope"; ab wait --text "Project not found"`
  - Result: `ab eval "document.querySelector('[role=alert]')?.innerText"` is
    `Project not found` / `This project is not in Piano's database.` Capture `07-missing`.
- Side effects: a project home starts no Pi session. `rg -c '"command":"prompt"' "$AUDIT"` finds
  nothing (prints nothing, exit 1) and `rg -vc '"sessionId":"probe"' "$AUDIT"` likewise: the audit
  holds only the `probe` entries from the session pages visited.

## Gotchas

- The palette's "Open project: <name>" row comes from the current session's menu, so it exists only
  on a member session's page; on the New page or a loose session it is absent, which is not a bug.
- The sidebar group name only folds the group; its "Project menu for <name>" is the way home.
- "Group by" is a submenu whose trigger's name includes the current choice (`Group by Date`).
- `ab wait --text "X" --state hidden` is not a valid form; wait on a URL or a `--fn` predicate.
- Card times are relative ("1 hour ago") and age while you drive.
- The tab title briefly reads `Project - Piano` before the project loads; wait for the heading.
