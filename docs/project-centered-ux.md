# Project-centered UX

Status: 2026-10-25, after a walk through Amp Code's Projects surface. The Projects index is
built (see [its verification map](../.agents/skills/verify-piano/features/projects-index.md)),
and so are the project home's breadcrumb header and Sessions group (see
[the home's map](../.agents/skills/verify-piano/features/project-home.md)); the home's status
slot and Pull requests group remain proposals. Mockups of the
three screens below, drawn in Moonstone's tokens, are on the
[Piano Projects UX canvas](https://claude.ai/artifact/BPYBKxLhtck57L52S2m2sD). Terms follow
[the glossary](glossary.md); the grouping model is [ADR 0002](adr/0002-outcome-projects.md) and
[the project plan](outcome-projects.md).

## Decision

Piano becomes project-centered the way Linear is: a Projects index sits at the top of the
hierarchy, a project's home is where work in that project starts and is read, and sessions keep
living where they run. The sidebar stays the session list, `/new` stays the way to start unfiled
work, and Mod+K stays the keyboard surface. Amp's center is the repository; Piano's is the
outcome, which may span folders, so the folder stays a fact on each session row rather than the
thing the index lists.

## What Amp does and what Piano takes

| Amp | Piano |
| --- | --- |
| Projects index: search field, one card per repository with avatar, "Updated today", thread count and an activity sparkline, New Project in the header. | `/projects`: hairline rows in one list, New project in the header. No search field (Mod+K already offers "Open project: X"), no sparkline (a derived chart is not a value the user acts on). |
| Breadcrumb header: Projects / owner / repo / Threads. | The one header shape: title line "Projects / Verify Project" where "Projects" is the link up, context beneath it. |
| Project home: Recent Threads, Commits with Verified badges, Files behind a GitHub connection. | Project home: the composer, then Sessions as hairline rows. Pull requests as a later group, from the links Piano already saves. No file browser: Changes belong to a session's workspace (INV-07). |
| Threads page with Status and Users facets. | Not now. One user, few sessions per project; the sidebar's Sort by covers ordering. |
| Bottom tabs Puck, Activity, Projects. | One "Projects" row at the top of the sidebar's list, and the same row in the palette's Global commands. |
| Snoozed, Inactive, Archived sections. | Pinned and archived sessions as they are. |
| A project is a repository, found from the Git remote. | A project is a named outcome grouping sessions from any folder; a session may have none. |

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
  home. On hover it shows the sidebar's project menu (Project settings, Delete project); deleting
  from it stays on the index, and deleting from the project's home lands here.
- **Order:** last activity first, from the newest member's `updatedAt`, the registry field that
  already exists so "a project's recency follows its members".
- **Empty state:** one line, "No projects yet"; New project stays in the header.
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
  `…` menu stays at the end with Project settings and Delete project. (A context line with the
  folders and the count was considered and dropped: it repeated what the rows show.)
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

## Quiet UI check of the added strings and controls

| Item | Kind | Note |
| --- | --- | --- |
| Projects (sidebar row, palette row, page title, breadcrumb link) | control's name / title | One name everywhere. |
| New project | control's name | Exists in the sidebar menu already. |
| piano, api · 3 sessions | value | Once per screen: in the index row, or in the home's header. |
| No sessions yet | empty state's one line | As the sidebar group says it. |
| No projects yet | empty state's one line | New. |
| 2 min ago | value | `timeAgo`, as the home uses it. |
| 14 / 20,000 | value | The Instructions count on both project dialogs; red past the limit. |
| Open, Merged | state | Later, with the Pull requests group. |

Feedback stays where it is: a project saved or deleted answers with its toast; opening a row
answers by navigating.

## Not taken, and why

- **Search field on the index.** A second search beside Mod+K; the palette already matches
  project names.
- **Sparklines, avatars, "Verified" badges.** Ornament or claims Piano cannot stand behind:
  a badge that reads as verification needs evidence (INV-09).
- **A project-level Files or Commits browser.** Git facts belong to one workspace; a project
  spanning folders has no single revision (INV-08).
- **Bottom navigation tabs.** A second navigation beside the sidebar and palette.
- **Status and user facets.** One user and short lists; revisit when a project's home lists more
  sessions than fit a screen.

## Open decisions, with a recommendation

1. **Landing route.** Keep `/` on `/new`: starting work stays one step, which is the roadmap's
   daily-use priority. A Projects landing is one sidebar click away.
2. **Breathing dots on home rows.** The home's rows show them. When the sidebar is grouped by
   project the same session breathes twice on screen; this is the same list shown in two panes,
   not two statements, which the "once" rule guards against.
3. **Default grouping.** Leave Group by on its default; a project-centered sidebar is one menu
   choice, and the index now gives projects a home of their own.

## Build order

1. `/projects`: the route, a `ProjectsIndex` component built from `SettingsSectionFrame`,
   `SettingsList` and `settingsRow`, the sidebar row, the palette row, and an `index` selector
   beside `projectHome` in `web/src/lib/`. No server or registry change.
2. Project home: the title line, the context line and the hairline list with the status slot.
3. Pull requests group, when wanted.

Verification per [testing](testing.md): screenshots of the index with projects, with a running
session and empty, the home before and after, and `style-shots` pairs for the home's list change.
The index is not a critical path, so no new journey in `test/browser/`; the existing project
home journey in the verify-piano feature map covers the home.
