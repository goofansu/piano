# Open and continue a session

A saved session opens from the sidebar, a project home or the Mod+K palette at `/s/<sessionId>`
with its Pi history, its header (project, title, folder, branch), and its usage in the
"Context usage" popover. The user sends follow-ups in the "Message" box and stops a running reply
with "Stop". The row's "Session menu for <title>" archives or deletes it.

## Sub-features

- `open-from-sidebar`: click the session's row in navigation "Sessions".
- `history`: the saved user message and reply render; "Jump to message" lists them.
- `header`: on desktop, one line: the project crumb ("Project: <name>", only for a member session) and the
  title with "Session information and actions" beside it; at its end "Show session rail" and
  "Changes". Where the session runs is in the session rail and, when shown, the sidebar row; the
  pull request is read in Changes. The session's state is the sidebar row's; the header only
  carries it as screen-reader `role=status` text ("Ready", "Not running").
- `phone-menu`: one area at a time, the header shows folder/repository and branch below the title;
  "Session information and actions" opens the "Session" sheet. It holds the linked "Pull request
  #222", Rename, Pin, Move to project (Add to project for a loose session), Messages only,
  Archive and Delete; Preview appears only when one is known. It has no Outputs, Links,
  Environment copy menus or session ID. Escape returns focus to its trigger; widening closes it
  and narrowing again does not reopen it.
- `row-details`: View options → Show → "Folder and branch" (off by default, remembered per
  browser; the palette's "Show folder and branch" / "Hide folder and branch") adds a line under
  each sidebar row with its folder and branch (only the branch where the group names the folder).
- `cost`: "Context usage" opens "Token and cost breakdown" with the reply's tokens and cost.
- `follow-up`: "Message" plus Enter sends to the same Pi session.
- `stop`: "Stop" aborts a running reply.
- `nested-calls`: an opened codemode tool row lists the calls its script made, one line each
  (status dot, tool name, what it acted on) that opens to its arguments and output. More than 8
  fold to the last 8 behind "Show all <n> tool calls" (" · <k> failed" in red when any failed),
  which turns into "Show last 8 tool calls" once opened; a running call older than the last 8
  stays in view, and an opened fold stays open while calls arrive. Drive it on
  `--fake-pi dialogs` from `/new` (its fake Pi cannot continue a seeded session): the first
  message `codemode 40 fail 2` runs one `code` call with 40 nested calls, 150ms each, then
  records them in its result.
- `archive-delete`: the row's "Session menu for <title>" ends with "Archive" and a red "Delete".
  Archiving an idle session acts at once and toasts "Session archived"; Delete asks "Delete
  session?" (`"<title>" and its transcript are removed from Pi's session store. This cannot be
  undone.`) and toasts "Session deleted". A working session asks "Stop and archive this
  session?" first. The same menu sits on project home rows.

## How to get to it (user POV)

- Sidebar row (grouped by date by default: "Today").
- A project home card, or Mod+K and the session's title.
- Address bar: `/s/<sessionId>`.

## Driving it with agent-browser

Preconditions: a seeded launch, `. "$RUN/run.env"`, doctor passed;
`ab() { .agents/skills/verify-piano/scripts/ab.sh "$RUN" "$@"; }`. Run the harness journey first.

- Harness
  - Command: `node test/browser/open-session.mjs "$EVIDENCE/open-session/harness"`
  - Result: exit 0 and `PASS open-session ...` (sidebar, jump, cost, follow-up, stop).
- `open-from-sidebar` and `history`
  - Action: `ab set viewport 1280 800; ab open "$WEB_URL/"; ab wait --text "Loose session";
    ab find role button click --name "Loose session" --exact; ab wait --url "**/s/verify-loose";
    ab wait --text "Answer 4."`
  - Result: `What is 2 + 2? (Loose session)` and `Answer 4.` visible; the header text reads
    `Loose session` / `Not running`. Capture `01-opened`.
- `phone-menu`
  - Action: `ab open "$WEB_URL/s/verify-plan"; ab wait --text "Answer 4.";
    ab set viewport 700 800;
    ab find role button click --name "Session information and actions" --exact;
    ab wait '[role=dialog]'`
  - Result: heading `Session`, link `Pull request #222` and the actions above, not rail sections.
    Capture `05-phone-menu`. `ab find role button click --name "Move to project" --exact`
    opens the project picker; capture `06-project-picker`, then
    `ab find role button click --name "Back" --exact` returns to actions.
    `ab find role switch click --name "Messages only" --exact` changes the switch; click it
    again to restore the default. `ab press Escape;
    ab wait --fn "!document.querySelector('[role=dialog]')"` closes the sheet;
    `ab eval "document.activeElement?.getAttribute('aria-label')"` reads
    `Session information and actions`.
  - Resize: reopen with the same trigger, then `ab set viewport 1280 800;
    ab wait --fn "!document.querySelector('[role=dialog]')"; ab set viewport 700 800;
    ab wait --fn "!document.querySelector('[role=dialog]')"`. Capture `07-menu-stays-closed`;
    `ab set viewport 1280 800; ab open "$WEB_URL/s/verify-loose"; ab wait --text "Answer 4."`
    restores desktop and the session for the following steps. This is viewport emulation, not
    real-phone proof.
- `row-details`
  - Action: `ab find role button click --name "View options" --exact;
    ab find role menuitem click --name "Show" --exact;
    ab find role menuitemcheckbox click --name "Folder and branch" --exact;
    ab wait --fn "!document.querySelector('[data-radix-popper-content-wrapper]')"`
  - Result: `ab eval "document.querySelector('nav[aria-label=Sessions]').innerText"` gives each row
    `Folder:` / `repo` / `Git branch:` / `main` under its title. Capture `05-folder-and-branch`.
- `cost`
  - Action: `ab find role button click --name "Context usage" --exact;
    ab wait '[aria-label="Token and cost breakdown"]'`
  - Result: `ab eval "document.querySelector('[aria-label=\"Token and cost breakdown\"]').innerText"`
    shows Input `1,200`, Output `300`, Total tokens `1,500`, Cost `$0.0063` in the Response column.
    Capture `02-cost`; `ab press Escape`.
- `follow-up`
  - Action: `ab fill '[aria-label="Message"]' "second"; ab press Enter; ab wait --text "echo: second"`
  - Result: the reply renders; the audit has `{"command":"prompt","text":"second","sessionId":"verify-loose"}`.
- `stop`
  - Action: `ab fill '[aria-label="Message"]' "hold"; ab press Enter; ab wait '[aria-label="Stop"]';
    ab find role button click --name "Stop" --exact`
  - Result: `ab wait --fn "!document.querySelector('[aria-label=\"Stop\"]')"` passes; the audit has
    `prompt` `hold` then
    `{"command":"abort","sessionId":"verify-loose"}`. Capture `03-stopped`.
- `archive-delete`
  - Action: `ab find role button click --name "Session menu for Loose session" --exact;
    ab find role menuitem click --name "Archive" --exact`
  - Result: toast `Session archived` (read `[data-sonner-toast]`); "Loose session" leaves
    navigation "Sessions". Capture `04-archived`. Delete is driven on the project home
    ([`project-home.md`](./project-home.md) `row-actions`). Both change the database; relaunch
    afterwards.

## Gotchas

- Opening any session page starts a `probe` Pi; it is not a resend.
- "hold" must be the whole prompt for the fake Pi to keep running.
- The Session column of the cost popover shows `—` on fake Pi; only the Response column is real.
