# Settings › MCP

`/settings/mcp` lists Pi's global `mcp.json` for the scratch instance's isolated
`PI_CODING_AGENT_DIR` (`$RUN/pi-agent/mcp.json`), so every change is a file the drive can read.
A URL server is reached before it is saved, so a scratch run that adds one needs a server
that answers: a URL with no MCP server behind it (`http://127.0.0.1:9/mcp`) shows the refusal,
and Linear or Jira reach their real endpoints and stop at the sign-in (cancel it). A local
command is started once and saved only if it starts: `node test/fixtures/phase0-mcp.mjs <log>`
starts, and adding `--broken` shows the refusal. Catalog servers (Linear, Jira) carry their brand mark;
other servers carry the server icon.

## Sub-features

- `mcp-empty`: with no entries, the page is headed MCP with Add MCP server, no Connected group,
  and Available listing Jira and Linear alphabetically, each with Connect.
- `connect`: Connect on an Available row turns its own button, reaches the endpoint and, since
  it asks for a sign-in, opens the sign-in dialog without writing the file; cancelling leaves
  `mcp.json` unchanged and the row in Available. A completed sign-in (not exercised on a scratch
  run) saves the entry, which moves to Connected.
- `add-form`: Add MCP server (header or palette) opens a dialog on its Form tab: Name, Type
  (URL / Command), URL, Authentication (Sign in if needed / Authorization header), Headers with Add header;
  on Command: Command, Arguments (accessible name "Arguments One per line"), Environment with Add variable, Working directory (hint: "Empty runs the command in each session's folder. Set it only when the command uses relative paths."),
  and the description "Adding runs the command once to check that it starts." A command that
  does not start fails under the Command field ("Could not start MCP <name>. …" and Pi's reason)
  and writes nothing. A command that starts toasts "MCP <name> added." and the row appears with the server
  icon; a URL nothing answers fails under the URL field ("Could not connect to MCP <name>. Check
  the URL and the network, then try again.") and writes nothing; a taken name fails on the Name
  field ("Another MCP server is named <name>.").
- `add-json`: the JSON tab takes an `mcpServers` object with one server; the footer reads
  "Adds <name>" once it parses, two servers read "Paste one server at a time.", and an entry Pi
  rejects fails under the field with Pi's message and writes nothing.
- `manage`: each Connected row has Manage (and Reconnect only when an OAuth server's sign-in is
  gone). Manage opens a menu: Edit (servers the user added only) and a separator, then
  Disconnect (a URL server) or Delete (a command) in red.
- `edit`: Edit opens the add dialog on the entry (no tabs); a saved Authorization header shows as
  a masked placeholder with Remove / Keep; Save toasts "MCP <name> saved.".
- `remove`: Disconnect or Delete asks "Disconnect MCP <Name>?" / "Delete MCP <Name>?" with
  Cancel, then removes the entry and toasts "MCP <Name> disconnected." or
  "MCP <Name> deleted."; the entry leaves the file.
- `problem`: with `{"extensions":["-builtin:mcp"]}` in `$RUN/pi-agent/settings.json`, the page
  shows "MCP is unavailable" with Pi's reason and every control off.

## How to get to it (user POV)

- Sidebar Settings → MCP.
- Palette: Mod+K → MCP; on that page, Add MCP server opens the same dialog as the header.
- Address bar: `/settings/mcp`.

## Driving it with agent-browser

Preconditions: a seeded launch, `. "$RUN/run.env"`, doctor passed;
`ab() { .agents/skills/verify-piano/scripts/ab.sh "$RUN" "$@"; }`. Only the optional Connect
step reaches a public endpoint; the command fixture and refused URLs below stay local.

- `mcp-empty` and `add-form` refusal
  - Action: `ab open "$WEB_URL/settings/mcp"; ab wait --text "Available"`; capture `01-empty`.
    `ab find role button click --name "Add MCP server" --exact;
    ab find role textbox fill --name "Name" --exact verify-url;
    ab find role textbox fill --name "URL" --exact 'http://127.0.0.1:9/mcp'`.
    Capture `02-url-draft`, then `ab find role button click --name "Connect" --exact;
    ab wait --text "Could not connect to MCP verify-url."`.
  - Result: refusal under URL, dialog stays open, no saved verify-url entry. Capture
    `03-url-refused`; `ab press Escape`.
- `add-form` command success
  - Action: `ab find role button click --name "Add MCP server" --exact;
    ab find role textbox fill --name "Name" --exact verify-command;
    ab find role radio click --name "Command" --exact;
    ab find role textbox fill --name "Command" --exact node;
    ab find role textbox fill --name "Arguments One per line" --exact "$(printf '%s\n%s' "$ROOT/test/fixtures/phase0-mcp.mjs" "$RUN/mcp-command.log")"`.
    Capture `04-command-draft`, then `ab find role button click --name "Connect" --exact;
    ab wait '[aria-label="Manage MCP verify-command"]'`.
  - Result: toast `MCP verify-command added.`, Connected row, and `verify-command` in
    `$RUN/pi-agent/mcp.json`. Capture `05-command-added`; keep a copy of that file as side-effect
    evidence. To check startup refusal separately, add `verify-broken` with the same arguments
    plus a third line `--broken`: `Could not start MCP verify-broken.` appears under Command
    and the entry is not saved. Escape closes the refused draft.
- `manage` and `edit`
  - Action: wait for the toast to leave, then
    `ab find role button click --name "Manage MCP verify-command" --exact;
    ab find role menuitem click --name "Edit" --exact; ab wait --text "Edit MCP server";
    ab find role textbox fill --name "Name" --exact verify-renamed`.
    Capture `06-edit`, then `ab find role button click --name "Save" --exact;
    ab wait '[aria-label="Manage MCP verify-renamed"]'`.
  - Result: toast `MCP verify-renamed saved.`, renamed row and file entry, no old entry.
    Capture `07-saved`. Saving starts this command once again.
- `remove`
  - Action: after the toast leaves,
    `ab find role button click --name "Manage MCP verify-renamed" --exact;
    ab find role menuitem click --name "Delete" --exact;
    ab wait --text "Delete MCP verify-renamed?"`; capture `08-confirm-delete`.
    `ab find role button click --name "Delete" --exact;
    ab wait --fn "!document.querySelector('[aria-label=\"Manage MCP verify-renamed\"]')"`.
  - Result: the row and file entry disappear; capture `09-deleted` and keep the resulting
    `mcp.json`. This command path does not prove Disconnect of a connected URL server.
- `add-json`
  - Action: `ab find role button click --name "Add MCP server" --exact;
    ab find role tab click --name "JSON" --exact;
    ab find role textbox fill --name "mcpServers JSON" --exact '{"mcpServers":{"one":{"url":"http://127.0.0.1:9/mcp"},"two":{"url":"http://127.0.0.1:9/mcp"}}}';
    ab wait --text "Paste one server at a time."`; capture `10-json-multiple`.
    Replace it with `ab find role textbox fill --name "mcpServers JSON" --exact '{"mcpServers":{"verify-json":{"url":"http://127.0.0.1:9/mcp"}}}';
    ab find role button click --name "Connect" --exact;
    ab wait --text "Could not connect to MCP verify-json."`.
  - Result: no saved entry; capture `11-json-refused`; `ab press Escape`.
- `connect` (public network required; no sign-in completion)
  - Action: `ab find role button click --name "Connect MCP Linear" --exact;
    ab wait '[role=dialog]'`; capture `12-sign-in`.
  - Result: dialog `Sign in to Linear`. `ab find role button click --name "Cancel" --exact;
    ab wait --fn "!document.querySelector('[role=dialog]')"` leaves Linear in Available and
    `mcp.json` unchanged. Capture `13-cancelled`. If the endpoint cannot be reached, report
    that prerequisite, not a successful sign-in check. Do not supply real credentials.
- `problem` (last, then Cleanup)
  - Action: `printf '{"extensions":["-builtin:mcp"]}\n' > "$RUN/pi-agent/settings.json";
    ab reload; ab wait --text "MCP is unavailable"`.
  - Result: unavailable reason and disabled Add MCP server. Capture `14-unavailable`.
    This is scratch-only configuration, never the user's Pi settings.

## Gotchas

- These Settings operations use Pi's MCP setup API, not the echo fake's tool calls. The local
  command fixture is real MCP but does not prove a third-party server or OAuth completion.
- Manage and Connect have accessible names `Manage MCP <name>` / `Connect MCP <name>`; their
  visible text alone is ambiguous. Arguments and Working directory include their hints in
  accessible names; prefer `#mcp-cwd` for the latter if needed.
- A create/save toast can cover Manage. Wait with
  `ab wait --fn "!document.querySelector('[data-sonner-toast]')"` before opening its menu.
- Catalog identity follows the endpoint, not the configured name. A command merely named
  `linear` is still a custom command; a catalog URL has the catalog's management policy.
- Keep configuration copies only from the scratch run: a real `mcp.json` can contain secrets.
  Authenticated Connect/Reconnect, connected URL editing and Disconnect need a separately
  controlled MCP endpoint/sign-in; command CRUD and refused URLs do not prove those paths.
