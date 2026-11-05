# MCP setup in Piano

Open **Settings → MCP**, or choose **MCP** from Mod+K. Setup is machine-wide for the OS
account running Piano, like [Radius setup](radius-setup.md): the page lists Pi's global
`mcp.json` and changes it through Pi's own helpers.

**Configured** lists every entry of that file, in its order, with its endpoint's host or its
command. A catalog server shows its brand mark; a server the user added shows the server icon.
**Available** lists the catalog servers no entry is yet. The catalog in `shared/mcp.ts`:

- **Linear** (`https://mcp.linear.app/mcp`).
- **Jira** (`https://mcp.atlassian.com/v2/mcp`).
- **Paper**, the local stdio relay installed by the Paper desktop app at
  `~/.paper/bin/paper` (`paper.exe` on Windows), with the argument `mcp`.
  Install Paper and enable its CLI on the **machine running Piano** first; keep the
  Paper desktop app running when using its tools. Paper does not use Pi's OAuth sign-in.

## Actions

- **Add MCP server** (the header, or Mod+K on the page) opens a dialog with two tabs. **Form**
  takes a name, a URL or a command, and for a URL how Pi authenticates: **Sign in** (Pi's MCP
  OAuth when the server asks for it) or an **Authorization header**, whose value is sent verbatim
  (`Bearer …`, `Basic …`, or a `${VAR}` reference Pi resolves on the backend); other headers, or
  a command's arguments, environment and working directory, follow. **JSON** takes the
  `mcpServers` object a server's README shows, with one or several servers, and adds them all or
  none. Pi validates every entry before it is written. After adding, a server that signs in opens
  the sign-in dialog straight away.
- **Install** adds a catalog server under its catalog name, with its endpoint or local command.
  An entry already at that endpoint or command, whatever its name, counts as installed and is
  kept as configured. A catalog server whose default name another entry holds says so instead.
- **Edit** opens the same dialog on the entry: its name, transport, URL or command, headers,
  arguments, environment and working directory. The saved Authorization header shows as a masked
  placeholder: blank keeps it, typing replaces it, Remove clears it. Pi's other keys (exposure,
  timeout, OAuth client settings) stay as configured; a change of transport drops the other
  transport's keys. Renaming an entry, or changing its endpoint, drops the sign-in stored for the
  old name and endpoint, since Pi keys tokens by both.
- **Sign in** runs Pi's MCP OAuth (discovery, dynamic client registration, PKCE) and saves
  tokens in Pi's `mcp-auth.json`. Piano usually runs on another machine than the browser, so
  the redirect to Pi's loopback callback may fail to load; paste that page's address into the
  dialog. Piano checks the pasted address against the attempt, so a wrong paste asks again.
- **Sign out** deletes the stored tokens. **Uninstall** (a catalog server) and **Remove** (any
  other) delete the entry and its sign-in, after confirmation, and only if the entry is unchanged
  since the page was read. The sign-in stored for the entry's name and endpoint is cleared
  whatever the entry authenticates with now, so an entry switched to an Authorization header
  after signing in does not reinstall signed in. The sign-in is cleared before the entry; if that
  fails, the entry stays and the removal can be retried. Other servers' sign-ins are kept.

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
- A name is Pi's: letters, digits, `_` and `-`, unique in the file. Adding refuses a taken name,
  a name listed twice or an entry Pi rejects, and then writes nothing.
- OAuth failure details can contain token responses, so the browser receives only a generic
  message. One sign-in runs at a time and expires after 15 minutes.

## Verification

- `test/McpSetup.test.ts` runs Pi's real sign-in against a loopback OAuth + MCP server:
  install preserving unrelated config, pasted-redirect sign-in (including a rejected paste),
  stored-token reuse, sign-out, stale-removal rejection, uninstall and name conflicts. With
  synthetic tokens in a temporary `mcp-auth.json`, it also covers uninstalling after a switch to
  an Authorization header, an unreadable credential store failing and then retrying, and keeping
  another server's sign-in. User-added servers: a batch add in Pi's shape, refusals by field with
  nothing written, edits that keep Pi's other keys and the saved Authorization header, a change of
  transport, a rename dropping stored tokens, an entry holding a catalog name, and Pi's MCP
  switch blocking every change. Paper coverage checks local-command installation without OAuth,
  renamed entries, duplicates, configuration preservation and guarded removal.
- `test/McpConfigEntries.test.ts` covers the named operations against Pi's real loader and
  writer: all-or-none adds under Pi's validation, reviewed replacement and rename, removal by
  name, and the page-level problems.
- Browser check on a scratch instance: add by form and by JSON paste, edit, remove, install,
  sign-in up to the authorization page, Mod+K row. Completing a real authorization was not
  exercised.
