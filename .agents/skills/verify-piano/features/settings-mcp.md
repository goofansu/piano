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
  and Available listing Linear and Jira, each with Connect.
- `connect`: Connect on an Available row turns its own button, reaches the endpoint and, since
  it asks for a sign-in, opens the sign-in dialog without writing the file; cancelling leaves
  `mcp.json` unchanged and the row in Available. A completed sign-in (not exercised on a scratch
  run) saves the entry, which moves to Connected.
- `add-form`: Add MCP server (header or palette) opens a dialog on its Form tab: Name, Type
  (URL / Command), URL, Authentication (Sign in if needed / Authorization header), Headers with Add header;
  on Command: Command, Arguments (one per line), Environment with Add variable, Working directory,
  and the description "Adding runs the command once to check that it starts." A command that
  does not start fails under the Command field ("Could not start <name> MCP. …" and Pi's reason)
  and writes nothing. A command that starts toasts "<name> MCP added for new sessions." and the row appears with the server
  icon; a URL nothing answers fails under the URL field ("Could not connect to <name> MCP. Check
  the URL and the network, then try again.") and writes nothing; a taken name fails on the Name
  field ("Another MCP server is named <name>.").
- `add-json`: the JSON tab takes an `mcpServers` object with one server; the footer reads
  "Adds <name>" once it parses, two servers read "Paste one server at a time.", and an entry Pi
  rejects fails under the field with Pi's message and writes nothing.
- `manage`: each Connected row has Manage (and Reconnect only when an OAuth server's sign-in is
  gone). Manage opens a menu: Edit (servers the user added only) and a separator, then
  Disconnect (a URL server) or Delete (a command) in red.
- `edit`: Edit opens the add dialog on the entry (no tabs); a saved Authorization header shows as
  a masked placeholder with Remove / Keep; Save toasts "<name> MCP saved for new sessions.".
- `remove`: Disconnect or Delete asks "Disconnect <Name> MCP?" / "Delete <Name> MCP?" with
  Cancel, then removes the entry and toasts "<Name> MCP disconnected." or
  "<Name> MCP deleted."; the entry leaves the file.
- `problem`: with `{"extensions":["-builtin:mcp"]}` in `$RUN/pi-agent/settings.json`, the page
  shows "MCP is unavailable" with Pi's reason and every control off.
