# Practical remote runners for Piano: synthesis and GitHub implementations

Researched **2026-10-14** against Piano `16563bbce4dac0751bec9b4ba132e341679087f8`.
This follows the [remote-execution comparison](2026-10-14-remote-task-execution.md) and
[Herdr assessment](2026-10-14-herdr-remote-execution.md). It is a recommendation, not shipped
functionality or an accepted replacement for ADR 0001.

## Decision recommendation

**Federate Piano's existing backend: one independently supervised Piano runtime per machine,
one browser entry point, and an SSH tunnel from the gateway to each remote runtime. Keep Pi RPC
inside the runtime that owns the checkout. No Herdr dependency or integration.**

**User constraint, confirmed 2026-10-14:** minimize additional dependencies. Use the system OpenSSH
client and the existing Piano/Pi stack; no Herdr adapter, separate runner framework, or new SSH
library. This supersedes the earlier optional-Herdr suggestion, not the remote security/adoption gate.

Do not begin by adopting a third-party runner, replacing RPC with terminal automation, introducing
Pi SDK/Durable, building a scheduler, or contributing a generic process broker to Herdr.

The most useful new reference is **`jmfederico/pi-web`**: it already implements machine federation,
with a gateway routing selected-machine operations to complete remote runtimes. It demonstrates
why forwarding only prompts is insufficient. Borrow that architecture, not its SDK runtime or
whole plugin platform. [G1–G3]

Piano already owns long-lived Pi children, dialogs, ordered session publication, saved history,
Git/worktree operations, and browser-independent execution. Reuse that implementation remotely
instead of rebuilding these guarantees in a second daemon package. [L1]

```text
Browser (one Piano origin)
  → Piano gateway / machine router
      ├─ existing local execution
      └─ SSH tunnel → remote Piano backend (service-managed, independent lifetime)
                         ├─ SessionHosts → PiSessions → pi --mode rpc
                         ├─ remote folders, Git and Worktrunk
                         ├─ remote Pi configuration, credentials and history
                         └─ that runtime's own Piano database
```

“Worker” is a deployment role here, not a requirement for a new executable, runtime library, or
parallel session implementation. A first release can use the same Piano package on both sides,
with an explicitly authenticated machine-facing interface. It need not serve a second user-facing
UI, and it must not simply publish today's unguarded router.

## What changed from the previous recommendations?

| Earlier approach | Practical decision now |
| --- | --- |
| SSH directly launches `pi --mode rpc` | Useful transport experiment, not the durable session owner. SSH loss can close Pi stdin; remote filesystem/history operations remain missing. [R1] |
| Persistent remote Piano worker | **Keep**, but initially reuse the existing backend rather than inventing a minimal daemon and gradually rebuilding the backend around it. [L1, G1–G3] |
| Herdr hosts the worker in a persistent pane | Not selected: adds a dependency and another lifecycle without supplying the structured worker connection. [R2] |
| Piano dispatches native Herdr agents | Not selected: terminal-agent control differs from Piano's structured Pi sessions and violates the no-Herdr scope. [R2] |
| Outbound worker/relay, as documented by HumanLayer | Defer until a target cannot accept controller-initiated SSH. It solves reachability, but adds enrollment, connection routing and revocation work. [R1] |
| Managed sandbox or CI runner per task | Useful for isolated batch work, not the first interactive own-server experience. [G7] |

This supersedes the Herdr note's deployment preference: **use the existing Piano runtime and
standard OS facilities, without a Herdr adapter.** The comparison remains research evidence,
not an integration backlog. A host picker is not a reason to replace Pi's execution semantics.

## GitHub projects inspected

All five checkouts were inspected without installing dependencies, running their code, supplying
credentials, or launching agents. Findings describe README/source contracts, not demonstrated
runtime reliability. All five declare MIT licensing; licensing does not establish suitability.

| Project and inspected revision | What it implements | Fit for Piano |
| --- | --- | --- |
| [jmfederico/pi-web](https://github.com/jmfederico/pi-web), `29f0ace6d955a458a947bb0f03673fa069afb8da`, version `1.202610.3` | Gateway + machine-local runtimes; HTTP/WebSocket federation; separate web process and session daemon; in-process Pi SDK. | **Best reference for machine federation and operations.** Do not import its SDK runtime just to obtain remote execution. [G1–G3] |
| [marcfargas/pi-server](https://github.com/marcfargas/pi-server), `5b5424c89f95acb973a59bc1424c5da2a1821252`, server `0.2.0` | WebSocket daemon around `pi --mode rpc`, hello/welcome handshake, reconnect readback, terminal client. | Smallest clear example of detachable RPC ownership. Alpha, one connected client, auth/TLS listed as future work; not a complete workspace runner. [G4] |
| [k3-2o/pi-remote](https://github.com/k3-2o/pi-remote), `b2c7817cb9804e6b09a61b95448129543bd44b30`, version `0.5.0` | RPC processes, WebSocket sessions, HTTP/SSE, optional API-key auth, systemd guidance, session pooling. | **Not suitable unchanged for dispatch-and-leave:** WebSocket disconnect explicitly deactivates the session and stops its Pi process. [G5] |
| [milanglacier/pi-tau-web-server](https://github.com/milanglacier/pi-tau-web-server), `0608137916b54fa4be8d2a06033f87dbab71b577`, package `1.1.2` | Standalone backend, one persistent Pi RPC subprocess per in-page tab, browser reconnect, extension dialogs, optional HTTP/WebSocket authentication. | Close reference for the machine-local runtime Piano largely already has. Not an advertised multi-machine gateway. [G6] |
| [shaftoe/pi-coding-agent-action](https://github.com/shaftoe/pi-coding-agent-action), `0d8b7fff1277e25242a9a145cf59bc912a6bcb3e`, inspected `develop` branch (not stable `v2`) | Pi SDK inside GitHub-compatible CI workflows, issue/PR triggers, explicit prompts and workflow outputs. | Batch-runner alternative, including use in an appropriately configured self-hosted workflow. Not an interactive Pi RPC host or SSH fleet manager. [G7] |

### 1. jmfederico/pi-web — closest architecture match

Its fleet guide describes exactly the useful ownership split:

- Install a complete PI WEB runtime on each machine.
- Register its base URL and optional bearer credential in the gateway.
- Browser continues talking to the gateway's origin; gateway contacts the selected machine.
- Route folders/workspaces, sessions, files, diffs, terminals, package configuration and compatible
  plugins to the machine that owns them.
- Credentials, Pi configuration, repositories and session files stay on that machine.
- Removing a machine connection does not stop its runtime or delete its work. [G1]

This is implemented, not merely a diagram: `machineProxyRoutes.ts` registers machine-ID-qualified
HTTP routes and WebSocket bridges; `machineClient.ts` creates remote requests and WebSockets,
forwards configured bearer credentials, bounds request time, and handles redirects manually. [G2]

The runtime has separate web and `sessiond` processes. The daemon owns sessions through Pi SDK
services, with a single-owner marker for its data directory. Its comments explicitly limit that
PID-based ownership detection across separate container PID namespaces; do not assume it is a
distributed lock. Its docs warn that daemon restart can interrupt active sessions. [G3]

**Borrow:** complete machine-local ownership, machine-qualified routing, capability/version
checks, private deployment and explicit lifecycle operations. **Do not copy unquestioningly:**
SDK environment/configuration integration, its plugin machinery, security assumptions, or an
additional local web/daemon split before Piano needs it. A service restart is not crash-safe
resumption of arbitrary commands.

This repository is **not `Epsilondelta-ai/pi-web`**, which the October 2 Piano note reviewed.
They share a name but have different implementations. The older note's process-per-prompt
findings must not be applied to `jmfederico/pi-web`.

### 2. marcfargas/pi-server — simple detached RPC relay

`PiProcess` starts a local Node/Pi child with piped stdin/stdout/stderr. `WsServer` sits in front
of it, accepts a hello message, and sends state readbacks in its welcome message. Its WebSocket
close handler clears the client and cancels pending UI requests without stopping Pi. Thus its
process ownership is independent of the observer's connection. [G4]

Useful reference, but it only accepts one active client. README marks the project alpha and
lists authentication/TLS under future production work. The inspected parser uses Node `readline`,
whereas current Pi RPC docs require strict LF framing because Unicode separators can be valid
inside JSON strings. No Pi 1.2.0 compatibility test was performed here. [G4, P1]

**Verdict:** study its small transport architecture; retain Piano's more complete existing
framing, publication, dialog and multi-observer contracts rather than adding it as a dependency.
Its disconnect-time dialog cancellation is also a policy choice, not behavior Piano should
inherit accidentally.

### 3. k3-2o/pi-remote — remote does not necessarily mean detachable

The README advertises process management, multiplexing, optional auth and daemon operation.
However, the source establishes the relevant lifecycle precisely:

```text
WebSocket cleanupClient()
  → sessionManager.onDisconnect(sessionId)
    → deactivate(sessionId)
      → processManager.remove(sessionId)
```

`deactivate` is documented as “stop its Pi process but keep the record.” Keeping a saved session
record is not keeping a running task alive. A long-lived *server* does not guarantee long-lived
*session execution*. This directly conflicts with Piano's required observer-independent work
if used as the session transport unchanged. [G5, L2: INV-02]

**Verdict:** useful reference for packaging/transports, not an adopted runner for this requirement.

### 4. pi-tau-web-server — validates keeping normal Pi RPC

Tau owns Pi children at the backend. Browser close/reload does not terminate them; closing an
in-page Tau tab or stopping the backend does. It forwards supported extension dialogs and offers
optional authentication on HTTP and WebSockets. It runs on a server directly or in containers.
[G6]

This is close to Piano's current architecture. It confirms there is no need to migrate to Pi SDK
just to run remotely. It does not remove Piano's machine routing, identity, authorization, and
remote workspace work. Its default bind/auth choices are not a security template for Piano.

### 5. Pi Coding Agent Action — a different meaning of runner

This action uses Pi SDK inside a CI job. It supports supplied prompts and workflow-dispatch-style
use, issue/PR context, outputs and reports. Piano could later submit an explicitly authorized
workflow and track its job/artifact/PR outcome, rather than maintain a live interactive session.
[G7; Piano integration proposal]

That can be practical for scheduled audits or bounded PR work on hosted/self-hosted CI runners.
It does not offer interactive steering/dialog/reconnect semantics like Piano. Its documentation
also says CI automatically trusts the checked-out project; trigger authorization, repository trust
and credential scope require care, especially on persistent self-hosted machines. [G7]

## Smallest practical implementation for Piano

### Step 1 — one remote machine, no new execution engine

Use a separate test machine or disposable environment, not the user's existing backend/database.
Run the **same Piano backend package** as a user service on a supported Linux host. Set its own
Piano database, intended working environment and Pi configuration. Keep repositories and Worktrunk
there. Pi must be configured as the service user; do not copy the gateway's entire environment,
provider credentials or SSH agent. [proposal preserving L1–L2]

The runtime must start independently of the controller connection. Use the host's existing service
manager, initially systemd on Linux, rather than adding a terminal multiplexer or process-management
package. Service restart restores a service, not an interrupted agent command.

For a first transport, manually configure an SSH tunnel rather than build automatic provisioning.
SSH keys/config must be on the gateway, not merely the browser's laptop. Bind endpoints to
loopback, verify host keys, use noninteractive dedicated credentials, and disable default agent
forwarding. Protect the remote interface with a scoped credential or an OS-protected socket;
loopback TCP alone is not protection from other local users/processes. Do not expose the current
unauthenticated router publicly. [R1–R2, L2: INV-11]

### Step 2 — a selected-machine interface, not a distributed scheduler

Add a small machine-routing module **above** existing machine-local modules. It should hide
connection/handshake, routing and offline outcomes from callers; avoid teaching every React
component about SSH or Pi-specific payloads. Keep Pi translation inside `PiSessions` on the target.

Initial experience:

1. Register one remote endpoint and verify its stable runtime ID, protocol capabilities and versions.
2. Select **machine → folder/worktree → new session**.
3. Start, observe, answer dialogs, stop and continue through existing Piano session vocabulary.
4. Read saved history and inspect changes from that same machine.
5. Disconnect/reconnect without resending a prompt or creating another Pi process.

Scope the first browser view to one selected machine. Cross-machine aggregated search, project
membership, automatic repo cloning, history migration, previews, remote package management and
credential-login UI can be explicitly deferred. Do not silently route unsupported operations to
Local. Unsupported controls must be absent or clearly unavailable.

Machine qualification is required from day one for workspace/session references, URLs, browser
storage/drafts, images and event cursors. Identical absolute paths on different hosts are not the
same workspace. Keep paths out of HTTP URLs; pass arbitrary path input in request bodies.

Each runtime owns its machine-local registration/history references; the gateway owns connection
metadata. Do not synchronize SQLite databases or create a second authoritative transcript. If
cross-machine project grouping is later added, store only memberships/references centrally.

### Step 3 — keep the dependency surface small

- Invoke the system `ssh` executable and reuse an explicitly selected OpenSSH config alias;
  do not add an SSH library or read Herdr profiles.
- Keep host enrollment manual initially. Verify the remote **Piano runtime** identity independently
  of the host label, SSH alias, or tunnel endpoint.
- Reuse Piano's existing HTTP/WebSocket stack, Pi RPC adapter and database implementation.
  No separate runner package, message broker, scheduler or required container runtime.
- Use ordinary SSH and service logs for operator access; no integrated terminal-agent control.
- Keep the single-writer rule: never open a second Pi TUI process against an active RPC session.

The existing Pi, Git and Worktrunk responsibilities remain unchanged. This is a constraint on new
remote-execution dependencies, not a request to replace existing project tooling. [L1–L2]

### Step 4 — only then solve harder reachability and durability

If target hosts cannot be reached from the gateway, add an authenticated outbound worker
connection, reusing the same machine interface. If provisioning/isolation becomes important,
consider disposable runners or CI workflows separately. If process-crash recovery becomes a real
need, revisit the [Pi Durable assessment](2026-10-11-pi-durable-adoption.md); SSH and systemd
are not substitutes for checkpointed execution and external-effect reconciliation.

Here “dispatch” initially means **start or continue a session on a selected reachable machine**.
It does not promise offline queueing, automatic retry, exactly-once execution, or task acceptance.
A lost mutation acknowledgement remains uncertain; the gateway must not replay it automatically.

## Acceptance gate before adoption

A short implementation/security ADR should record the changed remote-access contract and affected
**INV-01/02/04/05/06/07/11/12**. The smallest useful check is one fake-Pi journey through a scratch
remote runtime, followed by the browser path, not a large new scheduler test suite:

- Start remote work, close the browser, drop the tunnel, and restart the gateway: one remote Pi
  child keeps running and draining output; reconnect observes the same generation, not a resend.
- Two hosts have the same checkout path: prompt, history, diff, worktree creation and attachments
  operate only on the selected host. No fallback to local execution on an offline host.
- Lose the acknowledgement after a prompt write: show uncertainty and reconcile, never blindly retry.
- Answer a dialog from two tabs and race abort/timeout: preserve Piano's existing single-resolution
  and ordered snapshot/event contracts across the extra hop.
- Reject a second runtime against the same execution environment; a lock in one server's memory
  alone is not cross-process ownership enforcement.
- Kill Pi or the remote backend: show actual interruption. A reopened history is not resumed shell
  execution. A restarted gateway must not claim that an unreachable worker has exited.
- Reject bad credentials, wrong host identity and incompatible protocols on HTTP and WebSocket;
  verify raw control endpoints are not reachable outside the intended private route.

No such experiment was run in this research. A later real-model smoke check should use only
`Reply with exactly: X` and read the reply back.

## Sources and provenance

Primary-source discovery used web search, the PI WEB website, npm repository metadata, and local
cached GitHub checkouts. The prior vendor comparison is reused, not presented as a fresh product
retest. No background-agent tool was available. Nothing was deployed or installed on a runner.
The earlier Herdr safety restriction remains: no live Herdr commands or saved profiles were read.

- **G1 — PI WEB product/fleet:** [README](https://github.com/jmfederico/pi-web/blob/29f0ace6d955a458a947bb0f03673fa069afb8da/README.md), [fleet guide](https://github.com/jmfederico/pi-web/blob/29f0ace6d955a458a947bb0f03673fa069afb8da/docs/machines.html), [website](https://pi-web.dev/).
- **G2 — Federation implementation:** [machineProxyRoutes.ts](https://github.com/jmfederico/pi-web/blob/29f0ace6d955a458a947bb0f03673fa069afb8da/src/server/machines/machineProxyRoutes.ts), [machineClient.ts](https://github.com/jmfederico/pi-web/blob/29f0ace6d955a458a947bb0f03673fa069afb8da/src/server/machines/machineClient.ts).
- **G3 — Machine-local daemon/SDK:** [sessiond.ts](https://github.com/jmfederico/pi-web/blob/29f0ace6d955a458a947bb0f03673fa069afb8da/src/server/sessiond.ts), [piSessionService.ts](https://github.com/jmfederico/pi-web/blob/29f0ace6d955a458a947bb0f03673fa069afb8da/src/server/sessions/piSessionService.ts), [single-owner guard](https://github.com/jmfederico/pi-web/blob/29f0ace6d955a458a947bb0f03673fa069afb8da/src/server/sessiond/sessiondStateOwnership.ts).
- **G4 — pi-server:** [README](https://github.com/marcfargas/pi-server/blob/5b5424c89f95acb973a59bc1424c5da2a1821252/README.md), [WebSocket lifecycle](https://github.com/marcfargas/pi-server/blob/5b5424c89f95acb973a59bc1424c5da2a1821252/packages/server/src/ws-server.ts), [Pi process/framing](https://github.com/marcfargas/pi-server/blob/5b5424c89f95acb973a59bc1424c5da2a1821252/packages/server/src/pi-process.ts).
- **G5 — pi-remote:** [README](https://github.com/k3-2o/pi-remote/blob/b2c7817cb9804e6b09a61b95448129543bd44b30/README.md), [WebSocket cleanup](https://github.com/k3-2o/pi-remote/blob/b2c7817cb9804e6b09a61b95448129543bd44b30/src/ws-transport.ts#L301-L329), [disconnect/deactivation](https://github.com/k3-2o/pi-remote/blob/b2c7817cb9804e6b09a61b95448129543bd44b30/src/session-manager.ts#L159-L182).
- **G6 — Tau:** [README/architecture/auth](https://github.com/milanglacier/pi-tau-web-server/blob/0608137916b54fa4be8d2a06033f87dbab71b577/README.md).
- **G7 — CI action:** [README/contracts and security](https://github.com/shaftoe/pi-coding-agent-action/blob/0d8b7fff1277e25242a9a145cf59bc912a6bcb3e/README.md), [SDK session implementation](https://github.com/shaftoe/pi-coding-agent-action/blob/0d8b7fff1277e25242a9a145cf59bc912a6bcb3e/packages/pi-orchestrator/src/pi/agent.ts).
- **P1 — Pi 1.2.0 RPC contract:** [protocol](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/rpc.md).
- **R1:** [Remote-execution comparison](2026-10-14-remote-task-execution.md), including Codex, Claude Code, Amp, HumanLayer and direct SSH alternatives.
- **R2:** [Herdr source/document assessment](2026-10-14-herdr-remote-execution.md), including version pins and live-inspection limits.
- **L1:** [Runtime ownership](../runtime-ownership.md), [PiSessions](../../server/PiSessions.ts), [SessionHosts](../../server/SessionHosts.ts), [PiTransport](../../server/PiTransport.ts), [Worktrees](../../server/Worktrees.ts).
- **L2:** [ADR 0001](../adr/0001-pi-rpc-workspace-workbench.md), [invariants](../development-invariants.md), [roadmap](../roadmap.md), [glossary](../glossary.md).

## Verification of this note

Documentation-only research on the exe.dev development VM. Review covers source pins, local links,
project identity, lifecycle evidence, current Piano ownership and proposed-vs-existing capabilities.
No application tests or browser run are required for these documentation changes. Source inspection
is not a benchmark, security audit or compatibility test of the candidate projects.
