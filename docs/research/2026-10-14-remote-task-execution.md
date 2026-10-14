# Dispatching work to remote machines through Piano

Researched **2026-10-14**. Recommendation only: no remote-execution feature, installation,
deployment, or security ADR is introduced by this note.

## Conclusion

**Use SSH to connect to a persistent Piano worker, not as the lifetime owner of a Pi session.**
Run normal Pi RPC, Git, Worktrunk, and workspace operations on the selected machine. Keep one
Piano browser interface that selects the machine and folder before starting a session.

Pi RPC does **not** have a native SSH transport or an SSH host option in its exported client.
It is JSONL over stdin/stdout, so Piano can carry that protocol through an SSH subprocess.
That is technically straightforward, but disconnect recovery and the rest of the workspace
interface require more than substituting `ssh` for the Pi launcher. [P1–P4, L1–L3]

There is an important third option: Pi ships an **SSH extension example** that leaves Pi local
and redirects selected tools to the remote machine. That is not RPC-over-SSH and does not move
Pi's history, configuration, or all extension execution to that machine. [P3]

Current primary sources show two relevant product patterns:

- **Codex and Claude Desktop:** select an SSH host, run the coding agent remotely, operate it
  through a local graphical client. Claude explicitly documents a remote background helper.
- **Amp and HumanLayer:** run a persistent runner/daemon on your own host and dispatch work
  through the vendor's web interface. SSH can provision the host but is not the documented
  user-facing session transport. [C1, A1, M1, H1–H2]

This generalizes the [October 7 exe.dev research](2026-10-07-remote-exe-machines.md): that note
prefers exe.dev peer HTTPS for exe.dev-only connections; **SSH is the initial generic-server
choice here**. The persistent worker recommendation is unchanged. Neither note is an accepted
implementation decision.

## Scope and evidence

- Piano source: `d19168cebb32645fd15ab1ed8874cddd8c2f0226`; installed/locked Pi **1.2.0**.
- Pi source: `3daa20280f6a7c7cbe0935680c9a38fdc3863005`. The inspected RPC documentation,
  client implementation, and SSH example have no diff from `v1.2.0`; citations use that tag.
- Codex source cross-check: `ca2b076fffbc24ad5fa57258ece8a8277b326138`.
- Product behavior below is **documented behavior, not a hands-on compatibility test**. Live
  vendor pages can change independently of installed versions and feature rollouts.
- Reviewed local source, installed Pi docs, first-party web docs, and upstream source. No
  background research-agent tool was available, so research was performed directly.
- No model calls, real-machine enrollment, production database access, or SSH execution tests.

## 1. What Pi supports

### A. Run Pi remotely, carry RPC over SSH

Illustrative command, **not executed**:

```sh
ssh -T -o BatchMode=yes devbox 'cd /srv/repo && exec pi --mode rpc'
```

Piano would keep this process's stdin open, send JSONL commands, and continuously read JSONL
responses/events from stdout. Diagnostics must remain on stderr. Do not allocate a PTY: this
is structured I/O, not terminal automation. The host and path above are trusted placeholders;
a product must validate destinations and safely encode remote commands rather than interpolate
user-provided paths into a shell string. [P1; implementation recommendation]

**Why it works:** RPC requires bidirectional byte streams, not local shared memory. Normal CLI
options still select sessions/resources; running the CLI on the remote host makes cwd, tool
execution, credentials, settings, and session files remote. The exported `RpcClient` itself
calls local `spawn("node", [cliPath, ...])`; its options have no SSH host or external transport.
Piano already has its own adapter, so adopting `RpcClient` is unnecessary. [P1–P2, P4, L1]

**Why it is not enough:**

- Pi closes down when stdin ends. A lost SSH connection can therefore end the process;
  RPC has no documented reconnect/attach listener for that existing process. [P1, P5]
- A stalled reader can block stdout and stall Pi. `nohup` alone does not provide a persistent
  RPC reader, command broker, or reattachment protocol. [P1; architectural inference]
- RPC request IDs correlate replies; they are not a documented durable idempotency contract.
  After an uncertain write, reconnect must not blindly resend the prompt. [P1, L4]
- `--session` restores conversation history, not the execution state of a killed shell command.
  Network disconnection, actual process exit, and conversation resume must remain distinct.
  [P4–P5, L4]

Suitable for a small transport experiment or explicitly connection-bound sessions, not the
promised “dispatch work, leave, return later” experience.

### B. Keep Pi local, send tool operations over SSH

Upstream's `examples/extensions/ssh.ts` adds `--ssh` **when that extension is loaded**:

```sh
pi -e ./ssh.ts --ssh user@host:/remote/path
```

It replaces `read`, `write`, `edit`, and `bash` operations, handles user bash, and changes the
cwd wording in the system prompt. It requires key-based SSH authentication and remote bash.
It does not make `--ssh` a built-in CLI/RPC option. [P3]

This is attractive when model credentials and history must stay local, or for a narrow remote
operations tool. It is a poor default for Piano's full remote workspace: resource discovery,
other tools/extensions/MCP, Git inspection, directory browsing, and history still need deliberate
placement. Audit the example before production use, especially shell quoting, path mapping,
per-operation SSH overhead, and whether cancellation actually stops remote descendants.
A local SSH-client exit is not proof that a remote command stopped. [P3; assessment]

### C. Persistent remote worker around ordinary RPC — recommended

A remote Piano worker owns the Pi processes and their pipes independently of any controller
connection. SSH reaches that worker via a protected socket or loopback tunnel. The worker can
keep draining Pi stdout, retain current session state, and serve a fresh snapshot on reconnect.
This is proposed Piano functionality, **not a mode Pi RPC already provides**. [P1, L1–L4]

A worker surviving a tunnel drop is also **not** crash-safe agent execution. If the worker/Pi
or machine dies, restore saved history and report interruption. Pi Durable is a separate runtime
choice, not required to support SSH; the [Durable assessment](2026-10-11-pi-durable-adoption.md)
records the compatibility and adoption gate.

## 2. What the other products do

| Product | Your own machine? | Documented approach | Important boundary |
| --- | --- | --- | --- |
| **Codex** | Yes, SSH hosts | Desktop discovers SSH config aliases, starts remote Codex app-server, and operates on remote files/shell. | Remote Codex must be installed and authenticated. Managed cloud execution is separate. [C1–C2] |
| **Claude Code** | Yes, SSH hosts or a machine running Remote Control | Desktop SSH runs Claude remotely; Remote Control connects web/mobile through Anthropic to a running host process. | These are different connection paths, neither synonymous with managed cloud sessions. [A1–A2] |
| **Amp** | Yes, runners | `amp --no-tui --runner-id devbox`; web or CLI creates threads on the runner. | Runner uses your machine; an Orb is an Amp-provisioned machine per thread. [M1–M2] |
| **HumanLayer** | Yes, remote daemons | `humanlayer login`, then `humanlayer daemon launch`; web dispatches to the selected daemon. | Agent work runs on the host; API/sync services coordinate requests/events. Supervise the daemon separately. [H1–H2] |

### Codex: SSH-connected app server

The current remote-connections guide says to add an alias to `~/.ssh/config`, verify ordinary
SSH, install/authenticate Codex remotely, and enable that host in the desktop app. The app
starts remote app-server through SSH using the remote user's login shell. `codex` must be on
that shell's PATH. Remote chats read/write files and run commands on that host. [C1]

The app-server protocol is bidirectional JSON-RPC with stdio, WebSocket, and Unix-socket
transports. The developer docs also demonstrate a remote TUI connecting to a WebSocket
listener. They label the WebSocket transport experimental/unsupported and warn against
unauthenticated network exposure; localhost plus SSH forwarding is an explicit use case.
**Do not infer that the desktop SSH feature uses the exact WebSocket example internally.**
The product guide establishes SSH-managed app-server, not its complete private topology. [C1–C3]

Codex also documents explicit chat/Git-state handoff between matching saved projects on hosts:
create/reuse a destination worktree, transfer history/Git state, and interrupt an active response
before transfer. This is additional functionality, not something Piano gets from SSH or session
IDs automatically. The reviewed guide does not establish an unconditional guarantee that every
SSH task survives client loss; verify that separately rather than infer it from transport support.
[C1]

**Lesson for Piano:** remote workspace operations belong next to the agent, behind a structured
server interface. Defer cross-machine handoff until explicit dispatch works reliably.

### Claude Code: two distinct remote-control models

**Desktop SSH:** the desktop environment picker accepts a host, remote directory, and optional
port/key. It automatically installs Claude Code remotely. Current docs describe use of the local
OpenSSH client on macOS/Linux, including SSH config aliases, `ProxyJump`, and `ProxyCommand`.
The remote machine must meet OS/architecture, shell, SFTP, execution, and network requirements.
[A1]

Crucially, the current docs say a **background helper on the remote machine** lets work continue
when Desktop sleeps, disconnects, or quits (Desktop v2.31226.0+). This is not just one SSH-bound
CLI process. Limitations include credential expiry, host reboot/process cleanup, pending user
input, and bounded output retention (16 MiB of recent output per session). Reopening saved
history after a process dies is different from reconnecting to the same live process. [A1]

**Remote Control:** `claude remote-control` registers a host-side process with Anthropic and polls
for work using outbound HTTPS, with no inbound port. Browser/mobile messages route through
Anthropic; execution and filesystem access stay on the host. The transcript is also stored on
Anthropic's servers. The process must stay alive; the docs recommend tmux/screen when launching
from an SSH terminal. Server mode can create multiple sessions, including worktree isolation;
eligibility requires a supported subscription, not API-key auth. Outage handling differs by
mode, so it is not an unlimited offline/durability guarantee. [A2]

**Lesson for Piano:** SSH onboarding and persistent execution are complementary. A vendor relay
is useful for reachability but not necessary for the initial trusted-owner SSH design.

### Amp: user-owned runners versus managed Orbs

Start a runner in a directory with `amp --no-tui --runner-id devbox`. It accepts remotely created
threads from ampcode.com. The documented CLI dispatch equivalent is:

```sh
amp -x "Run the tests and fix any failures" --executor runner:devbox
```

Runners can serve multiple explicit/discovered directories and create worktrees remotely.
Terminal access is separately enabled with `--remote-control-terminal`. Runners remain
available while the process and host are running; Amp does not provision, pause, or wake that
machine. Orbs are the separately managed per-thread machine product. [M1]

Cross-Client Access also allows the web UI to continue existing CLI threads. Workspace policy
can disable it and remote runner creation. The reviewed runner docs do **not** specify the
precise relay wire transport or promise arbitrary crash recovery; do not invent those details.
[M1–M2]

Security lesson: the docs explicitly warn that a shared runner executes as its launching OS
user, exposing that user's files and credentials. Advertised directory selection is not a
filesystem sandbox: `--no-serve-cwd` changes the picker, not which requests are accepted. [M1]

**Lesson for Piano:** a machine/directory picker plus remote session start delivers the core
value without first implementing a scheduler or automatic server provisioning.

### HumanLayer: daemon + hosted coordination

Here “HumanLayer” means its current coding-agent product, not merely its historical
human-approval SDK. Current first-party docs explicitly support remote daemons running Claude
or Codex on cloud VMs, workstations, and private-network machines, controlled from
app.humanlayer.com without the native app. The API delivers work and streams daemon events.
The daemon needs outbound HTTPS to HumanLayer API and sync services. [H1–H2]

Interactive `humanlayer login` saves refreshable credentials; `humanlayer daemon launch` starts
the process. A launch token instead bootstraps credentials for **one process** and is not a
restart-persistent login. The guide supplies a systemd user-service setup and explicitly says
the launch command does not create a managed background service. [H1–H2]

Host identity and persistence are part of the contract: retain the daemon's host ID, credentials,
and relevant agent history. Current docs say an unresponsive host for roughly two minutes
while work is running or awaiting tool approval causes the session to be marked failed; a new
message can continue it once the host returns. This is not an exactly-once job queue or seamless
host-crash continuation claim. [H2]

**Lesson for Piano:** enrollment, supervision, stable host identity, and offline semantics matter
as much as carrying prompts. Keep Piano self-hosted rather than copy the vendor-cloud dependency.

## 3. Piano implementation choices

These are design assessments, not existing Piano capabilities.

| Approach | Benefit | Cost/limitation | Verdict |
| --- | --- | --- | --- |
| Separate Piano installation per server, reached privately/tunneled | Reuses existing local execution model | Separate URLs; no unified dispatch | Lowest-change way to use remote machines today |
| Direct SSH → `pi --mode rpc` | Smallest protocol experiment | Connection-bound pipes; missing remote workspace/history APIs | Prototype only |
| Local Pi + SSH tools | Keep Pi credentials/history central | Split execution context and incomplete capability coverage | Specialized option, not default |
| SSH → persistent Piano worker | Own servers, existing SSH access, detached session ownership | Worker lifecycle/API, enrollment, identities | **Recommended first product path** |
| Worker initiates authenticated outbound HTTPS/WebSocket connection | Works behind NAT without controller-initiated SSH | Enrollment tokens, revocation, relay, distributed failure handling | Later, when inbound reachability is a real obstacle |
| Provision isolated VM/container per task | Repeatable environments and stronger isolation when correctly configured | Images, credentials, storage, cleanup, cost, scheduling | Separate later capability |

Recommended shape:

```text
Browser → Piano controller
             ├─ local execution
             └─ SSH connection/tunnel → persistent Piano worker on devbox
                                          ├─ SessionHosts → PiSessions → Pi RPC
                                          ├─ remote directories, Git and Worktrunk
                                          └─ remote Pi configuration and history
```

**The connection originates at the Piano backend, not the browser or automatically your laptop.**
For hosted Piano, SSH aliases, credentials, network routes, and jump hosts must be available to
that backend. A server reachable only from the laptop needs an explicit network route or a
future reverse-connecting worker. “Any server” means a supported, reachable host with the
runtime/toolchain and authorized credentials—not every SSH appliance. [design requirement]

### Why changing `PiTransport.spawn` alone is wrong

Today's launcher runs local Node + Pi with local cwd and inherited environment. `PIANO_PI_CLI`
is an entry-point path, not a shell command. History uses local `SessionManager`/filesystem
reads; ownership uses canonical checkout paths; directories, Git, Worktrunk, and trust are
also machine-local. Moving only the agent leaves Piano inspecting another filesystem. [L1–L3]

Put the remote boundary **above these machine-local services**. Preserve `PiSessions` and
`SessionAction`/`SessionEvent` as the Pi translation seam inside the worker. Do not expose raw
Pi protocol throughout React or turn the worker into an unrestricted shell RPC endpoint. [L4]

### Smallest useful first release

1. **One trusted owner, manually enrolled Linux host, existing SSH configuration.** Explicitly
   install/start a version-compatible worker under a service manager; do not install silently.
2. **Select machine → registered folder/worktree → start session.** No automatic repository
   clone/sync, session migration, offline submission queue, fleet scheduler, or multi-user sharing.
3. **Qualify all identities.** Persist a machine ID independent of its label/SSH alias; qualify
   workspace/session references, browser drafts, caches, images, and event cursors. Never run
   controller-side `realpath()` against remote paths.
4. **Keep authoritative state singular.** A worker can own machine-local folder/workspace/session
   references; the controller owns connections and cross-machine project membership. Remote
   listings are projections, not a second editable database. Pi still owns history; Git owns
   repository facts. The exact schema belongs in the implementation ADR.
5. **Keep execution independent of transport.** Worker owns child pipes and drains output while
   detached; reconnect fetches a snapshot then ordered events. A disconnected machine is unknown,
   not complete, failed, empty, or a reason to run locally.
6. **No automatic mutation resend.** Lost acknowledgement means uncertain delivery. Add stable
   admission IDs and reconciliation if retry becomes necessary; ordinary Pi request IDs do not
   close the worker→Pi write/acknowledgement crash gap.
7. **Retain machine-local setup.** Probe models/auth, project trust, skills, MCP and tools on the
   selected host. Prefer remote credential setup over copying the controller's whole environment.
   File uploads/artifacts need explicit transfer; previews need authenticated routing and separate
   origins, or must be clearly unsupported in the first slice.

Affected invariants: **INV-01** ownership; **INV-02–05** child/dialog/reconnect semantics;
**INV-06–09** worktrees, workspace identity, revision/environment provenance; **INV-11** trust;
**INV-12** version compatibility. A task's agent settling is not task acceptance. [L4]

### Security and recovery gates

Write the remote/security ADR before shipping. Use verified host keys, explicit destination
approval, least-privilege remote accounts, and no default SSH-agent forwarding. Protect worker
access using an OS-restricted socket or authenticated loopback API plus the tunnel; a loopback
TCP listener alone is not protection from other users/processes. Never expose today's
unauthenticated Piano router as a public worker API. The controller's SSH authority is valuable:
an unrestricted agent running on the same controller can potentially use that authority too.
For stronger isolation, separate control credentials from agent/preview workloads. [L4; proposal]

Before claiming the first slice works, observe these checks on throwaway machines/workspaces:

- Same absolute path on two hosts: prompt, history, Git diff, and worktree creation all affect
  only the selected host. Keep paths out of HTTP URLs; use machine/workspace IDs.
- Drop SSH and restart the controller during a fake-Pi run: one remote child, no duplicate
  prompt, output still drained, consistent snapshot after reconnect.
- Lose acknowledgement after admission: report uncertainty; do not resubmit automatically.
- Two tabs answer a dialog, abort races the answer, and an offline dialog times out: one terminal
  resolution, no stuck Pi and no duplicate answer.
- Kill Pi/worker or reboot the host: explicit interruption, no claim of resumed shell execution.
- Wrong host key, duplicate worker, revoked credential, version mismatch, and denied folder:
  fail closed; never silently fall back to local execution.
- Slow observer and large tool output: bounded buffering without stopping the Pi stdout reader.

These are **proposed acceptance checks**, not tests run for this research.

## Sources

### Pi

- **P1:** [Pi 1.2.0 RPC protocol](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/rpc.md).
- **P2:** [Pi 1.2.0 RpcClient source/options](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/src/modes/rpc/rpc-client.ts).
- **P3:** [Pi 1.2.0 SSH tool-extension example](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/examples/extensions/ssh.ts).
- **P4:** [Pi 1.2.0 CLI](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/cli.md) and [RPC commands](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/rpc-commands.md).
- **P5:** [Pi RPC process lifecycle/source](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/src/modes/rpc/rpc-mode.ts).

### Product documentation

OpenAI's previous developer-doc URLs redirected to the current `learn.chatgpt.com` documentation;
these are the actual pages reviewed, not claims about older Codex releases.

- **C1:** [Codex remote connections and SSH hosts](https://learn.chatgpt.com/docs/remote-connections).
- **C2:** [Codex App Server](https://learn.chatgpt.com/docs/app-server).
- **C3:** [Pinned Codex transport implementation](https://github.com/openai/codex/blob/ca2b076fffbc24ad5fa57258ece8a8277b326138/codex-rs/app-server-transport/src/transport/mod.rs).
- **A1:** [Claude Desktop SSH sessions, helper lifecycle, and limitations](https://code.claude.com/docs/en/desktop#ssh-sessions).
- **A2:** [Claude Code Remote Control](https://code.claude.com/docs/en/remote-control).
- **M1:** [Amp runners](https://ampcode.com/docs/cli/runners).
- **M2:** [Amp Cross-Client Access](https://ampcode.com/docs/cli/remote-control).
- **H1:** [HumanLayer remote-daemon setup](https://docs.humanlayer.com/guide/remote-daemons).
- **H2:** [HumanLayer remote-daemon architecture, security, and persistence](https://docs.humanlayer.com/explanation/remote-daemons).

### Piano (at the inspected revision)

- **L1:** [PiTransport](../../server/PiTransport.ts), [PiCli](../../server/PiCli.ts), [PiSessions](../../server/PiSessions.ts).
- **L2:** [PiHistory](../../server/PiHistory.ts), [SessionReferences](../../server/SessionReferences.ts), [SessionHosts](../../server/SessionHosts.ts).
- **L3:** [Directories](../../server/Directories.ts), [Worktrees](../../server/Worktrees.ts), [ProjectTrust](../../server/ProjectTrust.ts), [Registry](../../server/Registry.ts).
- **L4:** [ADR 0001](../adr/0001-pi-rpc-workspace-workbench.md), [invariants](../development-invariants.md), [roadmap](../roadmap.md), [glossary](../glossary.md).

## Verification of this note

Documentation-only. Reviewed citations, local links, source versions, current Piano process/history
boundaries, and the distinction between vendor documentation, architectural inference, and proposed
behavior. No app run, typecheck, or runtime test suite is needed for this note; none of the remote
execution or failure scenarios above has been demonstrated by this research.
