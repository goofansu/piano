# Open and continue a session

A saved session opens from the sidebar, a project home or the Mod+K palette at `/s/<sessionId>`
with its Pi history, its header (title, folder, branch, project, PR), and its usage in the
"Context usage" popover. The user sends follow-ups in the "Message" box and stops a running reply
with "Stop".

## Sub-features

- `open-from-sidebar`: click the session's row in navigation "Sessions".
- `history`: the saved user message and reply render; "Jump to message" lists them.
- `header`: one line: the project crumb, the title with "Session information and actions" beside
  it, then folder and branch; at its end the PR control. The session's state is the sidebar
  row's; the header only carries it as `role=status` text.
- `cost`: "Context usage" opens "Token and cost breakdown" with the reply's tokens and cost.
- `follow-up`: "Message" plus Enter sends to the same Pi session.
- `stop`: "Stop" aborts a running reply.

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

## Gotchas

- Opening any session page starts a `probe` Pi; it is not a resend.
- "hold" must be the whole prompt for the fake Pi to keep running.
- The Session column of the cost popover shows `—` on fake Pi; only the Response column is real.
