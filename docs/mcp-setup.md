# MCP setup in Piano

Open **Settings → MCP**, or choose **MCP** from Mod+K. Setup is machine-wide for the OS
account running Piano, like [Radius setup](radius-setup.md). The catalog in `shared/mcp.ts`
lists the servers Piano offers; today that is **Linear** (`https://mcp.linear.app/mcp`).

- **Install** adds the server to Pi's global `mcp.json` under its catalog name.
- **Sign in** runs Pi's MCP OAuth (discovery, dynamic client registration, PKCE) and saves
  tokens in Pi's `mcp-auth.json`. Piano usually runs on another machine than the browser, so
  the redirect to Pi's loopback callback may fail to load; paste that page's address into the
  dialog. Piano checks the pasted address against the attempt, so a wrong paste asks again.
- **Sign out** deletes the stored tokens. **Uninstall** removes the entry and its sign-in,
  after confirmation, and only if the entry is unchanged since the page was read.

Start a **new session** after a change; running Pi children are not reloaded.

## Boundaries

- `server/McpSetup.ts` owns this policy. Pi owns configuration parsing, OAuth and credential
  storage; no registry records, token values or session history are added (INV-01/02/11/12).
- Pi 1.1.0 exports neither its MCP config writer nor its sign-in flow, so the module imports
  the pinned `dist` helpers, as `RadiusSetup` does. Recheck them on every Pi upgrade.
- An unrelated server already using the catalog name, several entries for the same endpoint,
  invalid configuration and disabled/hidden entries are reported, not overwritten. An entry with
  its own Authorization header is treated as installed and needs no sign-in. Project-level
  `.pi/mcp.json` overrides remain Pi's responsibility.
- OAuth failure details can contain token responses, so the browser receives only a generic
  message. One sign-in runs at a time and expires after 15 minutes.

## Verification

- `test/McpSetup.test.ts` runs Pi's real sign-in against a loopback OAuth + MCP server:
  install preserving unrelated config, pasted-redirect sign-in (including a rejected paste),
  stored-token reuse, sign-out, stale-removal rejection, uninstall and name conflicts.
- Browser check on scratch 7171/7172 with an isolated `PI_CODING_AGENT_DIR`: install, sign-in
  up to Linear's real authorization page, rejected paste, cancel, Mod+K row, uninstall and
  mobile layout. Completing a real Linear authorization was not exercised.
