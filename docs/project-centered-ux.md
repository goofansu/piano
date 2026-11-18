# Project-centered UX

## Screens

### Projects index, `/projects`

A listing page, shaped as a Settings page is: one header, one `SettingsList` of hairline rows,
the page's one primary action in the header.

- **Header:** the title "Projects"; at the end, the primary button "New project". The New project
  dialog has the same two fields as Project settings, Name and optional Instructions, because
  instructions reach a session only when its Pi starts: given at creation, the project's first
  session carries them. Saving lands on the new project's New page, as the sidebar's New project
  does. No context line: the list is the content.
- **Row:** the project's name, a context line with the folders its sessions run in and its
  session count ("piano, api · 3 sessions"; "No sessions yet" for an empty project), and the
  time of its last activity at the end. The row opens the home and carries no status glyph: the
  index is for scanning what exists and when it last moved, and per-session state lives on the
  home. On hover it shows the sidebar's project menu (Project settings, Mark project done,
  Delete project); deleting from it stays on the index, and deleting from the project's home
  lands here.
- **Order:** last activity first, from the newest member's `updatedAt`, the registry field that
  already exists so "a project's recency follows its members".
- **Done:** a project marked done leaves the list for a "Done" group beneath it, folded with its
  count until opened, its rows the most recently marked done first with that time at the end.
  Its menu offers Reopen project in place of Mark project done. Done is the project's state
  only: its sessions keep theirs, stay in the sidebar and the palette, and a session started
  from its home reopens it. Nothing marks a project done by itself, so the index never changes
  under the user. Delete remains the only way to remove the grouping.
- **Empty state:** one line, "No projects yet", only while no project exists; an index whose
  projects are all done shows the Done group alone. New project stays in the header.
- **No project:** the index lists projects only. Sessions without one stay reachable from the
  sidebar and from session search, and each session's menu offers "Add to project". A row with
  no home to open would be a dead row.
- **Data:** everything comes from what the browser already holds: `projects` and the session
  catalog. No request, no Git, no Pi (PIN-83, as the home today).

### Project home, `/projects/<id>`

Keeps its two jobs, start work here and read the project's work, and takes Linear's structure.

- **Header:** one line, "Projects / Verify Project", the same shadcn Breadcrumb as the session
  header's: "Projects" is the way up to the index and the project's name is the `h1`. No context
  line: the session count moved to the Sessions heading, and the folders are on each row. The
  `…` menu stays at the end with Project settings, Mark project done (Reopen project once done)
  and Delete project. A done project's title is followed by "Done", the home's one statement of
  it. (A context line with the folders and the count was considered and dropped: it repeated
  what the rows show.)
- **Composer:** unchanged, first in the column: a session started here joins the project and runs
  in the most recent member's folder.
- **Sessions:** a titled group, as a Settings page's (`SettingsGroup`), "Sessions" with the count
  beside the name as a muted number, whose rows sit in one hairline-divided list
  (`SettingsList`) as the index's do. A row keeps its facts, title, folder, branch, saved pull
  request number and last activity, and keeps its place while the page is open. Later it gains
  the `StatusDot` slot that breathes while that session's Pi is working.
- **Empty project:** the composer, the "Sessions" heading without a count, and one line, "No
  sessions yet", as the sidebar group and the index say it; the count is left off so the fact
  is stated once.
- **Later, Pull requests:** a second group, one row per member session with a saved pull request
  link: number, title, and its state ("Open", "Merged", with the matching dot tone). Piano reads
  GitHub only for linked sessions already, in the session header; this group shows the same
  facts in one place. It is not verification or approval (INV-09, INV-10).

### Sidebar

One row "Projects", with the project icon the New page's Project picker uses, first under the
header, where the list begins. The header itself takes the one header shape and stays light: the
hide control at its left, on the rows' left edge and at the point where each pane's show control
appears once the sidebar is collapsed, since on desktop the sidebar keeps the pane's frame and
its header is the pane header's row; then search, View options and New session as the
filled primary action at the end, the strip's one accent, which frees the row the full-width New
session button took; a hairline under it is level with the pane header's, so the two headers read
as one band. The mark sits in the footer beside Settings. Collapsed, there is no rail: the
pane takes the width, and its header's show control, with a breathing dot while any session works,
brings the sidebar back. It is the current row, with the active fill, while the index is open. Grouping by
project is unchanged: a group's name still folds it, and its hover action still opens the home.
Done projects' groups come last, after No project, under one "Done" label, muted as that group
is, and fold once when the project is marked done; their sessions are listed as any other's. The
label is plain text, not a fold: each group already folds, and a fold of folds would be a second
level to reveal a session through. It is absent while no project is done.
Below the breakpoint the row sits in the sidebar sheet, so the index is one tap from any screen.

### Session header

The project's name in the context line already opens the home. Together with the home's
"Projects" link that makes the way up explicit at every level: session, project, index.

### Command palette

Global commands gains "Projects", named as the sidebar row is, and on the index the header's
"New project" (Global commands lists the open page's header actions). "Open project: X" exists
already. No new global shortcut.

### Routes

`/projects` is added beside `/projects/<id>` and `/projects/<id>/new`. `/` keeps opening `/new`.

## Developer navigation

- **Owners:** `server/Registry.ts` (projects and membership), `web/src/lib/projectsIndex.ts`,
  `web/src/lib/projectHome.ts` and `web/src/lib/projectCommands.ts`; `extensions/piano-project/`
  applies a project's instructions.
- **Smallest check:** `node --test --import ./test/setup.ts test/Projects.test.ts` (server) or
  `test/ProjectsIndex.test.ts`, `test/ProjectHome.test.ts`, `test/ProjectCommands.test.ts` (web);
  then the two recipes linked above.
- **Not proved:** a remote Piano's projects need configured peers: `test/browser/remote-session.mjs`.
