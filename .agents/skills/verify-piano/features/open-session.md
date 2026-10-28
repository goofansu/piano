# Open and continue a session

A saved session opens from the sidebar, a project home or the Mod+K palette at `/s/<sessionId>`
with its Pi history, its header (project, title, folder, branch), and its usage in the
"Context usage" popover. The user sends follow-ups in the "Message" box and stops a running reply
with "Stop". The row's "Session menu for <title>" archives or deletes it.

## Sub-features

- `open-from-sidebar`: click the session's row in navigation "Sessions".
- `history`: the saved user message and reply render; "Jump to message" lists them.
- `header`: one line: the project crumb ("Project: <name>", only for a member session), the title
  with "Session information and actions" beside it, then folder and branch; at its end "Show
  session rail" and "Changes". The pull request is read in Changes, not here. The session's state
  is the sidebar row's; the header only carries it as screen-reader `role=status` text ("Ready",
  "Not running").
- `cost`: "Context usage" opens "Token and cost breakdown" with the reply's tokens and cost.
- `follow-up`: "Message" plus Enter sends to the same Pi session.
- `stop`: "Stop" aborts a running reply.
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
  - Result: `What is 2 + 2? (Loose session)` and `Answer 4.` visible. Capture `01-opened`.
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
