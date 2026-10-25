# Session views: a chat area beside a tools area

Status: superseded for the Surface area by PIN-102 (Option A, adaptive workbench): one session
header over an untitled Agent area and a Surface area that shows Changes or a transient file,
opened from Views; Agent and Changes tabs where the areas take turns. See
[design-moonstone](design-moonstone.md) and [the glossary](glossary.md). Written 2026-10-24, after a walk through Amp's thread screen and the
[one-line session header research](research/2026-10-24-one-line-session-header.md). Slice 1,
the one-line header with its menu on the title, is built on `session-header-polish`; the views
below remain a proposal. Terms follow [the glossary](glossary.md); workspace identity and
lifetimes stay under INV-01 and INV-07, and a preview stays Pi's process under
[ADR 0003](adr/0003-pi-owned-preview-lifetime.md).

## Decision

A session screen is two areas: the chat area (the header, the transcript and the composer) and
a tools area, the right sidebar, that shows the views a user opens beside the conversation:
Changes, Files, Preview and an opened file, as tabs. Views open on demand and close from their
tab; nothing is open until asked for. The pull request keeps its popover. The header is one
line: the title with its menu glued to it, where the session runs, and at the end the controls
that are also a state (preview, pull request) and Views.

## What Amp does and what Piano takes

| Amp | Piano |
| --- | --- |
| One-line header: the title with `…` beside it; at the end a status glyph, the repository, the effort, Share, a Private badge, open-in-new, Views. | One line: `[≡] Project / Title ⋯  folder ⑂ branch  [preview] [#123] [Views]`. The project crumb is the link up; folder and branch say where the session runs; effort and model stay in the composer, visibility in the Share dialog. |
| A warning banner under the header. | The `Banner` rows already under the header. |
| Views menu at the header's end: Files, Changes, Portal, Terminal, Desktop; each opens a closable tab in the right half. | Views at the header's end: Changes, Files, Preview; each opens a tab in the right sidebar. No terminal and no desktop (ADR 0001 keeps a browser terminal an escape hatch; see [the wterm note](research/2026-10-16-wterm-sidebar-terminal.md)). |
| A tab strip spanning the whole screen, with "Agent" as a tab that never closes. | The strip lives in the right sidebar's header, at the same height as the session header. The conversation is not a tab. |
| Portal: the app embedded in the tab, with an empty state of three example prompts. | Preview: the app embedded in the tab once Pi reports it ready; before that the tab is not offered. The empty state of any view is one line. |
| Files: a tree of the repository. | Files: the files Pi wrote or edited in this session, the list the composer's Files popover shows today. A file opens as its own tab, named by its file name, as a transcript link opens it. |

## Screens

### Session header (slice 1, built)

One row in the 48px band, so Settings, the project home and the sidebar header stay level.

- **Title group:** the project crumb ("Project: X", a button to the home, hidden on phones where
  the sheet's project page covers it), `/`, then the title as the `h1` with the session menu
  "Session information and actions" glued to it, as Amp's `…` sits by its title. The group is
  the row's first item, so it never drops; the title truncates last, keeping about 12rem.
- **Where it runs:** the folder name, then the branch as `BranchLabel`, in the Directory picker's
  shape (`NewSession.tsx`). No worktree segment: Worktrunk names a worktree after its branch, and
  the full path stays in the menu's details. Each segment claims about 6rem; when the row is
  tight they drop whole from the end, branch first, then folder.
- **Details on demand:** the menu's details gain a "Git branch" row between the working directory
  and the session ID, so a dropped branch is one click away, beside "Copy git branch".
- **Controls at the end:** preview and pull request, each a state and a one-click action; Views
  joins them in slice 2. Controls never shrink.
- **Phones:** the same row with 44px controls; the facts usually drop and the title keeps the row.

### Tools area (slice 2)

The right sidebar keeps its shell (`RightSidebar`: shares the conversation's sheet behind a
hairline on desktop, a full-width sheet on phones, resizable and remembered) and gains tabs in
its header, one per open view, the active one filled as a sidebar row is, each with its `×`
("Close Changes"). The header's end keeps the view's own actions (Refresh changes, Details).
With one view open the strip still shows, so closing is one place.

- **Views** is a `DropdownMenu` at the header's end listing Changes, Files and, while an app
  runs, Preview, named as the palette's rows are. Choosing a view opens its tab or focuses it.
- **Changes** is the panel as it is. **Files** is the Files list from the composer's usage row,
  as hairline rows; the popover goes, since its content has a place. A row opens a **file tab**.
- **Preview** embeds the app in an `iframe` of the preview URL with the control's menu (Open,
  Copy link, Details, Stop preview) as the tab's actions. The header's preview control opens
  this tab instead of its menu. An app that refuses framing shows one line, "Open preview" as
  a button, since a blocked frame cannot be told from a slow one.
- **Pull request** stays the popover over the sidebar; a view is a later step if the popover's
  files and diff want room.
- **Navigation state:** `sidebar: SidebarPanel | null` becomes `views: View[]` plus the active
  view's ID, per session as today, and `openPanel` becomes "open or focus". A new session starts
  with no views. The palette's Changes and Files rows run the same moves.
- **Phones:** the sheet shows the strip above the active view; swiping the sheet away closes
  nothing, as closing the sidebar today keeps nothing.

## Quiet UI

| Item | Kind | Once | Same names and shape |
| --- | --- | --- | --- |
| Project crumb "Project: X" | control's name (link up) | the sidebar shows it only when grouped by project | the palette's "Open project: X"; the home's "Projects / X" line |
| Title with `…` | value and the menu's name | the sidebar row lists the title | Amp's title group; the menu keeps its name |
| folder, branch | values with `sr-only` field names | the Changes header shows the branch only while open | `BranchLabel`, as the picker and Changes use it |
| Git branch (details) | field name | only in the menu | as "Copy git branch" names it |
| Views | control's name | one per header | Amp's name; the view names are the palette's rows |
| Changes, Files, Preview, `<file name>` tabs | controls' names | one tab per view | the palette's rows; a file tab is named as the transcript names the path |
| Close `<view>` | control's name | one per tab | the sidebar's Close |
| No preview, No files yet, No changes | empty state's one line | one per view | "No sessions yet" |

Feedback: a tab opens where Views was chosen; Stop preview and Refresh changes answer as they do
today. State stays the sidebar row's; the preview's `StatusDot` sits on its control and tab, once.

## Rejected

- **A terminal or desktop view.** No terminal is wanted yet (the wterm note), and nothing in
  Piano drives a desktop.
- **The conversation as a tab.** It costs a permanent row for a tab that never closes.
- **Tabs that open by themselves** (Changes when Pi edits a file). A view the user did not ask
  for is a surprise; the sidebar row and the composer's usage row already say what moved.
- **Draggable, persisted tab order** as T3 Code has. Three or four views do not need ordering.

## Open questions

1. Whether the embedded preview can share the app's cookies behind exe.dev private access, or
   whether a framed app sees a different origin. To settle on a scratch instance before slice 2.
2. Whether a file tab should be one tab reused for each opened file, or one per file. Start with
   one per file, as Amp and editors do, and watch for strips that overflow.
