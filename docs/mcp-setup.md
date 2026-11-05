# MCP setup in Piano

Open **Settings → MCP**, or choose **MCP** from Mod+K. Setup is machine-wide for the OS
account running Piano, like [Radius setup](radius-setup.md): the page lists Pi's global
`mcp.json` and changes it through Pi's own helpers.

**Connected** lists every entry of that file, in its order, with its endpoint's host or its
command. A catalog server shows its brand mark; any other server shows the server icon.
**Available** lists the catalog servers no entry is yet. The catalog in `shared/mcp.ts` holds
hosted servers only:

- **Linear** (`https://mcp.linear.app/mcp`).
- **Jira** (`https://mcp.atlassian.com/v2/mcp`).

A local command, such as Paper's relay, is added with **Add MCP server**: for Paper, the command
`~/.paper/bin/paper` (`paper.exe` on Windows) with the argument `mcp`, on the **machine running
Piano**, with the Paper desktop app running while its tools are used.

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

## Actions

- **Connect** (in Available) connects a catalog server under its catalog name. An entry already
  at that endpoint, whatever its name, counts as connected and is kept as configured. A catalog
  server whose default name another entry holds says so instead.
- **Add MCP server** (the header, or Mod+K on the page) opens a dialog with two tabs. **Form**
  takes a name, a URL or a command, and for a URL how Pi authenticates: **Sign in if needed** (Pi's MCP
  OAuth when the server asks for it) or an **Authorization header**, whose value is sent verbatim
  (`Bearer …`, `Basic …`, or a `${VAR}` reference Pi resolves on the backend); other headers, or
  a command's arguments, environment and working directory, follow. **JSON** takes the
  `mcpServers` object a server's README shows, one server at a time; it is the way to set Pi's
  keys the form does not show, such as a timeout or a pre-registered OAuth client. Pi validates
  the entry before anything is written.
- **Manage** opens a menu on the entry:
  - **Edit** (servers the user added; a catalog server's endpoint is Piano's) opens the add
    dialog on the entry: its name, transport, URL or command, headers, arguments, environment and
    working directory. The saved Authorization header shows as a masked placeholder: blank keeps
    it, typing replaces it, Remove clears it. Pi's other keys (exposure, timeout, OAuth client
    settings) stay as configured; a change of transport drops the other transport's keys.
    Renaming an entry, or changing its endpoint, drops the sign-in stored for the old name and
    endpoint, since Pi keys tokens by both.
  - **Disconnect** (a URL server) or **Delete** (a local command), last in the menu, asks first
    and then removes the entry and its sign-in, only if the entry is unchanged since the page was read. The sign-in stored for the
    entry's name and endpoint is cleared whatever the entry authenticates with now, so an entry
    switched to an Authorization header after signing in does not come back signed in. The
    sign-in is cleared before the entry; if that fails, the entry stays and the removal can be
    retried. Other servers' sign-ins are kept.
- **Reconnect** appears beside Manage only when an OAuth server's sign-in is gone (expired,
  revoked, or removed outside Piano), and signs in again.
- Sign-in runs Pi's MCP OAuth (discovery, dynamic client registration, PKCE) and saves tokens in
  Pi's `mcp-auth.json`. Piano usually runs on another machine than the browser, so the redirect
  to Pi's loopback callback may fail to load; paste that page's address into the dialog. Piano
  checks the pasted address against the attempt, so a wrong paste asks again.

Start a **new session** after a change; running Pi children are not reloaded.

## Boundaries

- `server/McpSetup.ts` owns this policy. Pi owns configuration parsing and validation, OAuth and
  credential storage; no registry records, token values or session history are added
  (INV-01/02/11/12). The browser never receives an `Authorization` header's value, only that one
  is set; other header values and environment values are shown as configured, so keep secrets in
  `${VAR}` references, as Pi documents.
- Pi 1.5.0 still exports neither its MCP config writer, its validator nor its sign-in flow
  publicly, so `McpConfigEntries` and `McpSetup` import the pinned `dist` helpers, as Radius setup
  does. Rechecked against 1.5.0: the config, MCP runtime and auth-storage helpers are identical to
  1.4.0; since 1.4.0, config reads and edits strip a UTF-8 BOM. Recheck these
  imports on every Pi upgrade.
- Piano writes only the global file; project-level `.pi/mcp.json` overrides remain Pi's
  responsibility. An entry disabled or hidden in Pi is listed with that problem and no sign-in.
  When MCP is switched off in Pi's settings (`-builtin:mcp`) or the file is invalid, the page says
  so and offers nothing until it is fixed in Pi.
- A name is Pi's: letters, digits, `_` and `-`, unique in the file. Adding refuses a taken name
  or an entry Pi rejects, and then writes nothing.
- Connecting before saving waits up to 20 seconds, Pi's own retries included. Only one change
  waits for its sign-in at a time; a newer one replaces it.
- OAuth failure details can contain token responses, so the browser receives only a generic
  message. One sign-in runs at a time and expires after 15 minutes.

## Verification

- `test/McpSetup.test.ts` runs Pi's real client and sign-in against a loopback OAuth + MCP
  server that also accepts a fixed Authorization header: connecting a catalog server that is
  saved only once the pasted-redirect sign-in succeeds (including a rejected paste), stored-token
  reuse, a refused or cancelled sign-in saving nothing and leaving no tokens, an unreachable
  server or a rejected header refused on the URL field, a local command saved only once it
  starts and stopped after the check, edits that keep Pi's other keys and the saved Authorization header and save only once
  they connect, a rename dropping stored tokens, removal after a switch to a header (with an
  unreadable credential store failing and then retrying), an entry at a catalog endpoint, a taken
  default name, and Pi's MCP switch blocking every change.
- `test/McpConfigEntries.test.ts` covers the named operations against Pi's real loader and
  writer: all-or-none adds under Pi's validation, reviewed replacement and rename, removal by
  name, and the page-level problems.
- `test/McpSetupView.test.ts` covers what each row offers: Manage's Edit, Disconnect or Delete,
  and Reconnect.
