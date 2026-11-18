# Claude Agent through ACP in Piano

Research date: 2026-10-13. Status: recommendation, not an implemented integration or accepted ADR.
Piano inspected at `3d3f9d9d75333c4d54811abecd1bb33a1b14e0be`.

## Recommendation

**Yes: make Piano an ACP client and run the maintained Claude Agent ACP adapter as a
server-owned subprocess, alongside—not through or instead of—Pi RPC.** The supported route is
`@agentclientprotocol/claude-agent-acp` → Anthropic's Claude Agent SDK → Claude Code binary.
It is not a `claude --acp` integration, and choosing a Claude model inside Pi does not run Claude's
agent harness. The adapter is an ACP-project integration using Anthropic's SDK, not an
Anthropic-authored ACP implementation. [A1, A2, H1]

Proposed topology:

```text
Piano browser ── existing Piano HTTP/WebSocket vocabulary ── Piano backend
                                                           ├─ Pi RPC child (Pi sessions)
                                                           └─ Claude ACP adapter (Claude sessions)
                                                                └─ Claude SDK/CLI subprocess
```

Use **ACP v1 over stdio** initially. The protocol's HTTP transport and v2 remain draft; the
released adapter enables v2 only through an experimental environment flag. Neither is needed
for Piano's remote browser: its backend and agent run on the same VM. [P1, P2, A3]

This is a meaningful second-runtime feature, not a transport swap. The biggest changes are
session identity/history, permission requests, and capability-aware controls. Preserve Pi's
current behavior. A superseding ADR is required before implementation: ADR 0001 explicitly
chooses Pi ownership and rejects a generic multi-agent platform. This research does not change
that decision. [L1]

## What was actually inspected

| Source | Observed version/revision |
| --- | --- |
| npm `@agentclientprotocol/claude-agent-acp` | `latest: 0.89.1`; `preview: 0.89.2-preview.11` |
| Adapter release source | `v0.89.1`, commit `4e1fc1e8df2b9af3b1b2d6880ba90c5862283ba8` |
| Adapter dependencies | ACP SDK `1.8.0`; Claude Agent SDK `0.3.293`; Node `>=22` |
| npm `@agentclientprotocol/sdk` | `latest: 1.8.0` |
| ACP documentation source | `89e5b8c21e259a5b169f587164c7eaa500e94e76` |

Versions were checked with read-only `npm view` commands; adapter findings below use the release
source, not unreleased `main`. Old search results use `@zed-industries/claude-code-acp` or
`@zed-industries/claude-agent-acp`; use the current package above. Pin versions and lock their
transitive dependencies when implementing. The released package manifest is the reproducible
version reference. [A1, A2]

No packages were installed into Piano, agents launched, credentials inspected, model prompts
sent, registry modified, or production service restarted. This is source/documentation evidence,
not runtime compatibility proof.

## The ACP contract Piano would implement

### Connection and turn lifecycle

1. Launch the pinned `claude-agent-acp` executable in a server-owned scope, with the selected
   checkout and a deliberately constructed environment. stdout is newline-delimited JSON-RPC
   2.0; stderr is diagnostics. Do not reuse Pi's command/response parser. [P2, A3]
2. Install notification and incoming-request handlers **before** calling `initialize`.
   Negotiate protocol version and capabilities; reject unsupported versions. Missing capabilities
   mean unsupported. The release advertises images, embedded context, session loading, and
   HTTP/SSE MCP support, among other capabilities. [P3, A4]
3. Create with `session/new { cwd, mcpServers: [] }`; retain the **returned** `sessionId`.
   Reopen with `session/load { sessionId, cwd, mcpServers: [] }`. `cwd` is absolute.
   Loading replays history through `session/update` before the load response. Install a separate
   loading/replay phase so those messages cannot interleave incorrectly with a published snapshot.
   `session/resume` deliberately omits history replay, so it is not a substitute after Piano loses
   its display projection. [P4, A4]
4. Submit `session/prompt { sessionId, prompt: [{ type: "text", text }] }`, plus negotiated image
   blocks when present. The request remains outstanding while `session/update` notifications
   stream messages, thoughts, tool calls, plans, and configuration changes. [P5]
5. The prompt response carries a `stopReason`. A last text chunk is not completion, and this
   response is not Pi's immediate `started/queued/handled` acknowledgement. Preserve an explicit
   submitting/in-flight state; do not invent Pi dispositions from a successful stdin write. [P5, L2]
6. Abort with the **notification** `session/cancel`; continue processing updates and permission
   cancellation until the prompt settles. Cancellation may settle through a documented error
   path rather than only `stopReason: "cancelled"`. On transport failure, mark execution uncertain
   or failed; never automatically replay a prompt. [P5, P6]

Use the TypeScript SDK's fluent `client()`/`methods` interface with `ndJsonStream` inside the
adapter module. Current documentation deprecates `ClientSideConnection` for new integrations,
and the released Claude adapter includes an example using the fluent interface. That example is
useful for transport wiring, **not production permission policy**: it auto-approves tools and
advertises stub filesystem handlers. Piano must do neither. [P7, A5]

The SDK does not replace Piano's process supervision, bounded input/output, generation IDs,
slow-browser isolation, request deadlines, or shutdown escalation. Bridge it into an Effect-owned
scope; do not let the browser or a detached Promise own the process. Close the ACP connection
first, allow graceful SDK/CLI cleanup, then enforce a bounded shutdown of the owned process tree.
The adapter has its own child, so testing only the direct process's exit is insufficient. [A3, A5, L3]

### Permissions and elicitation

ACP is bidirectional. The agent calls `session/request_permission` with tool-call context and
options carrying `optionId`, display name, and `kind` (`allow_once`, `allow_always`,
`reject_once`, `reject_always`). Return the selected **opaque ID**, not its label or a guessed
boolean. Cancellation returns the cancelled outcome. [P8]

Proposed Piano implementation:

- Add a typed permission dialog carrying tool context, option IDs/kinds, and the existing host
  generation. Current `Dialog.options: string[]` and Pi-specific deadline semantics are not enough.
- Retain the pending ACP request server-side across browser disconnects. Two tabs, cancellation,
  deadline, and process exit compete for one terminal claim. Ignore/reject stale-generation answers.
- Handle SDK request cancellation (`$/cancel_request` / handler cancellation) as well as Piano's
  own abort action. The released adapter sends cancellation for pending permission requests. [A6]
- Do not auto-approve to make a headless integration convenient. Do not infer that every tool will
  ask: Claude's configured permission rules/mode govern which requests reach Piano. Disable bypass
  mode for the initial integration using the adapter's supported option and verify it; the release
  otherwise can offer bypass depending on environment/settings. [A7]

For a first text/tool slice, do not advertise filesystem or terminal callbacks: the released
adapter uses Claude's own tool execution. This avoids inventing an editor buffer/filesystem module.
It is **not a sandbox** and does not prevent Claude from reading files or running commands. [A5, A7]

Form/URL elicitation is a separate capability. Without form support, this release disables
`AskUserQuestion`; without supported MCP elicitation modes, interactive MCP requests can decline.
A useful daily-use integration should add typed form elicitation, cancellation, and safe URL
presentation, not squeeze structured questions into tool approval booleans. Do not advertise
support before those paths exist. [P9, A7]

## Mapping to Piano's current code

All file references in this section describe the inspected Piano revision. [L2–L5]

| Existing assumption | Required change / proposed scope |
| --- | --- |
| `PiSessions.open/probe`, then `events/act/state` | Retain this deep-module shape. Introduce a narrow `AgentSessions` seam selecting Pi and ACP adapters only when implementing the second runtime. Keep Pi wire translation in `PiSessions`/`PiRecords`; ACP details stay in `AcpSessions`. Do not spread ACP SDK types into React. |
| `SessionHosts` imports `PiSessions` and `PiHistory` directly | Delegate opening and history recovery by runtime. Keep canonical checkout ownership, single-writer locking, retirement, and browser-independent lifetime here. Audit rename/archive/delete/availability, not just create/prompt. |
| Piano preallocates the Pi session UUID | ACP `session/new` returns its own opaque identity. Keep the existing public Piano ID and persist a runtime reference such as `{ kind: "claude-acp", agentSessionId }`. Existing rows migrate to Pi with their current IDs. |
| Registry session identity is `(cwd, sessionId)` | Include runtime identity in backend ownership/collision checks. Preserve project membership and workspace references; do not store ACP transcripts or credentials in the registry. |
| `PiHistory.peek` reads authoritative history without spawning | ACP has replay-on-load, not a general offline history-read method. Initially accept a managed agent load when opening a stopped Claude session; never fake a Pi history file. Treat offline/missing-checkout history as a separate requirement (see below). |
| Models/thinking/commands discovered through Pi `probe` | ACP models and modes can be session-scoped `configOptions`; render returned choices and apply `session/set_config_option`, then accept authoritative updates. Do not cast Claude effort IDs into Pi's `ThinkingLevel`. |
| Pi statuses, widgets, skills and subagent cards | Not a portable ACP contract. Hide unavailable controls; render ordinary ACP tools/plans first. Add explicit translations only for negotiated capabilities. |
| Pi settings/provider/MCP setup | Keep these Pi-specific. Claude owns its own settings, credentials, tools and resource loading. Never copy Pi auth or assume Pi's MCP OAuth store is reusable. |

**Creation failure needs an explicit design.** ACP session creation and registry persistence cannot
be one transaction. Proposed sequence: allocate a pending Piano reference, request `session/new`,
persist the returned native ID, then admit prompts. If persistence fails, close the new agent session
and report failure. A crash between native creation and persistence may leave an unreferenced native
session; do not silently import it or resend a user prompt on restart. Choose and test a recovery
policy in the implementation ADR. [P4, L4, L5]

**History is the first go/no-go check.** `session/load` is implemented in the release, using Claude
SDK history and replay. But `readResumedSession` catches read errors and returns an empty result,
and loading validates the cwd and starts the CLI. The advertised capability alone does not prove
Piano's missing-history, corrupted-history, alias, deleted-worktree, or offline-read contracts.
Test these before promising parity. Prefer fixing adapter behavior upstream over building another
Claude JSONL parser in Piano. If offline reading is required, evaluate an explicitly Claude-specific,
read-only SDK history adapter; it is not generic ACP. [A4, A8, L4]

### Feature parity is capability-based, not assumed

| Feature | First integration recommendation |
| --- | --- |
| Text, thoughts, images, tools | Map ACP chunks/tool IDs into Piano's projections. Respect message IDs when supplied and merge partial tool updates instead of replacing missing fields. Extend rendering for structured diffs/locations rather than discarding them. [P5, P8] |
| Reconnect | Reattach to the existing host's atomic snapshot/live stream. Only a cold reopen loads native history. Replayed messages must not be counted as new work or duplicated by optimistic user messages. [P4, L3] |
| Model / effort / permission mode | Prefer `configOptions` over legacy `modes`; preserve opaque choice IDs. Mode changes can expand permissions and need explicit user intent. [P10] |
| Commands | Consume `available_commands_update`; advertised slash commands are prompt text. Do not promise all Claude terminal commands. The adapter filters terminal-only commands and special-cases `/mcp`. [A1, A4] |
| Steering / queues | The release advertises `_session/steering` and Claude-specific `promptQueueing`. These are extensions, not Pi's queue/restore semantics. Start with one outstanding prompt and explicit cancellation; hide Pi steering/queue restoration for Claude. Add extensions only after testing ordering, stop, and late completion. [A4, A5] |
| Usage and cost | The adapter emits `usage_update` with context `used/size` and USD cost from SDK results. Do not assume this equals Piano's full-session Pi accounting across reopen, or synthesize missing cache/token fields as zero. Audit accumulation/replay semantics first. [A9, L2] |
| Subagents | Release source includes optional native/flattened subagent behavior and AIR extensions. Do not map it to Pi's `RunLedger` or advertise child-session support until parent/child routing, permission ownership, and restart replay are tested. [A1, A4] |
| Fork / delete / rename | Capability/extension dependent; fork is not a code/worktree fork. Keep Piano's non-destructive reference removal distinct from native session deletion. Defer UI parity rather than issuing a destructive substitute. [P4, A4, L4] |

## Authentication, configuration, and deployment

**Technical path.** The adapter uses the Claude Code system-prompt/tool presets and defaults to
`settingSources: ["user", "project", "local"]`. It resolves the SDK's bundled native CLI or the
`CLAUDE_CODE_EXECUTABLE` override; the platform-specific optional SDK dependency must be installed.
The override is another compatibility target, not automatically equivalent to the bundled version.
Claude resource loading is not Pi resource loading: do not promise existing Pi extensions, skills,
`AGENTS.md` handling, MCP setup, or trust settings carry over. [A2, A3, A7]

Run under the intended OS user with explicit HOME/config environment and selected checkout. A
systemd service does not necessarily share an interactive shell's environment. For an initial
API-key setup, supply `ANTHROPIC_API_KEY` to the backend-owned agent environment through private
server configuration, not a browser-visible command, URL, registry field, or logged payload.
Anthropic's quickstart also documents provider-specific environment authentication. [H2]

**Subscription login is technically exposed, but product permission is not settled by that fact.**
The adapter advertises terminal login only when the client supports it; remote-environment detection
switches to a terminal flow. Its `authenticate` implementation handles gateway methods and throws
for ordinary unsupported method IDs. Calling `authenticate("claude-login")` is not a browser OAuth
implementation. Start with preconfigured credentials; a future terminal-auth UX needs an explicit
PTY/login design suitable for exe.dev, not an assumption that a localhost callback reaches the
user's browser. Pi's `ProviderLogin` is not this implementation. [A4]

Two live Anthropic sources differ in scope and emphasis:

- The **SDK overview** says third-party developers may not offer claude.ai login or rate limits in
  products without prior approval, and recommends API-key authentication. [H1]
- The **Help Center's October 7, 2026 update** says users can still use the Agent SDK, `claude -p`,
  and third-party apps with subscription limits; it also announces monthly API credits for Max/Team.
  This establishes user-facing availability, not an explicit grant for Piano to offer login. [H3]

Do not flatten those into either “subscriptions never work” or “Piano may freely ship subscription
login.” Recommend API-key-backed support first and confirmation from Anthropic before offering a
Piano-branded subscription login flow. Personal use of an already configured CLI should be evaluated
against the user's applicable plan/terms. This research is not a legal determination.

For the UI, Anthropic's SDK branding guidance recommends **“Claude Agent”** (or “Claude” in an
Agents menu), and disallows presenting an SDK integration as “Claude Code” or “Claude Code Agent.”
Use “Claude Agent” for the selector even though the implementation runs Claude's agent harness. [H1]

Keep Piano loopback-only behind authenticated private access. Do not forward arbitrary browser
commands/env or arbitrary ACP `_meta.claudeCode.options` to the adapter: that metadata can affect
execution and configuration. Permission UI and a worktree are not process isolation. [A7, L1]

## Suggested implementation sequence and acceptance gates

1. **Disposable compatibility spike, before abstraction.** Use pinned packages outside Piano's
   production installation, a scratch checkout/registry, and intentionally configured credentials.
   Exercise initialize → new → short prompt → permission approve/deny → cancel → close → fresh
   process/load → continue. Record protocol capabilities and whether replay is complete. Test
   missing/corrupt history, missing checkout, and cleanup of the adapter plus SDK child. Stop if
   durable reopen or safe permission handling cannot satisfy the product contract.
2. **Architecture decision and identity migration.** Supersede only the relevant Pi-only clauses:
   the selected runtime owns its history/semantics; Piano owns references and execution policy.
   Define runtime-qualified ownership, native-ID persistence, creation crash recovery, supported
   authentication, and reduced initial feature scope. Preserve existing Pi sessions unchanged.
3. **Vertical slice.** Add the ACP adapter behind the session seam, an agent selector at session
   creation, capability-aware controls, text/image/tool projection, permissions, and load/reconnect.
   Selecting another agent creates another session; it does not convert Pi history into Claude history.
   Keep project/worktree selection and the existing browser protocol. Put new navigation/actions in
   the command palette where appropriate.
4. **Daily-use follow-up.** Add form/URL elicitation and session config controls; verify Claude
   project settings/MCP/resource loading. Then consider steering, usage precision, advanced diffs,
   and nested subagent sessions based on actual need. No generic plugin catalog is required.

Affected contracts: **INV-01/02/03/04/05/07/11/12/13**. INV-01, INV-02, INV-03 and INV-12 have
Pi-specific language needing deliberate generalization; retain their ownership and evidence intent.
INV-04 must distinguish ACP request/reply/cancellation from Pi extension response semantics. [L1]

Implementation checks should cross the public session interface with a deterministic fake ACP
process: immediate replies; notifications during load; partial tool updates; permission races from
two tabs; cancellation while awaiting permission; disconnect/reconnect without resubmission; transport
EOF/malformed output; pending creation failures; and bounded shutdown with descendants. Confirm
unsupported actions fail clearly and existing Pi tests still pass. Run the required module tests,
typecheck, lint, critical start/reopen browser tests, and a scratch `agent-browser` journey. A tiny
real-agent prompt plus permission/reopen observations verifies the pinned adapter, not all ACP agents.
Do not run production or change the real registry for these checks. [L1, L3]

**Research verification:** reviewed the pinned source paths, protocol lifecycle, npm metadata, local
architecture references, and links. No application tests or browser journey were run because only
this research document changed. Runtime compatibility, permission-mode behavior, history completeness,
service credential setup, and subscription-login product approval remain unverified.

## Sources

Protocol documentation was read from its official repository at the recorded revision; these links
are pinned so later protocol changes do not silently alter the evidence.

- [P1 — ACP docs navigation: v1 latest, v2 draft](https://github.com/agentclientprotocol/agent-client-protocol/blob/89e5b8c21e259a5b169f587164c7eaa500e94e76/docs/docs.json)
- [P2 — Transports](https://github.com/agentclientprotocol/agent-client-protocol/blob/89e5b8c21e259a5b169f587164c7eaa500e94e76/docs/protocol/v1/transports.mdx)
- [P3 — Initialization and capabilities](https://github.com/agentclientprotocol/agent-client-protocol/blob/89e5b8c21e259a5b169f587164c7eaa500e94e76/docs/protocol/v1/initialization.mdx)
- [P4 — Session creation, load, resume and close](https://github.com/agentclientprotocol/agent-client-protocol/blob/89e5b8c21e259a5b169f587164c7eaa500e94e76/docs/protocol/v1/session-setup.mdx)
- [P5 — Prompt lifecycle and cancellation](https://github.com/agentclientprotocol/agent-client-protocol/blob/89e5b8c21e259a5b169f587164c7eaa500e94e76/docs/protocol/v1/prompt-turn.mdx)
- [P6 — Request cancellation](https://github.com/agentclientprotocol/agent-client-protocol/blob/89e5b8c21e259a5b169f587164c7eaa500e94e76/docs/protocol/v1/cancellation.mdx)
- [P7 — TypeScript SDK](https://github.com/agentclientprotocol/agent-client-protocol/blob/89e5b8c21e259a5b169f587164c7eaa500e94e76/docs/libraries/typescript.mdx)
- [P8 — Tools and permission requests](https://github.com/agentclientprotocol/agent-client-protocol/blob/89e5b8c21e259a5b169f587164c7eaa500e94e76/docs/protocol/v1/tool-calls.mdx)
- [P9 — Elicitation](https://github.com/agentclientprotocol/agent-client-protocol/blob/89e5b8c21e259a5b169f587164c7eaa500e94e76/docs/protocol/v1/elicitation.mdx)
- [P10 — Session config options](https://github.com/agentclientprotocol/agent-client-protocol/blob/89e5b8c21e259a5b169f587164c7eaa500e94e76/docs/protocol/v1/session-config-options.mdx)
- [A1 — Adapter README](https://github.com/agentclientprotocol/claude-agent-acp/blob/v0.89.1/README.md)
- [A2 — Released package manifest](https://github.com/agentclientprotocol/claude-agent-acp/blob/v0.89.1/package.json)
- [A3 — Process entry point](https://github.com/agentclientprotocol/claude-agent-acp/blob/v0.89.1/src/index.ts) and [protocol serving](https://github.com/agentclientprotocol/claude-agent-acp/blob/v0.89.1/src/serve.ts)
- [A4 — Initialize, session lifecycle and authentication](https://github.com/agentclientprotocol/claude-agent-acp/blob/v0.89.1/src/acp-agent.ts#L2605-L3006)
- [A5 — Released example client](https://github.com/agentclientprotocol/claude-agent-acp/blob/v0.89.1/examples/simple-client.ts)
- [A6 — Permission request cancellation](https://github.com/agentclientprotocol/claude-agent-acp/blob/v0.89.1/src/acp-agent.ts#L8386-L8442)
- [A7 — Session configuration, tools and SDK options](https://github.com/agentclientprotocol/claude-agent-acp/blob/v0.89.1/src/acp-agent.ts#L9460-L9730)
- [A8 — Native history reads](https://github.com/agentclientprotocol/claude-agent-acp/blob/v0.89.1/src/resumed-session.ts)
- [A9 — Usage projection](https://github.com/agentclientprotocol/claude-agent-acp/blob/v0.89.1/src/acp-agent.ts#L6159-L6180)
- [H1 — Anthropic Agent SDK overview, authentication and branding](https://code.claude.com/docs/en/agent-sdk/overview)
- [H2 — Anthropic Agent SDK quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart)
- [H3 — Anthropic Help Center: SDK with a Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- L1 — [ADR 0001](../adr/0001-pi-rpc-workspace-workbench.md), [invariants](../development-invariants.md), [roadmap](../roadmap.md), [testing policy](../testing.md)
- L2 — [`PiSessions.ts`](../../server/PiSessions.ts), [`shared/wire.ts`](../../shared/wire.ts)
- L3 — [Runtime ownership](../runtime-ownership.md)
- L4 — [`SessionHosts.ts`](../../server/SessionHosts.ts), [`PiHistory.ts`](../../server/PiHistory.ts)
- L5 — [`Registry.ts`](../../server/Registry.ts)
