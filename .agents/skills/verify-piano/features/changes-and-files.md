# Changes and files

From a session the user sees what changed in its workspace: Changes, in the Surface area beside
the Agent area (or under its own tab where the areas take turns), shows the Git diff of
the session's folder or worktree against HEAD (per-file additions and removals, new files, a diff
per file), and the composer's Files list shows the files Pi wrote or edited in this session, each
opening a file viewer.

## Sub-features

- `changes-open`: the header's "Views" menu → "Changes" opens the Surface area; choosing it again
  focuses Changes without rereading, collapsing or hiding it. Below 849px of session width the
  "Agent" / "Changes" tabs replace Views.
- `changes-list`: list "Changed files" with one collapsible row per file
  (`<path>, <n> added, <n> removed: collapse`), "New file" for untracked files, and the diff.
- `changes-refresh`: "Refresh changes" re-reads the workspace after files change.
- `changes-close`: "Hide changes" (or Escape inside it) hides the area and returns focus to Views;
  reopening shows the same scroll and expanded files.
- `files-list`: the composer's "Files" button (`<n> file(s)`) lists files written in the session.
- `file-viewer`: a Files row opens the file viewer (heading = path, "Close file", which returns
  to Changes or the Agent area, wherever it was opened from).

## How to get to it (user POV)

- Session page header → Views → Changes; the palette's "Views" opens the same menu, its "Changes"
  opens Changes directly, "Hide changes" and (one area at a time) "Agent" go back.
- Session page composer footer → Files → a file.
- The same diff over HTTP: `POST /api/workspace/changes?workspaceId=<id>` with an allowed Origin.

## Driving it with agent-browser

Preconditions: a seeded launch, `. "$RUN/run.env"`, doctor passed;
`ab() { .agents/skills/verify-piano/scripts/ab.sh "$RUN" "$@"; }`. Make the workspace dirty through the files, as Pi would:
`echo 'export const answer = 5;' > "$REPO/src/answer.ts"; echo note > "$REPO/new.txt"`.
The seeded "Plan the verification" history contains one successful Pi `write` of `src/answer.ts`.

- `changes-open` and `changes-list`
  - Action: `ab set viewport 1280 800; ab open "$WEB_URL/s/verify-plan"; ab wait --text "Answer 4.";
    ab find role button click --name "Views" --exact;
    ab find role menuitem click --name "Changes" --exact; ab wait --text "new.txt"`
  - Result: heading "Changes"; buttons `new.txt, 1 added, 0 removed: collapse` and
    `src/answer.ts, 1 added, 1 removed: collapse`; cells `− export const answer = 4;` and
    `+ export const answer = 5;`. `ab eval "document.querySelector('[aria-label=\"Changed files\"]').innerText"`
    shows `New file` under `new.txt`. Capture `01-changes`.
  - Side effect (same answer over HTTP): take the root workspace ID from
    `curl -s "$API_URL/api/folders"` (`folders[0].worktrees[0].workspace.id`), then
    `curl -s -X POST -H "Origin: $ORIGIN" "$API_URL/api/workspace/changes?workspaceId=<id>"`
    returns `result.status` `ready`, `branch` `main` and `files` `new.txt` (1/0) and
    `src/answer.ts` (1/1). Without the Origin header it is 403.
- `changes-refresh`
  - Action: `rm "$REPO/new.txt"; ab find role button click --name "Refresh changes" --exact`
  - Result: `new.txt` leaves the list; `src/answer.ts` stays. Capture `02-refreshed`.
- `changes-close`
  - Action: `ab find role button click --name "Hide changes" --exact`
  - Result: `document.querySelector('[data-slot=surface-area]:not([inert])')` is null and the
    focused element is the Views button.
- `files-list` and `file-viewer`
  - Action: `ab find role button click --name "Files" --exact`
  - Result: `ab eval "document.querySelector('[role=dialog]')?.innerText"` is `Files` /
    `answer.ts` / `src`. Then `ab find role button click --name "answer.ts src" --exact` opens
    heading `src/answer.ts` with the file's current contents and "Close file". Capture
    `03-file-viewer`.

## Gotchas

- Fake Pi makes no tool calls, so the Files list is only reachable through the seeded, hand-written
  history; report it as such. A real Pi write is not exercised.
- The Files list hides paths ignored by the workspace's `.gitignore` (the throwaway repo ignores
  `ignored/`).
- The Surface area is `[data-slot=surface-area]`; hidden, it stays mounted but `inert` (so its
  scroll survives), so select the shown one with `:not([inert])`.
- "Changes" is in Views, the narrow tabs and the palette; neither the session header's menu nor
  the sidebar's "Session menu for <title>" has a Changes item.
- A non-Git folder's Views lists Changes disabled with "Not a Git repository"; narrow, there are
  no tabs.
- `changes-refresh` was written from the visible button; it was not run in the skill's first proof
  run.
