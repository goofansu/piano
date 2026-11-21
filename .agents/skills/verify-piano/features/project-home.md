# Project home

- Project instructions reaching Pi need real Pi with a scripted loopback model: fake Pi ignores
  the extension. `test/fixtures/RealPiDispatch.ts` is an infrastructure example, not an existing
  assertion.
## Driving it with agent-browser

Preconditions: a seeded launch.

- `open-from-header`
  - Action: open the member session and click its project button.
    `ab set viewport 1280 800; ab open "$WEB_URL/s/verify-plan"; ab wait --text "Answer 4.";
    .agents/skills/verify-piano/scripts/capture.sh "$RUN" project-home 01-session;
    ab find role button click --name "Project: Verify Project" --exact; ab wait --url "**/projects/verify"`
  - Result: `ab get url` ends in `/projects/verify`, `ab get title` is `Verify Project - Piano`,
    `ab eval "document.querySelector('main header').innerText"` is `Projects` / `/` /
    `Verify Project`, and `main`'s text continues with the composer's directory `repo` and the
    heading `Sessions` / `1`. Capture `02-home`.
- `open-from-header` on narrow screens
  - Action: on `/s/verify-plan`, `ab set viewport 700 800;
    ab find role button click --name "Session information and actions" --exact;
    ab find role button click --name "Move to project" --exact`; capture `02c-project-picker`.
    `ab find role button click --name "Verify Project" --exact; ab wait --url "**/projects/verify"`.
  - Result: the sheet closes and the project home opens. Capture `02d-mobile-home`, then
    `ab set viewport 1280 800` for the remaining steps.
- `activity`
  - Covered by `node test/browser/open-session.mjs <evidence>` (`home-activity-*` captures): at
    390px a held QA Project member reads `Working`, then the same row reads `Finished` in place
    when the turn ends, with rows in the same order. Starting and lost-connection activity is
    covered by `test/integration/sessions/SessionCatalog.test.ts`.
- `crumb`
  - Action: `ab click 'main [data-slot=breadcrumb-link]'; ab wait --url "**/projects"`
  - Result: `ab get url` ends in `/projects` and `ab get title` is `Projects - Piano`. Capture
    `02b-index`.
- `member-cards`
  - Action: return from the index to `/projects/verify`, then read the rows and open the only one.
    `ab open "$WEB_URL/projects/verify"; ab wait --text "Plan the verification";
    ab eval "[...document.querySelectorAll('main [data-slot=item]')].map(b => b.innerText.replace(/\n+/g, ' | '))"`;
    `ab click 'main [data-slot=item-title] button'; ab wait --url "**/s/verify-plan"`
  - Result: exactly one row containing `Plan the verification`, `repo`, `main`, `#222` and
    its relative activity time (with screen-reader Folder / Git branch / Pull request labels).
    "Loose session" is absent; the click lands on `/s/verify-plan`. Capture `03-card-opened`.
- `open-from-sidebar`
  - Action: `ab find role button click --name "View options" --exact;
    ab find role menuitem click --name "Group by Date" --exact;
    ab wait --fn "[...document.querySelectorAll('[role=menu]')].every(e => e.getAnimations({subtree:true}).every(a => a.playState !== 'running'))";
    ab find role menuitemradio click --name "Project" --exact;
    ab wait --fn "!document.querySelector('[role=menu]')";
    ab find role button click --name "New session in Empty Project" --exact;
    ab wait --url "**/projects/empty"` (the button shows on hover; `find role button` reaches it)
  - Result: `/projects/empty`; the sidebar shows groups "Empty Project", "Verify Project" and "No
    project". Capture `04-empty`.
- `empty`
  - Action: read the page.
  - Result: the header reads `Projects` / `/` / `Empty Project`; main text continues `Directory`, then `Sessions` (the `h2`, with no count) and `No sessions yet`; no row.
- `open-from-palette`
  - Action: `ab open "$WEB_URL/s/verify-plan"; ab wait --text "Answer 4."; ab press Control+k;
    ab wait "[cmdk-input]"; ab fill "[cmdk-input]" "open project";
    ab wait '[cmdk-list][aria-busy="false"]'; ab find role option click --name "Open project: Verify Project" --exact;
    ab wait --url "**/projects/verify"`
  - Result: `/projects/verify`. Before choosing the navigation row, the palette also offered
    "Move to project: New project". On `/s/verify-loose` (no project), query `project`: the
    Session commands group offers "Add to project: ..." rows (New project, Empty Project,
    Verify Project), but no "Open project" row. Global commands such as "Projects" and
    "Group by project" can still match.
- `done`
  - Action: on `/projects/verify`, `ab click 'main [aria-label="Project menu for Verify Project"]';
    ab find role menuitem click --name "Mark project done" --exact;
    ab wait --fn "document.querySelector('main header').innerText.includes('Done')"`.
  - Result: the header has a Done badge, `Plan the verification` remains in Sessions, and the
    composer remains. With Group by Project, navigation "Sessions" has a Done label before the
    Verify Project group. Capture `09-done-home`. If arriving from the index's `done` recipe,
    start with this observation rather than marking it again.
  - Reopen: `ab click 'main [aria-label="Project menu for Verify Project"]';
    ab find role menuitem click --name "Reopen project" --exact;
    ab wait --fn "!document.querySelector('main header').innerText.includes('Done')"`.
    Capture `10-reopened`. The project returns to the open list/groups without changing membership.
- `settings`
  - Action: on `/projects/verify`, `ab click 'main [aria-label="Project menu for Verify Project"]';
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
    with the new row first. Capture `05-new-in-project`. Continue with `row-actions` before relaunching.
- `row-actions` (after `new-in-project`, back on the home, so the seed's row stays for `delete`)
  - Action: `ab open "$WEB_URL/projects/verify"; ab wait --text "from project home";
    ab click 'main [aria-label="Session menu for from project home"]';
    ab find role menuitem click --name "Archive" --exact`; then send `to delete` from the home's
    composer, come back, and `ab click 'main [aria-label="Session menu for to delete"]';
    ab find role menuitem click --name "Delete" --exact; ab wait --text "Delete session?"`,
    capture `08-delete-session`, `ab find role button click --name "Delete" --exact`
  - Result: toast `Session archived`, the row gone and the heading back to `Sessions` / `1`;
    the dialog reads `"to delete" and its transcript are removed from Pi's session store. This
    cannot be undone.`; toast `Session deleted`; still on `/projects/verify`.
- `delete`
  - Action: with Group by Project, on `/projects/verify`,
    `ab wait --fn "document.querySelector('main h1')?.textContent === 'Verify Project'";
    ab click 'main [aria-label="Project menu for Verify Project"]';
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
    `Project not found` / `This project is not in Piano's database.` / `Projects` (the recovery
    button). Capture `07-missing`.
- Side effects: a project home starts no Pi session. Before `new-in-project`, `rg -c '"command":"prompt"' "$AUDIT"` finds
  nothing (prints nothing, exit 1) and `rg -vc '"sessionId":"probe"' "$AUDIT"` likewise: the audit
  holds only `probe` entries for uncached composer catalogs (session pages or populated homes).

## Gotchas

- The palette's "Open project: <name>" row comes from the current session's menu, so it exists only
  on a member session's page; on the New page or a loose session it is absent, which is not a bug.
- The sidebar group name only folds the group; its "New session in <name>" button is the way home.
- On desktop, "Group by" is a submenu whose trigger's name includes the current choice
  (`Group by Date`). On narrow viewports its choices are inline in View options; see
  [Open a session](./open-session.md) `view-options-phone`.
- Scope home menus to `main`: a project-grouped sidebar repeats the project menu, and both
  surfaces have session row menus. A global name lookup can act on the sidebar instead.
- `ab wait --text "X" --state hidden` is not a valid form; wait on a URL or a `--fn` predicate.
- Row times are relative ("1 hour ago") and age while you drive.
- The tab title briefly reads `Project - Piano` before the project loads; wait for the heading.
