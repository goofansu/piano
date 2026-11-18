# Radius setup in Piano

Open **Settings → Providers** (`/settings/providers`) and use the **Radius** section, or choose
**Providers** from Mod+K. Radius appears first, followed by **Accounts** and **API keys**,
with no duplicate Radius provider row. The Radius section includes its account, MCP and web-search
controls and the setup guide. Setup is machine-wide for the OS account running Piano, not a
browser account or a Project.

1. **Sign in to Radius.** Uses the existing Pi-backed provider OAuth dialog. Pi owns
   credential storage and refresh; no token is returned to the settings page.
2. **Set up MCP.** Saves the official `https://radius.pi.dev/mcp` endpoint with
   `auth: { provider: "radius" }` in Pi's global `mcp.json`. It reuses the provider
   sign-in rather than starting a separate MCP OAuth flow. **Configured** means
   saved configuration, not an observed connection in a running session.
3. **Install web search.** Runs the installed Pi CLI's equivalent of
   `pi install npm:@earendil-works/pi-radius-web-search`. Pi owns package installation
   and settings persistence. **Installed** means a global package declaration and
   package manifest were observed, not that search has been authorized or used.

The **Uninstall** actions on Radius MCP and Web search undo steps 2 and 3 after confirmation.
They work even while signed out, affect only the matching global Radius entry/package,
and do not sign you out or remove the other tool. Uninstall delegates to `pi remove`,
removing the global package declaration and Pi-managed installation; externally managed
copies are not deleted. Existing sessions are not reloaded; start a new session for the
updated setup. A changed configuration requires refreshing and confirming again.

A Radius organization owner/admin must enable **Web search** separately in Radius.
Installation does not change organization permissions or billing settings. The
extension is optional to Radius itself: MCP also offers a web-search operation.
See [Radius's official setup guide](https://radius.earendil.com/docs/extensions).

Start a **new Piano session** after configuration or installation. Existing Pi
children are not restarted or silently reloaded. A browser reload alone does not
apply configuration to them. Do not send `/reload` as a Piano prompt: stock Pi
1.1.0 does not expose it as an RPC command. See [MCP management](research/2026-10-09-mcp-management.md).

## Boundaries and recovery

- Radius lives on the Providers page rather than in its own Settings page; the provider list
  excludes it so it is offered once. Settings navigation and the palette list one row per page,
  with no standalone Radius command.
- Provider OAuth continues to use `ProviderLogin`. Sign-in and sign-out are both
  available directly in step 1; switching accounts does not require leaving Radius.
  Signing out removes the provider credential, not the saved MCP or extension setup.
- `server/RadiusSetup.ts` owns the narrow setup policy. No MCP client, token store,
  registry records or session-history entries are added (INV-01/02/11/12).
- Pi 1.1.0's standalone `pi mcp list` does not pass the provider-token callback,
  even when `pi auth check --provider radius` is ready. This page does not use that
  CLI result to claim connectivity or ask for a redundant OAuth login.
- Pi does not export its provider-auth MCP writer publicly. The adapter deliberately
  imports the **locked 1.5.2** configuration helper through `McpConfigEntries`, rather
  than reimplementing Pi's loader; [MCP setup](mcp-setup.md#boundaries) records its recheck. `test/RadiusSetup.test.ts` exercises the
  installed helper; `test/McpConfigEntries.test.ts` covers BOM-prefixed config. Recheck this
  dependency on every Pi upgrade and replace it with a public interface when one
  is available. Public SDK settings/package APIs and the locked CLI handle the rest.
- A single matching Radius endpoint is updated in place, retaining its name,
  exposure, tool filters and unrelated settings. Old MCP OAuth settings and an
  Authorization header are removed so provider authentication takes effect.
  Conflicting names, duplicate endpoints, malformed configuration, disabled/hidden
  servers and custom package filters are not silently overwritten by setup. A single
  recognized disabled/filtered entry can still be explicitly removed. Project overrides
  remain Pi's responsibility; this page does not
  claim to describe every folder's effective setup.
- Opening the page never installs packages or connects MCP servers. Installations
  require an explicit click, survive navigation/disconnection, deduplicate concurrent
  requests and have a two-minute deadline. Uninstalls use the same lifecycle and reject
  a competing install until completion. Timeout/shutdown terminates only the owned
  installer process group. Errors are sanitized; retry rereads Pi's actual settings.
  Existing pinned sources are retained. No arbitrary URL/package/command is accepted
  by the API. Restart loses in-memory operation messages, not persisted Pi setup.
- MCP read/merge/write is synchronous using Pi's helper, serialized within Piano.
  Pi's helper does not coordinate writes from external editors/processes; do not edit
  the same `mcp.json` concurrently. Setup uses Piano's installed Pi, not an unrelated
  globally installed `pi` or a custom session CLI override.
