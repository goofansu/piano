# Radius setup in Piano

Open **Settings → Radius**, or choose **Radius** from Mod+K. Setup is machine-wide
for the OS account running Piano, not a browser account or an outcome Project.

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

A Radius organization owner/admin must enable **Web search** separately in Radius.
Installation does not change organization permissions or billing settings. The
extension is optional to Radius itself: MCP also offers a web-search operation.
See [Radius's official setup guide](https://radius.earendil.com/docs/extensions).

Start a **new Piano session** after configuration or installation. Existing Pi
children are not restarted or silently reloaded. A browser reload alone does not
apply configuration to them. Do not send `/reload` as a Piano prompt: stock Pi
1.1.0 does not expose it as an RPC command. See [MCP management](research/2026-10-09-mcp-management.md).

## Boundaries and recovery

- Provider OAuth continues to use `ProviderLogin`. Sign-in and sign-out are both
  available directly in step 1; switching accounts does not require leaving Radius.
  Signing out removes the provider credential, not the saved MCP or extension setup.
- `server/RadiusSetup.ts` owns the narrow setup policy. No MCP client, token store,
  registry records or session-history entries are added (INV-01/02/11/12).
- Pi 1.1.0's standalone `pi mcp list` does not pass the provider-token callback,
  even when `pi auth check --provider radius` is ready. This page does not use that
  CLI result to claim connectivity or ask for a redundant OAuth login.
- Pi does not export its provider-auth MCP writer publicly. The adapter deliberately
  imports the **pinned 1.1.0** configuration helper, rather than reimplementing Pi's
  loader. `test/RadiusSetup.test.ts` exercises the installed helper. Recheck this
  dependency on every Pi upgrade and replace it with a public interface when one
  is available. Public SDK settings/package APIs and the locked CLI handle the rest.
- A single matching Radius endpoint is updated in place, retaining its name,
  exposure, tool filters and unrelated settings. Old MCP OAuth settings and an
  Authorization header are removed so provider authentication takes effect.
  Conflicting names, duplicate endpoints, malformed configuration, disabled/hidden
  servers and custom package filters require attention in Pi instead of being
  overwritten. Project overrides remain Pi's responsibility; this page does not
  claim to describe every folder's effective setup.
- Opening the page never installs packages or connects MCP servers. Installations
  require an explicit click, survive navigation/disconnection, deduplicate concurrent
  requests and have a two-minute deadline. Timeout/shutdown terminates only the owned
  installer process group. Errors are sanitized; retry rereads Pi's actual settings.
  Existing pinned sources are retained. No arbitrary URL/package/command is accepted
  by the API. Restart loses in-memory operation messages, not persisted Pi setup.
- MCP read/merge/write is synchronous using Pi's helper, serialized within Piano.
  Pi's helper does not coordinate writes from external editors/processes; do not edit
  the same `mcp.json` concurrently. Setup uses Piano's installed Pi, not an unrelated
  globally installed `pi` or a custom session CLI override.

## Verification

Acceptance: all three steps are reachable from one quiet settings section; OAuth is
reused for MCP; package installation is explicit and failure-safe; state survives
navigation without duplicating work; unrelated settings and credentials stay private.
Relevant invariants: INV-01/02/04/07/09/11/12.

- `test/RadiusSetup.test.ts`: real Pi config/package readback, provider-auth migration,
  alternate names, unrelated data preservation, malformed/conflicting/disabled states,
  pinned package repair, concurrent observers, sanitized failure/retry, false-success
  rejection, custom-filter preservation and shutdown cancellation. Existing
  `ProviderLogin` tests cover OAuth interaction/persistence and terminal claims.
- `test/browser-radius-setup.mjs`: agent-browser against an isolated scratch backend
  and Vite; real config writes and Pi install CLI with a controlled fake npm executable.
  Only the browser OAuth HTTP boundary is simulated. Checks sign-in, MCP setup,
  install navigation/duplicate requests, failure/retry, reload readback, Mod+K,
  request failure recovery, and mobile descriptions without truncation.
- Baseline gates: `npm test` passed all 130 tests; `npm run typecheck` and
  `npm run lint` passed. Changes were tested on base `f523ee6` plus this feature;
  command output and the tested patch are retained with the evidence.
- Evidence retained in `/tmp/piano-radius-evidence/`, using Node 24.21.0, Pi 1.1.0 and
  headless Chromium on Linux; final browser ports 7181/7182 because another task
  owned 7171/7172. Desktop 1280×900 and mobile dark 390×844. No user registry, real
  credentials, package downloads or paid model calls were used.

This verifies the setup boundary, not a real Radius authorization, live MCP tool call,
organization search enablement or the published extension's runtime behavior. No
production deployment is implied.
