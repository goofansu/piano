# One-line session header — October 24, 2026

Question: what is the minimal, useful composition of the session header as one line? Constraints
are the [quiet UI](../../AGENTS.md#quiet-ui) checks (Kind, Once, Same names, Same shape, Feedback,
Details on demand), the shared structure rule "one header shape on the session, the right sidebar
and Settings (a title, context beneath it when that adds something, controls at the end)" and "the
sidebar row owns a session's state, so the header repeats nothing" (`AGENTS.md:91-96`), and
[Linear as the design guide](../design-moonstone.md#linear). Terms follow
[the glossary](../glossary.md). Workspace identity stays in the header per **INV-07**; the title
is Pi's live name first (**INV-01**, `web/src/lib/sessionContext.ts:242-243`). Sources are the
repository at `c4fec92` on this worktree, Linear's docs and guidelines, and T3 Code at
`5753207` in the reference checkout; anything not confirmed from those is marked unverified.

## What the header shows today

`web/src/components/SessionHeader.tsx` is a 64px band (`h-16`, line 73) shared with
`SettingsHeader.tsx:14` and `ProjectHome.tsx:52`, with two lines inside: the title (`h1`,
`text-sm font-medium`, line 78) and a `text-xs text-ink-3` metadata row clipped to one line
height (`h-[1lh] flex-wrap overflow-hidden`, line 85). Controls sit at the end (lines 140-211).

| Element | Source | Shown elsewhere | Verdict |
| --- | --- | --- | --- |
| Show sidebar button, with a breathing dot while any session works; hidden on desktop while the sidebar is open | `SessionHeader.tsx:74`, `ShowSidebarButton.tsx:18-47` | The sidebar's own hide control, at the same x | Stays: it is every pane's way back (`index.css:83-88`). |
| Title: Pi's session name, else the registry title, else "Untitled"; "New session" before the session exists | `SessionHeader.tsx:78-80`, `sessionContext.ts:243` | The sidebar row (`Sidebar.tsx:323-366`), as a list entry | Stays: the page's `h1`. |
| Folder name (`sr-only` "Folder: " / "Working directory: ") | `SessionHeader.tsx:86-89` | The sidebar's folder group, only when grouped by folder (`Sidebar.tsx:596-600`; default grouping is by date, `verify-piano/features/open-session.md:18`); full `cwd` in the menu's details (`MobileSessionSheet.tsx:27-53`) | Stays on the line: with several folders the title does not say where the session runs. |
| Worktree name, mono, `⇄` icon, when the checkout is not the folder's root | `SessionHeader.tsx:90-96`, `5a869ab` | Only as part of `cwd` in the menu | Drop from the line: Worktrunk names worktrees after branches, so it repeats the branch in the common case; the path is in details and "Copy working directory". |
| Branch, mono, `GitBranchIcon` | `SessionHeader.tsx:97-110`, refreshed by `543dabe` | Changes header when the panel is open (`ChangesHeader.tsx:58-65`); palette rows for worktree sessions (`commandPalette.ts:60`); project home rows (`ProjectHome.tsx:204`) | Stays: the one always-visible branch for an open session; the sidebar never shows it (`BranchLabel` has no user in `Sidebar.tsx`). |
| Project name, a button to the project's home, `sr-only` "Project: " | `SessionHeader.tsx:111-126`; `c65738b`, `c930b7b` | Sidebar project group, only when grouped by project; menu's project rows (`ProjectMenu`, line 185); palette "Open project: X" | Stays: it is the way up (`project-centered-ux.md` §Session header). |
| Hidden `role=status` with the session's state | `SessionHeader.tsx:136-139` | The sidebar row's keys and dots (`Sidebar.tsx:333-357`) | Stays hidden: "the header repeats nothing". |
| Preview control: app icon in the state's colour, host name in mono, menu with Open/Copy link/Details/Stop; icon only on phones | `SessionPreview.tsx:101-165`; `cd08989` | Palette rows; `docs/live-previews.md:8` | Stays as a control: a state plus a one-click action, only while an app runs. |
| Pull request control: "#123" or "PR", icon pulses only while the user waits on a read | `SessionPullRequest.tsx:68-108`, `pullRequestView.ts:96-105` | The menu's "Pull request" row opens the same popover (`sessionCommands.ts:114`) | Stays as a control, only once a PR is linked (`SessionPullRequest.tsx:240`). |
| `…` menu "Session information and actions": details (`cwd`, session ID, Copy session details), Changes, Pull request, Rename, Pin, Share, project rows, Messages only, Archive, Delete; a bottom sheet on phones | `SessionHeader.tsx:57-68, 149-209`; `sessionCommands.ts:111-117` | The palette's "Session commands" group lists the same commands (`commandPalette.ts:109-126`) | Stays: the one overflow. |
| Skeletons before `cwd` is known | `SessionHeader.tsx:131-132` | — | Stays, one line tall. |

Width today, from `ui/button.tsx:25-33` and the classes above: sidebar button 32px (phones
only on desktop), preview `sm` up to `max-w-48` (12rem), PR `sm` about 3.5rem, menu `icon-sm`
32px, gaps `gap-0.5`/`gap-3`, gutter `--gutter` 1.5rem (`index.css:88`). On a phone the
controls are 44px each (`max-md:size-11`, `size-11`) and sit `self-start` beside a title that
spans both columns (lines 78, 140).

What the reflow commits already paid for: each metadata segment truncates to about 6rem then
drops whole from the end (`c930b7b`); the project moved from its own line above the title into
the row so the header is two lines, not three (`c65738b`); the project is optional context, so
it comes last and drops first, while folder and branch "always describe where the session runs"
(`c930b7b`); the right sidebar took the header's shape, "a title with a line beneath it, controls
at the end" (`88496fe`). Earlier rounds went further and back: a menu-only header with only the
hamburger ([menu-only header](2026-10-05-menu-only-header.md)), two rows on phones because a
single row clipped the branch to 0px at 320px ([mobile header](2026-10-05-mobile-session-header.md)),
and quick-glance facts moved into the menu ([session menu](2026-10-05-session-menu.md)). Model,
effort and context usage already live in the composer (`DraftEditor.tsx:160`,
`Composer.tsx:299-315`; [quiet session UI](2026-10-05-quiet-session-ui.md)).

## What the references do

### Linear

- The issue page keeps properties out of the header: labels are applied "by clicking into the
  label property field in an issue's right sidebar" ([Issue labels](https://linear.app/docs/labels));
  relations "show up in the issue properties sidebar"
  ([Issue properties](https://linear.app/docs/issue-property)). Views likewise: "The righthand
  sidebar clarifies the view's contents" ([Custom views](https://linear.app/docs/custom-views)),
  and a project's details open with "the sidebar button in the top right corner"
  ([Project overview](https://linear.app/docs/project-overview)).
- The overflow is one `…` at the top right: "Click on contextual menu icon … to the top right of
  the issue" ([Zendesk](https://linear.app/docs/zendesk)); "Open the issue's … menu icon"
  ([Intercom](https://linear.app/docs/intercom)); "the overflow menu" for sharing
  ([Private teams](https://linear.app/docs/private-teams)).
- Transient facts are a banner under the header, not header text: "a banner at the top of the
  issue indicates whom it's shared with" (Private teams); a synced issue shows "a banner … at the
  top of the issue" ([Jira](https://linear.app/docs/jira)). Piano's `Banner` rows already sit
  there (`SessionView.tsx:94-121`).
- [Agent interaction guidelines](https://linear.app/developers/aig): "immediate, but unobtrusive,
  feedback" (An agent should provide instant feedback) and "Humans should be able to understand
  what's happening at a glance" (clear and transparent about its internal state). The page has no
  numbered sections; `design-moonstone.md:174-181` cites them as §3 and §4 by order.
- Unverified: the exact composition of Linear's issue header line (team and project crumbs, the
  identifier, the parent issue). No docs page describes it; it would need a screenshot of the app.

### T3 Code (`apps/web/src/components/chat/ChatHeader.tsx` at `5753207`)

- The header is one row of `--workspace-topbar-height` (`ChatView.tsx:11400-11437`); its content
  is a breadcrumb `nav` (`ChatHeader.tsx:309-312`): project, optional parent thread, then the
  thread title as the current crumb, separated by `/` (`WorkspaceBreadcrumb.tsx:66-75`).
- "The project always leads the header: knowing which project a thread lives in is priority
  zero, and the thread title alone doesn't answer it" (`ChatHeader.tsx:313-315`). The project
  crumb is capped at `max-w-40` (line 331); the title is the only flexible crumb (`min-w-10
  flex-1`, line 377); the parent collapses to "..." when the measured untruncated widths exceed
  the row (lines 131-158, 364-366).
- The title is a button that opens the thread's actions and renames on double click
  (lines 400-420); no branch, model or status appears in the header. The model picker is the
  composer's (`ChatComposer.tsx`, per [quiet session UI](2026-10-05-quiet-session-ui.md)).

### Codex and Claude Code web

The cached `openai/codex` checkout (`e45069d`) holds the CLI and `codex-rs` TUI; the Codex
desktop app's header is not in it, so nothing is claimed about it. OpenAI's docs place model
selection under the composer (cited in [quiet session UI](2026-10-05-quiet-session-ui.md)).
Claude Code web has no primary source reachable from here: unverified, not used.

## Recommendation

One row in the existing 64px band, so the sidebar header, Settings and the project home stay
level (`index.css:83-88`, `SettingsHeader.tsx:14`):

```
[≡]  Project / Title                         piano ⑂ branch   [⧉ host]  [#123]  [⋯]
```

1. **Breadcrumb first** (`nav`, as T3's and as the proposed home title "Projects / Verify Project",
   `project-centered-ux.md` §Project home): the project name as the existing button with its
   `sr-only` "Project: " (the accessible name `Project: <name>` that `verify-piano/features/project-home.md:35,49`
   and `test/browser/open-session.mjs:263` rely on), a `/` separator, then the title as the `h1`
   and current crumb. No project, no crumb. The project crumb is capped at about 6rem (the
   existing per-segment cap) and the title keeps at least 10rem (T3's `min-w-10`); below that the
   project crumb drops whole, since the menu's project rows and "Open project: X" in the palette
   remain. This keeps `c930b7b`'s rule, the project drops first.
2. **Where it runs, after the title**: the folder name in sans, then `BranchLabel` (the icon and
   mono name every branch uses, `BranchLabel.tsx`), in `text-xs text-ink-3`, no slash: the shape
   the Directory picker already has (`NewSession.tsx:391-394`). The worktree segment goes. Each
   truncates to about 6rem, then drops from the end: branch, then folder, before the title
   truncates below 10rem. A non-Git folder shows the folder alone, as now.
3. **Controls at the end, unchanged**: preview, PR, `…`. They are the only elements that never
   shrink; the line yields facts before controls, as it does today.
4. **Details on demand**: `SessionDetails` gains a "Git branch" row between the working directory
   and the session ID, so whatever the line drops is one click away in the menu and the phone
   sheet, beside the "Copy git branch" command that already exists (`sessionCommands.ts:208-217`).
5. **Phones**: the same one line. With 44px controls, the facts usually drop and the title keeps
   the row; the sheet's details hold the directory and branch.

Quiet UI, item by item (every string the change adds or keeps):

| Item | Kind | Once | Same names and shape |
| --- | --- | --- | --- |
| Project crumb "Project: X" | control's name (link up) | Once: the sidebar shows it only when grouped by project | Named as the sidebar group and the palette's "Open project: X"; the home's "Projects / X" title line |
| `/` | separator | — | T3's crumb separator; the home's title line |
| Title | value (`h1`) | The sidebar row lists it; a page title repeating its list entry is accepted (project home does the same) | — |
| Folder "piano" | value, `sr-only` "Folder: " | Once per screen unless grouped by folder | The Directory picker's folder |
| Branch | value, `sr-only` "Git branch: " | Once: the Changes header shows it only while that panel is open, as the Changes panel's own context | `BranchLabel`, as the picker, Changes, palette and home use it |
| Preview, "#123", `…` | controls | unchanged | unchanged |
| "Git branch" (details `dt`) | value's field name | Only inside the menu | As "Copy git branch" names it |

Feedback is unchanged: opening the project navigates; the PR and preview controls answer in
their popover and menu. The state stays the sidebar row's; the header keeps only the hidden
`role=status`. Nothing explains the screen: no helper text, no placeholder.

The one trade-off: on a phone the branch leaves the always-visible surface and is one tap away
in the sheet. The October 5 mobile fix added a second row precisely to keep it visible; the
menu-only header that followed removed it entirely, and nothing since has restored a visible
branch on phones as a requirement. Accept the tap, and keep the branch in the sheet's details.

Evidence to collect, on a [scratch instance](../../AGENTS.md#scratch-instance):

- `node test/browser/open-session.mjs`: its header assertion (`open-session.mjs:262`) expects
  `Folder: apiWorktree: <id>/Git branch: feat-<id>`; change it to the folder and branch without
  the worktree segment, keep `Project: QA Project` (line 263), and keep capture `9-header-<id>`.
  `start-session.mjs:37-39` (project and folder in the header text) and `preview.mjs:244-254`
  (`header button[aria-label^="Preview:"]`) should pass unchanged.
- `node test/browser/style-shots.mjs` before and after into two directories; compare
  `02-session`, `05-session-menu` (the new "Git branch" row), `09-mobile-session` and
  `09b-mobile-actions`.
- Screenshots at 1280 and 390px, light and dark, of: a worktree session with a project, a PR
  and a running preview (the longest line); the same without a project; the folder's root
  checkout; a non-Git folder; a long title; "New session". From each, read the row's geometry
  with `agent-browser eval`: `header` height 64, one row (`h1` and the facts share a top), the
  `h1` at least 160px wide while facts are present, and no element outside the header's box.
- One screenshot of the menu open, showing Working directory, Git branch and Session ID.
- `npm run typecheck`, `npm run lint`, `npm test`; a module test only if `sessionContext` or
  `SessionDetails`' contract changes.

## Open questions

1. Whether the band should drop below 64px for a one-line header. `SettingsHeader` is already
   one line in `h-16`, and the sidebar header is sized to meet it (`index.css:83-88`), so a
   shorter session header means changing four headers at once; nothing in the sources decides
   it. Keep `h-16` for this change.
2. Linear's issue header line itself is unverified from docs; if a screenshot shows its crumbs
   in a different order (identifier before project, say), the breadcrumb order here still
   follows T3's stated reason and the home's "Projects / X" line.
