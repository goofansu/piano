# Changes and files

## Driving it with agent-browser

Preconditions: a seeded launch. Make the workspace dirty through the files, as Pi would:
`echo 'export const answer = 5;' > "$REPO/src/answer.ts"; echo note > "$REPO/new.txt"`.

- `changes-open` and `changes-list`
  - Action: `ab set viewport 1280 800; ab open "$WEB_URL/s/verify-plan"; ab wait --text "Answer 4.";
    ab find role button click --name "Changes" --exact; ab wait --text "new.txt"`
  - Result: tab and region "Changes", the header toggle now "Hide changes"; "Comparison:
    Uncommitted"; region "Pull request" with link `#222`, `Status unavailable` and `Edits not
    committed`; buttons `new.txt, new, 1 added, 0 removed: collapse` and
    `src/answer.ts, 1 added, 1 removed: collapse`; wait for `ab wait '[aria-label="Diff of src/answer.ts"]'` before inspecting the rendered
    patch (removed `answer = 4`, added `answer = 5`); the name `new.txt` is green.
    Diff text is rendered in a shadow root, not ordinary table cells. Capture `01-changes`.
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
  - Result: `document.querySelector('[data-slot=inspector]:not([inert])')` is null and the
    focused element is the header's "Changes" button. Scope the click: the tab also has a
    "Hide changes" button, whose focus-restoration path differs.
- `details-open`, `environment`, `files-list` and `file-viewer`
  - Action: `ab find role button click --name "Show session rail" --exact;
    ab wait "[data-slot=session-rail]:not([inert])"`
  - Result: `ab eval "document.querySelector('[data-slot=session-rail]:not([inert])').innerText"`
    contains `Environment` / `repo` / `main` / `#222` / `Outputs` / `answer.ts` (no Links section; the
    Folder / Branch / Pull request labels are screen-reader only, and `#222` is the seed's linked
    PR): bordered lists of icon rows; each heading folds its section, and folds are remembered
    across reloads. Capture `03-rail`.
    `ab find role button click --name "Branch: main" --exact` opens a menu of `Copy branch`
    and "Folder: repo" one of `Copy directory path` (Escape each). Then
    `ab find role button click --name "answer.ts" --exact; ab wait '[aria-label="Close answer.ts"]'`
    opens a tab `answer.ts` with toolbar `src/answer.ts`, Copy path, Download file, Wrap,
    the file's current contents and "Close answer.ts" on the tab, and the rail hides. Capture `03-file-viewer` while it is open;
    `ab find role button click --name "Close answer.ts" --exact` shows the rail again.
  - Plain URL: `ab fill '[aria-label="Message"]' 'Read https://example.com/docs/guide please';
    ab press Enter; ab wait --text 'echo: Read https://example.com/docs/guide please'`.
    The transcript contains the URL, but the rail still has only Environment and Outputs.
    Capture `04-no-links`.
  - Narrow: with Changes open, `ab set viewport 700 800;
    ab wait '[role=tablist][aria-label="Session views"]'`: tabs read `Agent | Changes`.
    The header shows the folder `repo` and branch `main` below the title and offers Changes and
    "Session information and actions", not Show session rail. Capture `05-narrow-changes`.
    Drive [`open-session.md`](../../navigation/verify/open-session.md) `phone-menu` for its sheet, dismissal and resize
    checks. Outputs and Environment copy menus require widening; there is no narrow rail
    sheet or Outputs picker. Phone viewport evidence is emulation, not a real-device keyboard,
    safe-area or touch-scroll check.

## Gotchas

- Oversized lists report "Changes are too large to list; no partial file list is shown." rather
  than a partial list. A small diff does not prove that boundary: it needs a controlled oversized
  scratch fixture, separately from the ordinary Changes recipe.
- Fake Pi makes no tool calls, so Outputs is only reachable through the seeded, hand-written
  history; report it as such. A real Pi write is not exercised.
- The Inspector is `[data-slot=inspector]`; hidden, it stays mounted but `inert` (so its
  scroll survives), so select the shown one with `:not([inert])`.
