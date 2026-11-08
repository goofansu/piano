# Changes and files

From a session the user sees what changed in its workspace: Changes, in the Surface area beside
the Agent area (or under its own tab where the areas take turns), shows the Git diff of
the session's folder or worktree using its selected comparison (Uncommitted against HEAD, or
branch changes against the target's merge base), and the desktop session rail (turned on or off
for every session from the header, sharing the right side with the Surface area: whichever came
in last shows), shows where the
session runs as the Environment section (Folder, or Repository once GitHub is known, then Branch,
or the commit when HEAD is detached), Outputs, the files Pi wrote or edited in this session, each
opening a file viewer. Plain conversation URLs do not create rail entries. Published Radius
artifacts have their own header menu ([`open-session.md`](./open-session.md) `artifacts`);
the palette (Mod+K) does not search individual outputs.

## Sub-features

- `changes-open`: on desktop the header's "Changes" toggle opens the Surface area and is
  pressed while Changes shows, then named "Hide changes", which closes that tab; the palette's
  "Changes" focuses the already-visible view without rereading, collapsing or hiding it. Showing
  a hidden or closed view refreshes it. Below 849px of session width the header button stays named
  "Changes", without a pressed state, and opens/focuses the area. Side by side, tablist "Surface
  views" contains Changes and open files, with "Hide changes" beside the Changes tab; the header
  ends with the Changes toggle followed by "Show session rail" / "Hide session rail". One area at a time,
  tablist "Session views" includes Agent (`Agent | Changes`, `Agent | README.md`), and
  "Hide changes" is in the view's toolbar. The tab bar appears only while a Surface tab is open.
  One area at a time, the rail control is absent; the session menu opens a sheet
  ([`open-session.md`](./open-session.md) `phone-menu`).
- `changes-scope`: the toolbar starts with the comparison menu, "Comparison: Uncommitted" by
  default (visible text `Uncommitted`), or "Comparison: <target>" (`main`, `origin/main`):
  Uncommitted compares with HEAD, the branch option with the merge base against its target (the pull request's
  base, the base Worktrunk reported at creation, the remote's default branch, or a local
  main/master). An unavailable option is disabled and shows only its name (on `main`, the
  menuitemradio `main`, since main is the base branch). The choice is saved for the session. The toolbar's actions are Collapse all
  / Expand all, Wrap (pressed while on) and Refresh changes; a failed refresh keeps the previous
  list with "Refresh failed. Showing previous changes." and the reason.
- `pull-request-link`: with no PR linked, the toolbar starts its actions with a ghost icon button,
  "Pull request", before Expand / Collapse all. It opens the existing link dialog ("PR URL" field, Link,
  Find from branch). Once linked, the button gives way to the PR row below. Removing the link
  brings the button back. Keyboard dismissal returns focus to the visible PR control.
- `pull-request-row`: region "Pull request" under the toolbar, only while the session has a
  linked pull request: `<n> <title>` (a link to GitHub; the number without a hash, as the
  session rail and project home show it), the state badge, "Checks
  running|passed|failed|unavailable" (unavailable: the token reads the pull request but not its
  checks), "Approved" / "Changes requested" / "Review required", "<n> commits not pushed", "Edits not
  committed", and `head → base` only when the head is not the inspected branch; "Status
  unavailable" when GitHub cannot be read (the seed's `#222` without a configured `gh`).
  Ordinary status reads do not promise an error toast; explicit link/discovery failures do. Its "Pull request
  actions" menu: Open pull request, Change link…, Find from branch, Remove link
  (toasts "Pull request linked" / "Pull request link removed"). PR linking is absent from both
  session menus. The palette's "Pull request" opens Changes for a linked session, else the link dialog ("Pull request": "PR URL"
  field, Link, Find from branch; "No open PR found for this branch." when none); like Changes, it
  is disabled with Changes' reason where Changes cannot open.
- `local-work-row`: without a linked pull request, the same place under the toolbar holds region
  "Local work" with only "<n> commits not pushed" and "Edits not committed", each while nonzero,
  and no row when there are neither. After a commit, Uncommitted can say "No changes" below
  a row still saying "1 commit not pushed". Both rows keep these facts under a comparison that
  cannot be read (a saved "main" once the checkout is on main). Commits are counted against the
  locally held remote-tracking ref that a push would update, not necessarily the configured
  upstream; without that ref there is no commit count. The seed has no remote, so this case
  needs a scratch remote and an initial push.
- `changes-list`: list "Changed files" with one collapsible row per file
  (`<path>[, new | , deleted], <n> added, <n> removed: collapse`), the path on one line (its
  directory truncated first), the file name green when new (untracked) and red, struck through,
  when deleted, "Binary" instead of line counts for binary files, an "Ask about <path>" button
  when asking is available, and the diff, region "Diff of <path>". Large patches may start
  collapsed; Ask needs an open, readable patch.
- `changes-refresh`: "Refresh changes" re-reads the workspace after files change.
- `changes-close`: "Hide changes" closes that tab; Escape inside the area does so on desktop.
  The area hides only if no other tab remains. A header click keeps focus on that header button;
  closing from inside restores lost focus to a remaining tab, otherwise the rail/menu trigger.
  Reopening Changes preserves its scroll and expanded files.
- `details-open`: the list icon after "Changes" in the header, named "Show session rail" / "Hide session
  rail", turns the session rail on or off; it stays on
  across sessions and reloads, hides while a Surface tab shows, and returns when the last one
  closes; turned on over open tabs, it hides them until the rail goes off. It is offered even
  without Git. One area at a time, neither the header nor the palette offers the rail. The header
  shows folder/repository and branch below the title; the session menu holds actions and the
  linked pull request, not Environment copy menus or Outputs. Widen to use those sections;
  the desktop rail preference is kept.
- `environment`: the rail's "Environment" rows are menu buttons named `Folder: repo`, `Branch:
  main` (field names are screen-reader only in the visible text), and, when a pull request is
  linked, a "Pull request" row showing its number without a hash (`222` on the seed). The Folder
  row's menu has "Copy working directory" (a Repository row's also "Copy repository name"), the
  Branch row's "Copy git branch" (a detached commit's "Copy commit SHA"). Repository and branch
  rows also offer "Open … on GitHub" when their URLs are known. The rail shows no row for the working directory itself.
- `files-list`: The rail's "Outputs" lists files written in the session by name only, and
  appears only once it has a row. There is no Links section.
- `file-viewer`: an Outputs row opens the file in a tab of its own at the strip's end (tab = file
  name, toolbar = path, "Close <file name>" on the tab, or in the toolbar where one area shows at
  a time); opening it again shows the same tab. While source text shows (a text file, or a
  document with Preview off), the toolbar has Wrap, pressed while on: the same preference as
  Changes' Wrap, so turning it on in one wraps the other.

## How to get to it (user POV)

- Session page header → the "Changes" icon; the palette's "Changes" does the same, "Hide changes" and (one area at a time) "Agent" go back.
- Desktop session page header → "Show session rail" → an Outputs row → a file; the palette's
  "Show session rail" / "Hide session rail" does the same while the areas fit side by side.
- The session's diff over HTTP: `POST /api/session/changes?workspaceId=<id>&sessionId=<sessionId>`
  with an allowed Origin and a JSON body (`{}` for the session's saved comparison, Uncommitted by
  default).

## Driving it with agent-browser

Preconditions: a seeded launch, `. "$RUN/run.env"`, doctor passed;
`ab() { .agents/skills/verify-piano/scripts/ab.sh "$RUN" "$@"; }`. Make the workspace dirty through the files, as Pi would:
`echo 'export const answer = 5;' > "$REPO/src/answer.ts"; echo note > "$REPO/new.txt"`.
The seeded "Plan the verification" history contains one successful Pi `write` of `src/answer.ts`.

- `changes-open` and `changes-list`
  - Action: `ab set viewport 1280 800; ab open "$WEB_URL/s/verify-plan"; ab wait --text "Answer 4.";
    ab find role button click --name "Changes" --exact; ab wait --text "new.txt"`
  - Result: tab and region "Changes", the header toggle now "Hide changes"; "Comparison:
    Uncommitted"; region "Pull request" with link `222`, `Status unavailable` and `Edits not
    committed`; buttons `new.txt, new, 1 added, 0 removed: collapse` and
    `src/answer.ts, 1 added, 1 removed: collapse`; cells `− export const answer = 4;` and
    `+ export const answer = 5;`; the name `new.txt` is green. Capture `01-changes`.
  - Side effect (same answer over HTTP): take the root workspace ID from
    `curl -s "$API_URL/api/folders"` (`folders[0].worktrees[0].workspace.id`), then
    `curl -s -X POST -H "Origin: $ORIGIN" -d '{}' "$API_URL/api/session/changes?workspaceId=<id>&sessionId=verify-plan"`
    returns `result.status` `ready`, `branch` `main` and `files` (`path`, `additions`,
    `deletions`) `new.txt` (1/0) and `src/answer.ts` (1/1). Without the Origin header it is 403.
- `changes-refresh`
  - Action: `rm "$REPO/new.txt"; ab find role button click --name "Refresh changes" --exact`
  - Result: `new.txt` leaves the list; `src/answer.ts` stays. Capture `02-refreshed`.
- `changes-close`
  - Action: with only Changes open, `ab click 'main header [aria-label="Hide changes"]'`
  - Result: `document.querySelector('[data-slot=surface-area]:not([inert])')` is null and the
    focused element is the header's "Changes" button. Scope the click: the tab also has a
    "Hide changes" button, whose focus-restoration path differs.
- `details-open`, `environment`, `files-list` and `file-viewer`
  - Action: `ab find role button click --name "Show session rail" --exact;
    ab wait "[data-slot=session-rail]:not([inert])"`
  - Result: `ab eval "document.querySelector('[data-slot=session-rail]:not([inert])').innerText"`
    contains `Environment` / `repo` / `main` / `222` / `Outputs` / `answer.ts` (no Links section; the
    Folder / Branch / Pull request labels are screen-reader only, and `222` is the seed's linked
    PR): bordered lists of icon rows; each heading folds its section, and folds are remembered
    across reloads. Capture `03-rail`.
    `ab find role button click --name "Branch: main" --exact` opens a menu of `Copy git branch`
    and "Folder: repo" one of `Copy working directory` (Escape each). Then
    `ab find role button click --name "answer.ts" --exact; ab wait '[aria-label="Close answer.ts"]'`
    opens a tab `answer.ts` with toolbar `src/answer.ts`, the file's current contents and "Close
    answer.ts" on the tab, and the rail hides. Capture `03-file-viewer` while it is open;
    `ab find role button click --name "Close answer.ts" --exact` shows the rail again.
  - Plain URL: `ab fill '[aria-label="Message"]' 'Read https://example.com/docs/guide please';
    ab press Enter; ab wait --text 'echo: Read https://example.com/docs/guide please'`.
    The transcript contains the URL, but the rail still has only Environment and Outputs.
    Capture `04-no-links`.
  - Narrow: with Changes open, `ab set viewport 700 800;
    ab wait '[role=tablist][aria-label="Session views"]'`: tabs read `Agent | Changes`.
    The header shows `repo · main` below the title and offers Changes and
    "Session information and actions", not Show session rail. Capture `05-narrow-changes`.
    Drive [`open-session.md`](./open-session.md) `phone-menu` for its sheet, dismissal and resize
    checks. Outputs and Environment copy menus require widening; there is no narrow rail
    sheet or Outputs picker. Phone viewport evidence is emulation, not a real-device keyboard,
    safe-area or touch-scroll check.

## Gotchas

- Fake Pi makes no tool calls, so Outputs is only reachable through the seeded, hand-written
  history; report it as such. A real Pi write is not exercised.
- After a successful workspace observation, Outputs filters ignored, removed and outside-workspace
  paths (the throwaway repo ignores `ignored/`). Without a successful observation, the written
  paths remain visible.
- The Surface area is `[data-slot=surface-area]`; hidden, it stays mounted but `inert` (so its
  scroll survives), so select the shown one with `:not([inert])`.
- "Changes" is the header's icon, the narrow tabs and the palette; neither the session header's menu nor
  the sidebar's "Session menu for <title>" has a Changes item.
- A non-Git folder's header has no "Changes" icon; the palette lists Changes disabled with "Not a
  Git repository". Other open Surface content can still give a non-Git session narrow tabs.
