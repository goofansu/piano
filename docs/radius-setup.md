# Radius setup in Piano

Open **Settings → Providers** and use the **Radius** section, or choose **Radius** from
Mod+K. `/settings/radius` stays a working address: it opens Providers with the Radius
section revealed, as the palette row does. Radius appears first, followed by **Other providers**,
with no duplicate Radius provider row. **Tools and web search** folds the MCP and web-search
steps away and reports where they stand while folded; its expanded content includes the setup guide. Setup is
machine-wide for the OS account running Piano, not a browser account or a Project.

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

**Remove MCP** and **Uninstall extension** undo steps 2 and 3 after confirmation.
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

## Share a session

When Radius is signed in, **Share** appears between Pin and Archive in a session's sidebar menu,
and under Session commands in Mod+K. Artifacts are named `Pi session <full session ID>`; sharing
again updates an existing artifact’s title as well as its content. **Radius MCP is not required**: Piano resolves credentials
through Pi and uploads directly to Radius artifacts.

Confirming Share publishes an **organization-only snapshot** of the saved current branch, including
instructions, tool output and attachments. Review sensitive content first; Piano's existing secret
filtering is heuristic, not a guarantee. Sharing waits for the session to be idle and never starts
another agent. On success, copy or open the link and see its expiration date. Later messages are not
automatically published; another confirmed Share adds a version at the **same URL**, including
after restarting Piano. Earlier versions remain available in Radius. Radius owns visibility,
retention and deletion. Piano currently caps the exported upload at 10 MiB and the operation at one
minute; these are Piano limits, not Radius quota claims. If upload completion is uncertain, check
Radius artifacts before sharing again—Piano never automatically retries a publication.

Unlike Pi's interactive `/share`, this reads the saved branch without adding a fresh `pi.share`
runtime metadata entry or falling back to GitHub. Instructions already saved by Pi remain included.
Piano's database stores only the artifact ID, URL and Radius organization ID—not a transcript copy.
An empty artifact is allocated and its identity saved before the first transcript upload. If saving
fails, no transcript is uploaded. Later shares verify the saved destination and never silently
replace it if it has expired, been deleted, become inaccessible, or changed visibility. Sign back
into the original organization to update a link after switching organizations.

The first share after this feature was introduced establishes the reusable link: older Piano
versions did not save artifact identities, so previously created links cannot be adopted
automatically. Deleting a session from Piano removes its local association, not its Radius artifact.
Manage published versions and their deletion in Radius. Restoring an old Piano database backup can
also lose newer associations; the stable-link guarantee depends on keeping Piano's database.

## Boundaries and recovery

- Radius lives on the Providers page rather than in its own Settings page; the provider list
  excludes it so it is offered once. Settings navigation lists one row per page, while the
  palette keeps a Radius row.
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

## Verification

Acceptance: all three steps are reachable from one quiet settings section; OAuth is
reused for MCP; package installation is explicit and failure-safe; state survives
navigation without duplicating work; unrelated settings and credentials stay private.
Relevant invariants: INV-01/02/04/07/09/10/11/12.

- `test/RadiusSetup.test.ts`: real Pi config/package readback, provider-auth migration,
  alternate names, unrelated data preservation, malformed/conflicting/disabled states,
  pinned package repair, concurrent observers, sanitized failure/retry, false-success
  rejection, custom-filter preservation and shutdown cancellation. Removal tests bind
  confirmation to the reviewed configuration, refuse stale/conflicting targets, preserve
  credentials and unrelated entries, and serialize installs against uninstalls. Existing
  `ProviderLogin` tests cover OAuth interaction/persistence and terminal claims.
- `test/Routes.test.ts` and `test/GlobalCommands.test.ts`: Radius addresses the Providers page,
  navigation lists one row per page, and the palette still offers Radius by name.
- `test/browser-radius-setup.mjs`: agent-browser against an isolated scratch backend
  and Vite; real config writes and Pi install CLI with a controlled fake npm executable.
  Only the browser OAuth HTTP boundary is simulated. Checks sign-in, MCP setup,
  install navigation/duplicate requests, failure/retry, reload readback, Mod+K,
  request failure recovery, progress reported while the tools are folded away (including mid-install),
  the `/settings/radius` address and palette row revealing the section, a Radius-only catalog showing
  no empty-list placeholder, and mobile descriptions without truncation. Removal checks
  cover cancellation, changed-target rejection, signed-out cleanup, real Pi remove CLI
  through fake npm, uninstall failure/retry and duplicate/opposing requests.

### Original setup and removal evidence

- Baseline gates: `npm test` passed all 130 tests; `npm run typecheck` and
  `npm run lint` passed. Changes were tested on base `f523ee6` plus this feature;
  command output and the tested patch are retained with the evidence.
- Evidence retained in `/tmp/piano-radius-evidence/`, using Node 24.21.0, Pi 1.1.0 and
  headless Chromium on Linux; final browser ports 7181/7182 because another task
  owned 7171/7172. Desktop 1280×900 and mobile dark 390×844. No user registry, real
  credentials, package downloads or paid model calls were used.

Removal follow-up: verified on `f8db26c` plus the removal changes, with the same
Node/Pi environment and scratch ports 7171/7172. All 132 module tests, typecheck,
lint and the extended browser journey passed. Evidence is retained under
`/tmp/piano-radius-removal-evidence/`; no real credentials or packages were removed.

### Providers-section follow-up

Verified on base `e083eda` plus this refactor, with Node 24.19.0, Pi 1.1.0 and
agent-browser 0.38.1 on macOS. `npm test` passed all 394 tests; typecheck and lint
passed (Biome retains one unrelated informational finding in `ClientDispatch.test.ts`).
The scratch browser journey on 7171/7172 observed one Radius account surface,
collapsible tools with ongoing installation progress, setup/removal and recovery,
repeat palette reveal, the old address, and mobile deep-link scrolling after the
full provider catalog loads. Desktop 1280×900 and mobile dark 390×844 screenshots,
command output and the tested patch are retained in
`.scratch/radius-providers-evidence/final/`. Scratch processes and files were cleaned up.
The harness now explicitly permits its frontend origin, including direct mutation
requests, to comply with the backend's origin policy.

After rebasing onto `ce4f5bb` (upstream removed three dependency-audit tests), all
391 remaining tests, typecheck, lint and the same browser journey passed again.
Post-rebase output, screenshots and patch are in `.scratch/radius-providers-evidence/rebased/`.

This verifies the setup boundary, not a real Radius authorization, live MCP tool call,
organization search enablement or the published extension's runtime behavior. No
production deployment is implied.
