# Settings › MCP

`/settings/mcp` lists Pi's global `mcp.json` for the scratch instance's isolated
`PI_CODING_AGENT_DIR` (`$RUN/pi-agent/mcp.json`), so every change is a file the drive can read.
No MCP server is reached unless a sign-in starts; fake Pi never connects one. Catalog servers
(Linear, Jira, Paper) carry their brand mark; servers the user added carry the server icon.

## Sub-features

- `mcp-empty`: with no entries, the page is headed MCP with Add MCP server, no Configured group,
  and Available listing Linear, Jira and Paper, each with Add.
- `install`: Add on an Available row writes the entry under its catalog name and toasts
  "<Name> MCP added."; Linear and Jira then open the sign-in dialog (Pi's OAuth against the
  real endpoint: cancel it on a scratch run). The row moves to Configured with its host or
  command and Sign in / Edit / Remove.
- `add-form`: Add MCP server (header or palette) opens a dialog on its Form tab: Name, Type
  (URL / Command), URL, Authentication (Sign in / Authorization header), Headers with Add header;
  on Command: Command, Arguments (one per line), Environment with Add variable, Working directory.
  Add toasts "<name> MCP added for new sessions." and the row appears with the server icon; a
  taken name fails on the Name field ("Another MCP server is named <name>.").
- `add-json`: the JSON tab takes an `mcpServers` object; the footer reads "Adds a, b" once it
  parses, Add toasts the names, and an entry Pi rejects fails under the field with Pi's message
  and writes nothing.
- `edit`: Edit opens the dialog on the entry (no tabs); a saved Authorization header shows as a
  masked placeholder with Remove / Keep; Save toasts "<name> MCP saved for new sessions.".
- `remove`: Remove asks "Remove <Name> MCP?" and toasts
  "<Name> MCP removed for new sessions."; the entry leaves the file.
- `problem`: with `{"extensions":["-builtin:mcp"]}` in `$RUN/pi-agent/settings.json`, the page
  shows "MCP is unavailable" with Pi's reason and every control off.
