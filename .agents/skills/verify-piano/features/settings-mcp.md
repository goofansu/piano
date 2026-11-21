# Settings › MCP

## Driving it with agent-browser

Preconditions: a seeded launch. Only the optional Connect step reaches a public endpoint; the
command fixture and refused URLs below stay local.

- `mcp-empty` and `add-form` refusal
  - Action: `ab open "$WEB_URL/settings/mcp"; ab wait --text "Available"`; capture `01-empty`.
    `ab find role button click --name "Add MCP server" --exact;
    ab find role textbox fill --name "Name" --exact verify-url;
    ab find role textbox fill --name "URL" --exact 'http://127.0.0.1:9/mcp'`.
    Capture `02-url-draft`, then `ab find role button click --name "Add MCP server" --exact;
    ab wait --text "Could not connect to MCP verify-url."`.
  - Result: refusal under URL, dialog stays open, no saved verify-url entry. Capture
    `03-url-refused`; `ab press Escape`.
- `add-form` command success
  - Action: `ab find role button click --name "Add MCP server" --exact;
    ab find role textbox fill --name "Name" --exact verify-command;
    ab find role radio click --name "Command" --exact;
    ab find role textbox fill --name "Command" --exact node;
    ab find role textbox fill --name "Arguments One per line" --exact "$(printf '%s\n%s' "$ROOT/features/sessions/tests/fixtures/phase0-mcp.mjs" "$RUN/mcp-command.log")"`.
    Capture `04-command-draft`, then `ab find role button click --name "Add MCP server" --exact;
    ab wait '[aria-label="MCP verify-command actions"]'`.
  - Result: toast `MCP server added`, Connected row, and `verify-command` in
    `$RUN/pi-agent/mcp.json`. Capture `05-command-added`; keep a copy of that file as side-effect
    evidence. To check startup refusal separately, add `verify-broken` with the same arguments
    plus a third line `--broken`: `Could not start MCP verify-broken.` appears under Command
    and the entry is not saved. Escape closes the refused draft.
- `manage` and `edit`
  - Action: wait for the toast to leave, then
    `ab find role button click --name "MCP verify-command actions" --exact;
    ab find role menuitem click --name "Edit" --exact; ab wait --text "Edit MCP server";
    ab find role textbox fill --name "Name" --exact verify-renamed`.
    Capture `06-edit`, then `ab find role button click --name "Save" --exact;
    ab wait '[aria-label="MCP verify-renamed actions"]'`.
  - Result: toast `MCP server saved`, renamed row and file entry, no old entry.
    Capture `07-saved`. Saving starts this command once again.
- `remove`
  - Action: after the toast leaves,
    `ab find role button click --name "MCP verify-renamed actions" --exact;
    ab find role menuitem click --name "Delete" --exact;
    ab wait --text "Delete MCP verify-renamed?"`; capture `08-confirm-delete`.
    `ab find role button click --name "Delete" --exact;
    ab wait --fn "!document.querySelector('[aria-label=\"MCP verify-renamed actions\"]')"`.
  - Result: the row and file entry disappear; capture `09-deleted` and keep the resulting
    `mcp.json`. This command path does not prove Disconnect of a connected URL server.
- `add-json`
  - Action: `ab find role button click --name "Add MCP server" --exact;
    ab find role tab click --name "JSON" --exact;
    ab find role textbox fill --name "mcpServers JSON" --exact '{"mcpServers":{"one":{"url":"http://127.0.0.1:9/mcp"},"two":{"url":"http://127.0.0.1:9/mcp"}}}';
    ab wait --text "Paste one server at a time."`; capture `10-json-multiple`.
    Replace it with `ab find role textbox fill --name "mcpServers JSON" --exact '{"mcpServers":{"verify-json":{"url":"http://127.0.0.1:9/mcp"}}}';
    ab find role button click --name "Add MCP server" --exact;
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
- The ⋯ menu and Connect have accessible names `MCP <name> actions` / `Connect MCP <name>`; their
  visible text alone is ambiguous. Arguments is named "Arguments One per line"; Working directory is named "Working directory
  Optional". Its longer hint is an accessible description, not part of the name; `#mcp-cwd`
  also selects it.
- Keep configuration copies only from the scratch run: a real `mcp.json` can contain secrets.
  Authenticated Connect/Reconnect, connected URL editing and Disconnect need a separately
  controlled MCP endpoint/sign-in; command CRUD and refused URLs do not prove those paths.
