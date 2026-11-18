# MCP setup and management in Piano

Research date: 2026-10-09. Piano inspected at `024b4b96cbeeaf0f336c248e47698bc4af8e79e7`;
installed `@earendil-works/pi-coding-agent` and `pi-mcp`: **1.1.0**; Node **24.21.0**.
This is research and a recommendation, not an implemented management feature.
Pi citations below are pinned to `v1.1.0`, not the moving upstream default branch.

## Recommendation

**Use Pi's built-in MCP implementation. Add a Piano management surface around it,
not a second MCP client, configuration store or OAuth implementation.** MCP tools
already work through Piano's normal Pi RPC children. The missing work is convenient
configuration, durable status/authentication UI and explicitly applying changes to
running sessions. This preserves ADR 0001 and INV-01, INV-02, INV-04, INV-07,
INV-11 and INV-12. [Piano architecture][architecture] [Invariants][invariants]

Two particularly important findings:

- **`/mcp` works over RPC, but does not open the terminal manager.** It emits a
  status notification; login, logout and reconnect are supported subcommands.
  Enable/disable and exposure editing are terminal-manager operations, not extra
  slash subcommands. [Pi MCP][mcp] [Command implementation][mcp-source]
- **Do not recommend `/reload` in Piano's composer.** Stock Pi 1.1.0 does not
  expose it as an RPC command or registered extension command. An isolated probe
  observed `/reload` accepted as an ordinary prompt (`disposition: started`),
  whereas `/mcp` was `handled`. `/mcp reconnect NAME` also does **not** reread
  changed configuration. Use a newly started session after file changes today;
  add an explicit reload operation before promising hot configuration management.
  [RPC commands][rpc] [Agent prompt handling][agent-session] [Probe](#verification)

## What exists today

| Capability | Current situation |
| --- | --- |
| Connect servers and execute tools | Pi's built-in MCP extension loads normally in the selected checkout. Piano does not supply its own MCP client. |
| Persistent configuration | User `mcp.json`, trusted checkout `.pi/mcp.json`, and Pi's credential store; no Piano MCP registry tables. |
| Check a running session | Send `/mcp`; Piano translates Pi's notification to a notice and displays it as a toast. |
| Login/logout/reconnect | `/mcp login NAME`, `/mcp logout NAME`, `/mcp reconnect NAME` run as extension commands. |
| Full manager | Pi's custom terminal UI is unavailable over RPC. Piano has no dedicated MCP management view. |
| Add/remove without a session | Pi CLI `mcp add` / `mcp remove`; shell commands do not load extensions. |
| Structured diagnostic check | `pi mcp list --json`; this makes new connections, not an observation of a running Piano session. |
| Live structured server inventory | No native MCP inventory/action command in Pi 1.1.0's RPC union, and no MCP-specific Piano wire actions/state. |
| Apply file changes to existing sessions | No first-class Piano reload action. Browser refresh reconnects to the same child, not a reconfigured child. |

Sources: [PiCli][pi-cli], [PiSessions][pi-sessions], [Piano wire][wire],
[SessionHosts][hosts], [browser notices][app], [Pi CLI][cli],
[Pi RPC types][rpc-types], [Pi MCP implementation][mcp-source].

Piano defaults to its repository-installed Pi CLI, with `PIANO_PI_CLI` and
`PIANO_PI_ARGS` overrides. It starts `node <cli> --mode rpc ...` with the session's
cwd and inherited backend environment. Consequently, MCP commands, dependencies,
paths and credentials must work **on the machine/account running Piano**, not on
the browser's machine. A variable exported in a separate SSH shell does not change
an already-running systemd backend's environment. [PiCli][pi-cli] [Spawn][pi-sessions]

Each active Pi child owns its own MCP connections and stdio processes. There is no
Piano-wide shared stdio daemon. Diagnostic CLI invocations and Piano's short-lived
model/command probes can also start configured servers, so avoid constant diagnostic
polling or treating a diagnostic connection as the session's connection. Pi closes
stdio process groups on shutdown. [PiSessions `probe`][pi-sessions]
[Pi connection lifecycle][mcp-source] [MCP lifecycle documentation][mcp]

## Setup that works now

### 1. Match Piano's runtime and configuration scope

Run commands as the backend's OS user, from the **actual selected folder or
worktree**. For this checkout, absent an explicit CLI override:

```bash
PI_CLI=/home/exedev/piano/node_modules/@earendil-works/pi-coding-agent/dist/cli.js
cd /path/to/selected-checkout
node "$PI_CLI" --version
```

Use `pi ...` as shorthand only when that executable matches Piano's runtime and
configuration environment. A standalone Pi upgrade does not upgrade Piano's pinned
dependency. `PI_CODING_AGENT_DIR`, when set for the backend, replaces the default
`~/.pi/agent` location. [PiCli][pi-cli] [Pi environment][environment]

| Scope | File / behavior |
| --- | --- |
| Personal, available across checkouts | `<agent-dir>/mcp.json` (normally `~/.pi/agent/mcp.json`); default for CLI add/remove. |
| Folder/worktree-specific | `<session-cwd>/.pi/mcp.json`; add/remove with `--local` or `-l`. Requires Pi project trust to load. |
| Extension registration | `pi.registerMcpServer()` registers a session-scoped server; it is not saved by Pi. File configuration takes precedence. |
| Outcome Project | No MCP configuration scope today. A named group of sessions does not replace each session's actual checkout. |

Use Piano's **Trust folder** action for a checkout whose project resources you have
reviewed. Piano saves the decision through Pi's trust store; its documented effect
is on subsequently started sessions. RPC cannot show Pi's built-in trust prompt.
Trust is permission to load project resources, not an execution sandbox. Worktrees
may be siblings outside a trusted root, and an untracked root `.pi/mcp.json` is not
a guaranteed input to another checkout: configure and trust the selected cwd.
[Pi trust][security] [Piano ProjectTrust][trust] [Configuration][configuration]
[Outcome projects][outcome-projects]

### 2. Add a local stdio server

Pi's documented filesystem example, scoped to this checkout:

```bash
node "$PI_CLI" mcp add -l filesystem -- \
  npx -y @modelcontextprotocol/server-filesystem .
node "$PI_CLI" mcp list --json
```

This example downloads/runs a package. Review the server and use a reviewed version
pin or an installed executable for repeatability. `command` is one executable;
arguments are separate, not a shell string. Relative `cwd` resolves against the
session directory. `npx`, `uvx`, runtimes and executable paths must be available to
the backend. [Pi setup and configuration rules][mcp]

For an environment-backed credential (replace the sample executable):

```bash
node "$PI_CLI" mcp add -l tools --env 'API_KEY=${TOOLS_KEY}' -- uvx tools-mcp
```

The single quotes preserve the environment reference in the saved configuration.
Keep the actual credential outside Git and make it available to the backend through
its existing secret-provisioning mechanism. Pi also accepts whole-value `!command`
resolvers; treat these as executable configuration, not inert text. [Pi MCP][mcp]

### 3. Add a remote streamable HTTP server

Replace this placeholder URL with the server's documented MCP endpoint:

```bash
node "$PI_CLI" mcp add docs \
  --url https://example.com/mcp \
  --bearer-token-env-var DOCS_TOKEN
node "$PI_CLI" mcp list --json
```

This writes a user-level entry with an environment-backed Authorization header.
Pi supports stdio and **streamable HTTP**, not legacy HTTP+SSE transport. An endpoint
named `/sse` is not automatically compatible. Streamable HTTP can itself use SSE
responses; that is different from the rejected legacy transport. [Pi transports][mcp]
[Official transport reference][transports]

For an OAuth server, omit the bearer header, for example Pi's Sentry example:

```bash
node "$PI_CLI" mcp add sentry --url https://mcp.sentry.dev/mcp
node "$PI_CLI" mcp login sentry
```

Pi owns discovery, registration, token exchange, refresh and
`<agent-dir>/mcp-auth.json`. Credentials are keyed by **server name and URL**;
different names can represent different accounts, while identical name/URL pairs
across configuration files share credentials. A configured Authorization header
bypasses MCP OAuth. Static OAuth client configuration is available where dynamic
registration is unsupported. [Pi authentication][mcp]

**Hosted browser caveat:** Pi's callback listener is on the backend machine's
loopback interface. A laptop browser's `127.0.0.1` is not that VM. Pi supports
pasting the final redirected URL into the waiting sign-in input, even when the
browser cannot load that URL. In RPC, Pi sends the authorization URL as a
notification and requests the redirect with `ctx.ui.input`; Piano has the generic
notice/dialog plumbing, but not a dedicated persistent authentication flow.
Use the terminal CLI flow as the reliable setup path pending a Piano OAuth browser
check. Never paste the callback into a normal model prompt or commit/log it.
[Pi login implementation][mcp-source] [RPC extension UI][rpc-ui]

### 4. Verify and apply

1. Grant trust before expecting a local entry to load. `pi mcp list` reads already
   trusted project configuration; adding `--approve` to `mcp list` is **not** a
   supported shortcut in the inspected release.
2. Run `node "$PI_CLI" mcp list --json`. It connects every enabled file-configured
   server, reports tools/errors, and exits 1 for invalid entries or an enabled
   server that did not connect. It is an active diagnostic, not a passive read.
3. Start a **new Piano session** in the intended checkout, then send `/mcp`.
   Look for the intended server and state. A browser refresh alone does not apply
   changed files to an existing child.
4. Only if needed, make one small, non-destructive tool request to establish actual
   functionality. A connected tool listing is not proof of tool authorization.

Steps 1–3 follow [Pi CLI][cli], [Piano lifecycle][hosts] and the
[isolated observations](#verification). They do not require paid model calls.
For a separate terminal Pi session, `/reload` is the documented way to reread
configuration; do not attach a second writer to a Piano-owned session. [Pi MCP][mcp]
[INV-02][invariants]

## Ongoing management

| Task | Available route | Important limit |
| --- | --- | --- |
| Inspect current session | `/mcp` | Notification/toast, not persistent structured inventory. |
| Diagnose file configuration | `node "$PI_CLI" mcp list --json` | Extra connections; does not load extension registrations. |
| Reconnect current server | `/mcp reconnect NAME` | Uses already-loaded config; does not apply file edits. |
| Sign in / out | `/mcp login NAME`, `/mcp logout NAME`, or terminal `mcp login/logout` | Shared Pi credential identity; not a per-browser login. External sign-in is picked up by a running session on its next turn. |
| Add / replace | `node "$PI_CLI" mcp add ...` | Replaces the named entry; do not assume a partial merge. Existing sessions need configuration application. |
| Remove | `node "$PI_CLI" mcp remove NAME` (add `-l` for local) | Does not delete OAuth credentials. Removing a local override may reveal the global entry again. |
| Enable / disable | Pi terminal `/mcp` manager, or edit the defining JSON | No `pi mcp enable/disable` or `/mcp enable/disable` in 1.1.0. |
| Change exposure | Pi terminal manager, JSON, or `mcp add --exposure` while replacing an entry | Per-tool overrides are JSON configuration, not a current Piano form. |
| Diagnose failure | `/mcp`, terminal manager, `<agent-dir>/mcp.log` | Terminal manager includes failed stdio stderr; logs may contain sensitive server output. |

Sources: [Pi MCP][mcp], [CLI commands][cli], [MCP command implementation][mcp-source].

To disable a personal server only in a trusted checkout, merge this into that
checkout's `.pi/mcp.json` without overwriting unrelated entries:

```json
{
  "mcpServers": {
    "internal-tools": { "enabled": false }
  }
}
```

A project entry with no `command`, `url` or `type` overrides only `enabled`,
`exposure` and `toolExposure` of an existing user-level server. A full project
server entry replaces the same-named global server. Do not copy credentials into
project files just to disable a global server. [Pi configuration precedence][mcp]

Exposure is **model access**, not process isolation:

- `codemode` (default): indirect tool discovery/calls from scripts; Pi activates
  codemode as needed. Recommended default for large tool sets.
- `deferred`: tool search loads matching tools for direct model calls.
- `direct`: declares tools immediately; useful for a small frequently used set.
- `hidden`: tools are unreachable, but an enabled server still connects. Use
  `enabled: false` to avoid starting the server.

`toolExposure` overrides individual names/patterns. Tool calls pass through Pi's
tool hooks, including permission extensions; server annotations are unverified
hints, not enforcement. Pi supports MCP resources but does not render MCP Apps.
[Pi exposure, resources and permissions][mcp] [Extension contracts][extensions]

## Recommended Piano implementation path

These are proposals, not existing interfaces.

### First slice: setup and honest diagnostics

Add an on-demand **MCP servers** view plus a matching Mod+K command. Select **User**
or **This folder/worktree**, never silently use the selected outcome Project as a
configuration scope. Show name, concise state and useful actions. Put transport,
source, tool list and sanitized error details behind disclosure. Use existing
shadcn/ui compositions; do not add persistent diagnostic labels to the main chat.
[Repository UI rules][agents]

Keep a small configuration module around Pi's supported CLI operations:

- Invoke the same configured CLI/runtime as PiSessions with an argv array and the
  selected cwd, not a shell-interpolated command.
- Start with add/replace, remove and an explicit **Check connection**. Confirm the
  complete executable/arguments before running an added stdio server. Do not
  silently install or connect on opening the view.
- Treat `mcp list --json` as a point-in-time **configuration diagnostic**, never as
  the live state of an existing session. Retain failed-command JSON where available;
  exit 1 contains useful diagnostic results.
- Keep config in Pi's files and credentials in Pi's stores. Do not replicate merge,
  trust, interpolation or token-refresh rules in Registry.
- Label successful persistence separately from application to running sessions.

**Limitation:** Pi's CLI lacks a passive structured config read and general
patch/enable/disable commands. Its root package exports `createMcpExtension` and
configuration types, but not the internal `loadMcpConfig` /
`updateMcpServerConfig` functions. Importing internal `dist` files is not a stable
supported interface. Request an upstream configuration interface before offering
full structured editing; meanwhile retain a documented file-edit/terminal escape
hatch instead of creating a competing loader. [Pi exports][exports]
[Configuration implementation][config-source] [INV-12][invariants]

### Second slice: apply configuration explicitly

Add an explicit **Reload Pi configuration** operation through `PiSessions.act`,
not a blind `/reload` prompt. A bundled extension with a uniquely named command
can use the public `ExtensionCommandContext.reload()` capability; this is a
feasible bridge to investigate, not a claim that the bridge already exists.
Do not register a replacement `/mcp`: doing so disables the built-in MCP extension.
[Extension command context][extensions] [Built-in replacement rules][mcp]

Before applying, require real quiescence: no run, queue, retry, compaction or
pending dialog. Reload replaces the extension runtime and connections, not just
one MCP object. Keep the existing session/history owner, refresh discovered
commands/state, and report saved-but-not-applied changes. Do not restart the whole
Piano service or interrupt all sessions for a single server edit.
[Reload implementation][agent-session] [INV-01–05 and INV-12][invariants]

### Third slice: first-class live management and OAuth

Prefer upstream typed MCP inventory/change events and management actions over
parsing `/mcp` human text or running a second MCP client. Keep Pi-specific records
inside `server/PiSessions.ts`, translating into new `SessionAction` /
`SessionEvent` variants in `shared/wire.ts`. The inspected MCP extension's
connection list and change listeners are private to its implementation;
`pi.getMcpServers()` only exposes extension registrations, not the complete live
file-configured inventory. A small bridge cannot magically expose all of it.
[Pi MCP implementation][mcp-source] [RPC types][rpc-types] [Extensions][extensions]

Authentication needs a durable sign-in view: authorization link, paste-redirect
input, cancel, timeout and result. Bind it to the owning Pi session/operation and
preserve the one-resolution dialog contract across browser reconnects and tabs.
Do not store auth URLs/callbacks in Registry or transcript messages. Pi should
continue validating state and owning tokens. [INV-02, INV-04, INV-05, INV-11][invariants]
[Pi OAuth implementation][oauth-source]

Account for long operations: Piano's default request deadline is 30 seconds,
while Pi's default MCP request timeout is 60 seconds; non-TUI `/mcp` awaits pending
connections and login can take longer still. A timed-out acknowledgement is not
proof that login/reconnect stopped. Expose pending/cancelled/uncertain outcomes and
do not automatically resend. [PiSessions deadlines][pi-sessions]
[Non-TUI MCP handler][mcp-source] [Pi timeout defaults][mcp]

### Security and verification gates

- Keep current loopback/private-authenticated hosting; adding an MCP management
  view grants executable-configuration power, not merely a preference toggle.
- Never expose resolved secrets, raw auth files or unfiltered stdout/stderr to
  browser state. Existing display redaction is heuristic, not containment.
  Validate authorization URL schemes, and treat server-provided content as
  untrusted. Consider OAuth discovery/redirect SSRF and outbound network policy
  before expanding access beyond the trusted-developer model.
- `enabled: false`, `hidden`, project trust and a worktree are not sandboxes.
  Use narrowly scoped credentials and OS isolation where needed.

Sources: [INV-11][invariants], [Piano display projection][display], [Pi security][security],
[official MCP security guidance][mcp-security] (draft guidance, not a claim that
Piano implements those mitigations).

For implementation, reuse the existing [Pi compatibility fixture][fixture] and add
only missing contract checks: global/local precedence and trust; save versus live
application; unrelated config preservation/concurrent edits; invalid entries;
stdio cleanup and failure; HTTP auth-required; OAuth callback/cancel/timeout/two-tab
races; secret-free delivery; no duplicate processes on browser reconnect. Observe
the affected journey with `agent-browser` on scratch 7171/7172, then run the required
module tests/typecheck/lint gates. A local fake OAuth/MCP server can cover failure
paths without paid model calls or real credentials. [Testing policy][testing]

## Verification

This documentation-only investigation used installed Pi source/docs, cached
first-party upstream source (release tag resolves to
`abe508e1b89912adde45528136c3221eb69acdd7`), Piano source and official MCP references.

A bounded RPC/CLI probe reused `test/fixtures/PiCompatibility.ts` in throwaway
repositories with isolated agent/session storage and a synthetic loopback model
endpoint. At the revision/runtime listed above it observed:

- `/mcp` is in `get_commands`; `/reload` is not.
- `/mcp` reported a connected stdio sentinel and returned `handled`.
- After writing a disabled project override, reconnect still left the running
  sentinel connected: reconnect does not reread files.
- `/reload` returned `started`, not `handled`; the probe aborted immediately.
- A fresh Pi child read the override and reported the sentinel disabled.
- With a saved Pi trust decision, `mcp list --json` reported the global source,
  local override, disabled state and an empty tool list.

The corrected probe passed (exit 0); **zero model requests and zero paid model
calls**. Its initial CLI diagnostic attempt rejected `mcp list --approve`; it was
corrected to use the real saved-trust mechanism, not to bypass trust. Fixture
Pi/MCP children exited and scratch configuration/repos/session storage were removed.
Retained local evidence: `/tmp/piano-mcp-research-2026-10-09/probe.mjs`,
`probe.log`, `probe-results.json`, `fixture-observations.json` and
`fixture-environment.json`. These are local artifacts, not committed portable tests.

No real third-party MCP login/tool call, browser OAuth journey, external CLI
override, application modification or deployment was performed. Existing generic
dialog/browser evidence is not proof of hosted OAuth success. Research does not
warrant rerunning the application verification suite; document/source/link review
and the focused probe establish only the claims above. [Testing policy][testing]

<!-- Source links used throughout the report. -->

[mcp]: https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/mcp.md
[cli]: https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/cli.md
[configuration]: https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/configuration.md
[environment]: https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/environment-variables.md
[security]: https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/security.md
[extensions]: https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/extensions.md
[rpc]: https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/rpc-commands.md
[rpc-ui]: https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/rpc-extension-ui.md
[rpc-types]: https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/modes/rpc/rpc-types.ts
[mcp-source]: https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/extensions/mcp/index.ts
[config-source]: https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/extensions/mcp/config.ts
[oauth-source]: https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/extensions/mcp/oauth.ts
[exports]: https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/index.ts
[agent-session]: https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/agent-session.ts
[transports]: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
[mcp-security]: https://modelcontextprotocol.io/specification/draft/basic/security_best_practices
[pi-cli]: ../../server/PiCli.ts
[pi-sessions]: ../../server/PiSessions.ts
[wire]: ../../shared/wire.ts
[hosts]: ../../server/SessionHosts.ts
[trust]: ../../server/ProjectTrust.ts
[app]: ../../web/src/App.tsx
[display]: ../../server/DisplayProjection.ts
[fixture]: ../../test/fixtures/PiCompatibility.ts
[architecture]: ../adr/0001-pi-rpc-workspace-workbench.md
[invariants]: ../development-invariants.md
[testing]: ../testing.md
[outcome-projects]: ../outcome-projects.md
[agents]: ../../AGENTS.md
