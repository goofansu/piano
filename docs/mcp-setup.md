# MCP setup in Piano

## Boundaries

- `server/McpSetup.ts` owns this policy. Pi owns configuration parsing and validation, OAuth and
  credential storage; no registry records, token values or session history are added
  (INV-01/02/11/12). The browser never receives an `Authorization` header's value, only that one
  is set; other header values and environment values are shown as configured, so keep secrets in
  `${VAR}` references, as Pi documents.
- Pi 1.5.2 still exports neither its MCP config writer, its validator nor its sign-in flow
  publicly, so `McpConfigEntries` and `McpSetup` import the pinned `dist` helpers, as Radius setup
  does. Rechecked against 1.5.2 by diffing those four files with 1.5.0: the validator now delegates
  the `mcpServers` shape to `@earendil-works/pi-mcp`, and the `auth.json` lock follows symlinks;
  the names Piano imports are unchanged. Recheck these imports on every Pi upgrade.
- Piano writes only the global file; project-level `.pi/mcp.json` overrides remain Pi's
  responsibility. An entry disabled or hidden in Pi is listed with that problem and no sign-in.
  When MCP is switched off in Pi's settings (`-builtin:mcp`) or the file is invalid, the page says
  so and offers nothing until it is fixed in Pi.
- A name is Pi's: letters, digits, `_` and `-`, unique in the file. Adding refuses a taken name
  or an entry Pi rejects, and then writes nothing.
- Connecting before saving waits up to 20 seconds, Pi's own retries included. Only one change
  waits for its sign-in at a time; a newer one replaces it. Only that change's own sign-in, which
  its dialog starts and retries, saves it: an entry's Reconnect signs in to the entry as saved,
  so a change the user walked away from is never saved later. While its sign-in runs, the entry
  it changes cannot be edited or removed.
- OAuth failure details can contain token responses, so the browser receives only a generic
  message. One sign-in runs at a time and expires after 15 minutes.
