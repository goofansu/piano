# Changes and files

From a session the user sees what changed in its workspace: Changes, in the Surface area beside
the Agent area (or under its own tab where the areas take turns), shows the Git diff of
the session's folder or worktree against HEAD (per-file additions and removals, new files, a diff
per file), and the session rail (turned on or off for every session from the header, and
sharing the right side with the Surface area: whichever came in last shows), shows where the
session runs as the Environment section (Folder, or Repository once GitHub is known, then Branch,
or the commit when HEAD is detached), Outputs, the files Pi wrote or edited in this session, each
opening a file viewer, and Links, the web links the conversation mentions, each with "Jump to
message".
The palette (Mod+K) searches neither outputs nor links.

## Sub-features

- `changes-open`: the header's last control, the "Changes" toggle, opens the Surface area and is
  pressed while Changes shows, then named "Hide changes", which hides it; the palette's "Changes"
  focuses Changes without rereading, collapsing or hiding it. The toggle shows on every layout;
  below 849px of session width it shows the Changes area (the "Agent" tab bar shows only while
  something is open: `Agent | Changes`, `Agent | README.md`), and Close in the view's toolbar
  closes it. The header's end holds only "Show session rail" / "Hide session rail" and this
  toggle (plus the preview control while an app runs); the pull request is read in Changes.
- `changes-scope`: the toolbar starts with the comparison menu, "Comparison: Uncommitted" by
  default (visible text `Uncommitted`), or "Comparison: <target>" (`main`, `origin/main`):
  Uncommitted compares with HEAD, the branch option with the branch's target (the pull request's
  base, the base Worktrunk reported at creation, the remote's default branch, or a local
  main/master). An unavailable option is disabled and shows only its name (on `main` the branch
  option, since main is the base branch). The choice is saved for the session. The toolbar's actions are Collapse all
  / Expand all, Wrap (pressed while on) and Refresh changes; a failed refresh keeps the previous
  list with "Refresh failed. Showing previous changes." and the reason.
- `pull-request-link`: with no PR linked, the toolbar starts its actions with a ghost icon button,
  "Pull request", before Expand / Collapse all. It opens the existing link dialog (URL field, Link,
  Find from branch). Once linked, the button gives way to the PR row below. Removing the link
  brings the button back. Keyboard dismissal returns focus to the visible PR control.
- `pull-request-row`: region "Pull request" under the toolbar, only while the session has a
  linked pull request: `#<n> <title>` (a link to GitHub), the state badge, "Checks
  running|passed|failed", "Approved" / "Changes requested" / "Review required", "<n> commits not
  pushed", "Edits not committed", and `head → base` only when the head is not the inspected
  branch; "Status unavailable" when GitHub cannot be read (the seed's `#222` without a `gh`). Its
  "Pull request actions" menu: Open pull request, Change link…, Find from branch, Remove link
  (toasts "Pull request linked" / "Pull request link removed"). PR linking is absent from both
  session menus. The palette's "Pull request" opens Changes for a linked session, else the link dialog ("Pull request": URL
  field, Link, Find from branch; "No open PR found for this branch." when none).
- `changes-list`: list "Changed files" with one collapsible row per file
  (`<path>, <n> added, <n> removed: collapse`), the kind beside the size on the name line
  ("New" for untracked files, "Deleted", "Binary"), an "Ask about <path>" button, and the diff,
  region "Diff of <path>".
- `changes-refresh`: "Refresh changes" re-reads the workspace after files change.
- `changes-close`: "Hide changes" (or Escape inside it) hides the area and returns focus to the header's "Changes" icon;
  reopening shows the same scroll and expanded files.
- `details-open`: the list icon left of "Changes" in the header, named "Show session rail" / "Hide session
  rail", turns the session rail on or off; it stays on
  across sessions and reloads, hides while a Surface tab shows, and returns when the last one
  closes; turned on over open tabs, it hides them until the rail goes off. It is offered even
  without Git. Narrow, neither the "Changes" icon nor the rail nor its
  toggle shows; widening again brings the rail back if it was on.
- `environment`: the rail's "Environment" rows are menus: "Copy branch name" (or repository name
  or commit SHA), "Copy working directory", and "Open … on GitHub" when the repository is known.
  The working directory is copied from there; the rail shows no row for it.
- `files-list`: The rail's "Outputs" lists files written in the session by name only, and its
  "Links" (heading "Links <n>") lists the conversation's first five web links, each with "Jump to
  message", and "Show all" past five. Either section appears only once it has a row.
- `file-viewer`: an Outputs row opens the file in a tab of its own at the strip's end (tab = file
  name, toolbar = path, "Close <file name>" on the tab, or in the toolbar where one area shows at
  a time); opening it again shows the same tab.

## How to get to it (user POV)

- Session page header → the "Changes" icon; the palette's "Changes" does the same, "Hide changes" and (one area at a time) "Agent" go back.
- Session page header → "Show session rail" → an Outputs row → a file; the palette's "Show
  session rail" / "Hide session rail" does the same.
- The same diff over HTTP: `POST /api/workspace/changes?workspaceId=<id>` with an allowed Origin.

## Driving it with agent-browser

Preconditions: a seeded launch, `. "$RUN/run.env"`, doctor passed;
`ab() { .agents/skills/verify-piano/scripts/ab.sh "$RUN" "$@"; }`. Make the workspace dirty through the files, as Pi would:
`echo 'export const answer = 5;' > "$REPO/src/answer.ts"; echo note > "$REPO/new.txt"`.
The seeded "Plan the verification" history contains one successful Pi `write` of `src/answer.ts`.

- `changes-open` and `changes-list`
  - Action: `ab set viewport 1280 800; ab open "$WEB_URL/s/verify-plan"; ab wait --text "Answer 4.";
    ab find role button click --name "Changes" --exact; ab wait --text "new.txt"`
  - Result: tab and region "Changes", the header toggle now "Hide changes"; "Comparison:
    Uncommitted"; region "Pull request" with link `#222`, `Status unavailable` and `Edits not
    committed`; buttons `new.txt, 1 added, 0 removed: collapse` and
    `src/answer.ts, 1 added, 1 removed: collapse`; cells `− export const answer = 4;` and
    `+ export const answer = 5;`. `ab eval "document.querySelector('[aria-label=\"Changed files\"]').innerText"`
    shows `New` beside `new.txt`. Capture `01-changes`.
  - Side effect (same answer over HTTP): take the root workspace ID from
    `curl -s "$API_URL/api/folders"` (`folders[0].worktrees[0].workspace.id`), then
    `curl -s -X POST -H "Origin: $ORIGIN" "$API_URL/api/workspace/changes?workspaceId=<id>"`
    returns `result.status` `ready`, `branch` `main` and `files` (`path`, `additions`,
    `deletions`) `new.txt` (1/0) and `src/answer.ts` (1/1). Without the Origin header it is 403.
- `changes-refresh`
  - Action: `rm "$REPO/new.txt"; ab find role button click --name "Refresh changes" --exact`
  - Result: `new.txt` leaves the list; `src/answer.ts` stays. Capture `02-refreshed`.
- `changes-close`
  - Action: `ab find role button click --name "Hide changes" --exact`
  - Result: `document.querySelector('[data-slot=surface-area]:not([inert])')` is null and the
    focused element is the header's "Changes" button.
- `details-open`, `environment`, `files-list` and `file-viewer`
  - Action: `ab find role button click --name "Show session rail" --exact;
    ab wait "[data-slot=session-rail]:not([inert])"`
  - Result: `ab eval "document.querySelector('[data-slot=session-rail]:not([inert])').innerText"`
    is `Environment` / `Folder:` / `repo` / `Branch:` / `main` / `Outputs` / `answer.ts` (no
    Links yet): bordered lists of icon rows, the field names read only by screen readers; each
    heading folds its section, and folds are remembered across reloads. Capture `03-rail`. Then
    `ab find role button click --name "answer.ts" --exact; ab wait '[aria-label="Close answer.ts"]'`
    opens a tab `answer.ts` with toolbar `src/answer.ts`, the file's current contents and "Close
    answer.ts" on the tab, and the rail hides; `ab find role button click --name "Close answer.ts" --exact`
    shows the rail again. Capture `03-file-viewer`.
  - Links: send `Read https://example.com/docs/guide please` from the composer; fake Pi echoes
    it, and the rail gains `Links` / `1` / `example.com/docs/guide` with "Jump to message".
    Capture `04-links`.
  - Narrow: with Changes open, `ab set viewport 700 800`: tablist "Session views" reads `Agent |
    Changes`, "Hide changes" sits in the Changes toolbar, and `[data-slot=session-rail]` and
    "Show session rail" are absent. Capture `05-narrow`.

## Gotchas

- Fake Pi makes no tool calls, so Outputs is only reachable through the seeded, hand-written
  history; report it as such. A real Pi write is not exercised.
- The header carries `Working directory:` as screen-reader text, so `wait --text "Working
  directory"` passes on any session page; it proves nothing about the rail.
- The Files list hides paths ignored by the workspace's `.gitignore` (the throwaway repo ignores
  `ignored/`).
- The Surface area is `[data-slot=surface-area]`; hidden, it stays mounted but `inert` (so its
  scroll survives), so select the shown one with `:not([inert])`.
- "Changes" is the header's icon, the narrow tabs and the palette; neither the session header's menu nor
  the sidebar's "Session menu for <title>" has a Changes item.
- A non-Git folder's header has no "Changes" icon; the palette lists Changes disabled with "Not a
  Git repository"; narrow, there are no tabs.
