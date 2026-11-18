# MCP setup in Piano

## Saving only what connects

A URL server is written to `mcp.json` only once Pi's own MCP client has connected to it, so the
Connected list holds servers that worked when they were added:

- A server that answers is saved at once.
- A server that asks for an OAuth sign-in is not saved yet: the sign-in dialog opens, and its
  success saves the entry. A refused, cancelled or expired sign-in saves nothing and drops any
  tokens it stored.
- A server that cannot be reached, or rejects its Authorization header, is refused on the URL
  field with a fixed message (no response body reaches the browser), and nothing is written.

The same holds for an edit that leaves a URL server: the edit is saved only once the edited
server connects. A local command is saved only once Pi's client has started it: Piano runs the
command once, stops it, and refuses one that does not start with Pi's reason (the tail of the
command's stderr). The dialog says so while a command is entered, since saving runs it.

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

## Verification

- `test/McpSetup.test.ts` runs Pi's real client and sign-in against a loopback OAuth + MCP
  server that also accepts a fixed Authorization header: connecting a catalog server that is
  saved only once the pasted-redirect sign-in succeeds (including a rejected paste), stored-token
  reuse, a refused or cancelled sign-in saving nothing and leaving no tokens, a waiting edit
  that the entry's own Reconnect never saves, an unreachable
  server or a rejected header refused on the URL field, a local command saved only once it
  starts and stopped after the check, a form add that takes the Authorization header from its
  own field only, edits that keep Pi's other keys and the saved Authorization header and save only once
  they connect, a rename dropping stored tokens, removal after a switch to a header (with an
  unreadable credential store failing and then retrying), an entry at a catalog endpoint, a taken
  default name, and Pi's MCP switch blocking every change.
- `test/McpConfigEntries.test.ts` covers the named operations against Pi's real loader and
  writer: all-or-none adds under Pi's validation, reviewed replacement and rename, removal by
  name, and the page-level problems.
- `test/McpSetupView.test.ts` covers what each row offers: Manage's Edit, Disconnect or Delete,
  and Reconnect.
