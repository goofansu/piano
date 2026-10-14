# Herdr beneath Piano's remote execution

Research date: **2026-10-14**. This is an architectural assessment, not an implementation or an
accepted change to [ADR 0001](../adr/0001-pi-rpc-workspace-workbench.md).
The later [practical runner synthesis](2026-10-14-practical-remote-runners.md) adds GitHub source
evidence and refines the deployment recommendation: service-managed Piano backends first, Herdr optional.

## Conclusion

**Herdr is a credible machine and terminal execution layer for Piano. It is not currently a
replacement for Pi RPC or for the complete Piano worker proposed in the
[remote-execution research](2026-10-14-remote-task-execution.md).**

It already supplies saved SSH machines, approval-based remote setup, remote command routing,
persistent terminal processes, agent discovery/prompt/wait operations, and lifecycle observations.
Rebuilding these for a terminal-agent dashboard would waste useful existing capability. [H1–H5]

The choice is which product experience Piano wants:

1. **Dispatch tasks to terminal agents:** use Herdr directly. This offers the most immediate reuse,
   includes agents besides Pi, and lets humans attach to the same running terminal agent.
2. **Preserve Piano's structured Pi conversation interface:** keep a Piano worker owning Pi RPC.
   Herdr can supply machine discovery and host that worker in a persistent pane, but a separate
   structured worker connection is still needed today.
3. **Make Herdr the sole remote transport as well:** contribute a supported headless process or
   named-service bridge upstream. The reviewed public interface does not expose that capability.
   This is new work, not something its existing JSON API automatically provides. [H2–H4, S1–S3]

**Recommendation:** investigate a small Herdr adapter before building a second machine manager.
For existing Piano sessions, prefer option 2, but make the missing worker connection an explicit
feasibility gate. Do not replace Pi events with scraped terminal text simply to avoid that gap.
If the desired experience is primarily a task dashboard with terminal takeover, option 1 may be
the simpler and better product instead. The distinction is consequential, not cosmetic.

## Evidence and local inspection limits

- Piano inspected at `8642df388ca277724594f6e91607cc67cab4edde`, with Pi 1.2.0 from the preceding research.
- The public [Herdr documentation index](https://herdr.dev/llms.txt) identifies **0.9.4** as stable.
  Stable tag commit: `7e26bad94044eba205033111a0ce8033ede7e24f`.
- Source checkout inspected at `6521382dbed36f2d001417108149c338aee116ea` (October 14).
  Documentation was compared with `v0.9.4`; socket, persistence, agent-automation, plugin, and Pi
  integration evidence below is also present in that tag. The inspected main adds shared-SSH
  recovery refinements and CLI refactoring; those are not assumed installed locally.
- `command -v herdr` resolved `/home/exedev/.local/bin/herdr`.
- **Live capability inspection was blocked by the agent's Herdr safety rule:**
  `test "${HERDR_ENV:-}" = 1` failed. Therefore no Herdr command was executed, no server/socket
  was contacted, and no machine catalog, pane, agent, or private session state was read.
- Installed client version, running server version/capabilities, and saved machine profiles remain
  **unverified**. Presence on PATH does not establish compatibility with the documented release.
- That agent safety rule is not a Herdr product limitation: its docs explicitly allow saved-machine
  commands from scripts without an open TUI. A future Piano adapter can operate that way. [H2]
- No background research-agent tool was available. Research used first-party docs and source,
  without model calls, runtime experiments, installations, restarts, or remote mutations.

## 1. What Herdr already provides

| Capability | Documented contract | Piano consequence |
| --- | --- | --- |
| Saved machines | Opaque profile ID, label, SSH target, remote session, enabled flag; no passwords/private keys in the catalog. | Reference Herdr profiles rather than inventing another editable SSH catalog. [H1–H2] |
| Remote setup | `machine add` checks installation/server capabilities, can install/update with approval, and starts the chosen background server. Replacing a running server requires consent and stops pane processes. | Delegate operator setup; do not silently approve upgrades from Piano. [H1–H2] |
| Remote automation | `herdr --machine <profile-id> …` forwards supported JSON API requests through noninteractive SSH; no open TUI required. | Backend-side adapter is feasible; always specify the machine and explicit remote IDs. [H2] |
| Compatibility | Compatible versions need not be identical; supported methods/capabilities matter. Forwarding never installs/starts/restarts the remote server and does not fall back locally. | Separate connection/setup from ordinary actions; fail closed when unavailable. [H1–H2] |
| Persistent execution | Remote server owns terminals/processes; detach and connection loss leave them running. | Can provide network-independent process lifetime. [H1, H4] |
| Agent operations | Start a recognized agent in an available pane, prompt it, inspect/read/wait, send deliberate terminal keys. | Enough for task dispatch and terminal takeover, not full native agent protocols. [H5] |
| Events/snapshots | JSON socket subscriptions and `session.snapshot`; bounded, non-durable events. | Useful for machine/pane projections; not a durable task log. [H3] |
| Plugins | Manifest commands, actions, startup/event hooks, terminal panes; ordinary code, not sandboxed. | Package worker launch/setup workflows, but do not mistake plugin hooks for a daemon supervisor. [H6] |

### Profiles target sessions, not an entire physical machine

A saved profile selects **one Herdr server session**. A host can have several such sessions;
`machine list` is not a fleet-wide pane inventory. Aggregate explicit per-profile observations.
Two machines can both contain `w1:p1` and an agent named `reviewer`. [H1–H2]

Use profile ID rather than mutable label in stored references, while retaining separate verified
worker identity for structured Piano execution. A profile ID names a saved connection, not a
cryptographically verified physical machine or a globally unique Pi history store.
Deleting/recreating a profile must not silently reconnect old Piano sessions to unrelated work.
[Piano design requirement]

For hosted Piano, Herdr profiles and SSH credentials must be available to the **Piano backend's
OS user**. Profiles on a laptop do not automatically appear on this VM. Herdr does not copy local
configuration, executables, plugins, or secrets to remote hosts. [H1]

### Persistence has specific limits

Detach/reattach keeps live processes. A **Herdr server restart does not**: saved layout returns,
and eligible agents may reopen their own saved conversations. That does not resume interrupted
shell commands. Native Pi restore uses `pi --session <path-or-id>`. [H4]

Experimental opt-in live handoff can preserve supported processes during server replacement,
but may interrupt requests, waits, subscriptions, and sockets. Do not base ordinary recovery
promises on it, and do not blindly retry mutations after interruption. [H4, H2]

## 2. What is missing for Piano's existing Pi interface

### Herdr JSON is terminal control, not Pi JSONL

Herdr's socket vocabulary includes `agent.prompt`, `agent.read`, `pane.send_input`, and
`pane.read`. Agent prompts submit terminal text and Enter; reads return terminal snapshots.
The reviewed public methods/schema do not expose a general pipe-backed subprocess with
independent stdin/stdout/stderr, arbitrary service forwarding, or Pi RPC proxying. [H3, H5, S1]

The source's saved-machine API bridge connects to **Herdr's own JSON API**. Its internal
`SavedSshApiBridge` is not a published general-purpose tunnel to another Unix socket, and
Piano should not depend on temporary internal socket paths. [S2]

Therefore this is **not** a supported drop-in route:

```text
Piano PiTransport → Herdr agent.prompt/read → pi --mode rpc
```

A PTY can echo, wrap, and interpret bytes; screen reads are not an exact protocol stream.
Merely starting `pi --mode rpc` inside a pane does not connect Piano to its original pipes.
[P1, H3, H5; architectural inference]

### Pi's supplied Herdr integration deliberately skips RPC

`src/integration/assets/pi/herdr-agent-state.ts` checks `ctx.mode === "tui"` before activating.
The comment explicitly excludes RPC/JSON/print, noting that RPC also reports `hasUI=true`.
It reports state/session references for interactive Pi; it is not a Pi RPC server. [S3]

Even when semantic integrations are active, Herdr's lifecycle is coarser than Piano's:

- `idle` and `done` both mean ready for input; `done` includes whether completion has been seen.
- `blocked` describes a recognized approval/question interface, not a structured Pi dialog record.
- `agent prompt --wait` does not track a particular turn; an already-running turn can satisfy it.
- Prompt success means input was submitted, not that this task was accepted or verified.
- `agent read` returns rendered text; alternate-screen history may be incomplete and may require
  an idle agent and viewport scrolling. [H5]

Piano cannot derive authoritative message blocks, tool results, dialog IDs, prompt dispositions,
usage, queue state, or session-tree operations reliably from that surface alone. Pi-native
history could supplement completed transcript reads, but remote history retrieval and live
structured control would still need implementation. [H3, H5, P1; assessment]

### Event consistency is a separate contract

Herdr documents **no shared sequence boundary between snapshots and events**. Events should
invalidate cached state and trigger authoritative reads, not be blindly replayed over snapshots.
Slow subscribers get `events_lost` and must resubscribe/reconcile; history is not durable. [H3]

Use this for Herdr inventory. Preserve Piano's own generation/snapshot/event rules for Pi sessions
(INV-05); do not treat a Herdr agent-status event as a replacement Pi event. [L1]

## 3. Approaches

### A. Piano as a web task dashboard over native Herdr agents

```text
Piano → Herdr saved-machine commands → remote Herdr → Pi/Claude/Codex TUI
```

Reuse discovery, layouts, persistent panes, prompt/wait, and terminal reads. A human can attach
through Herdr to the **same process**, rather than reopening its session in a second writer.
No additional Piano worker is required for basic terminal-agent dispatch. [H1–H5; proposal]

Best fit: machine/agent/task list, submit work, show coarse status and recent output, open the
terminal for interactive approvals. Supporting multiple coding agents becomes practical.

Cost: it is a different execution interface from current Piano. Structured transcript rendering,
images, precise dialogs, steering/follow-up queues, history, diffs, and usage need separate
capability work or explicit limitations. Do not pretend terminal output is authoritative history.
Browser terminal embedding is also extra work: terminal-read methods are not a ready-made web
terminal streaming client. Keep external agents visibly distinct from native Piano Pi sessions.

**Assessment:** the smallest useful Herdr-first product, but not a transparent backend swap.

### B. Herdr hosts a Piano worker; the worker keeps ordinary Pi RPC

Separate the lifecycle and data connections:

```text
Lifecycle:
Piano → Herdr --machine → remote Herdr → persistent pane running Piano worker

Structured session data:
Piano ↔ authenticated worker connection ↔ Piano worker → pipes → Pi RPC
```

Herdr provides saved machines, operator setup, pane lifetime, logs, and a terminal escape hatch.
The worker continues to own Pi pipes, history access, Git/Worktrunk, and workspace operations.
Pi protocol handling remains behind `PiSessions`. [proposal based on H1–H6, L1]

**The second connection is not provided by today's generic Herdr forwarding interface.** Choose
one explicitly: SSH-forward a protected worker socket using the selected host, or let the worker
open an authenticated outbound connection to Piano. Do not draw a single arrow through Herdr
and silently assume arbitrary worker data can travel on its JSON API. [H2–H3, S1–S2]

Running the worker as a foreground pane process can survive Herdr-client detach. It is not
automatic restart supervision, and Herdr server restart destroys that execution lifetime.
A plugin action may launch/locate that pane; a startup hook can reconcile it once, but hooks
are one-shot initialization, **not supervised daemons**. The worker must enforce a singleton
per execution environment before opening existing Pi history. [H4, H6; design requirements]

Herdr's TUI-only Pi integration will not report these RPC children automatically. Initially show
the worker/log pane as an ordinary process and use Piano for individual session state. If per-Pi
Herdr visibility is desired, design explicit mirrored metadata rather than launch a duplicate TUI
against each live session. [S3, L1]

**Assessment:** best fit for preserving Piano, provided Herdr's operational reuse justifies the
additional connection. If it adds little beyond a hidden pane, a systemd-managed worker remains
simpler. Measure the real benefit instead of forcing Herdr into every layer.

### C. A Piano Herdr plugin as packaging and orchestration

A plugin can declare launch/check actions and a worker/log pane, carry machine-local configuration,
and reconcile state at startup. Commands execute on the remote installation, so install the plugin
there explicitly. This complements B; it does not remove its worker protocol. [H1, H6]

`plugin.action.invoke` returns invocation context and a started command log record, not an
arbitrary continuously streaming response. Logs and startup hooks are not a substitute for Pi RPC.
Avoid encoding prompts/results into plugin metadata or repeatedly polling command logs as a new
accidental protocol. Plugin state belongs to the plugin, not Herdr-managed durable job storage.
[H3, H6]

**Assessment:** useful delivery mechanism after proving B, not a hidden shortcut around it.

### D. Extend Herdr with a supported headless/service interface

An upstream proposal could expose an allowlisted named worker socket, or a headless process
interface with pipe I/O, exit events, attachment ownership, reconnect semantics, and bounded
backpressure. The existing SSH/profile infrastructure could then carry Piano's worker traffic
without a separately managed connection. [proposal, not shipped functionality]

Prefer a narrow, capability-negotiated interface over importing internal Rust modules, copying
SSH implementation code, or depending on Herdr's UI binary protocol. The worker must still own
Pi's pipes while callers detach; a raw SSH byte bridge alone does not provide that lifetime.
Specify who can attach/control, whether processes outlive the connection, how exits are reported,
and how uncertain submissions are reconciled before implementing it.

**Assessment:** cleanest route if one shared remote runtime is a long-term goal, but requires
upstream agreement and maintenance. Do not gate a small dispatch experiment on a speculative
cross-agent execution platform.

## 4. Ownership and product guardrails

- **Herdr owns:** its SSH profiles and connections, terminal layout/processes, native-agent
  detection and terminal-agent control. Treat observed inventory as a projection.
- **Pi owns:** session history, tools, prompts, and exact agent semantics for structured sessions.
- **Piano owns:** workspace/session selection, cross-machine project grouping, authorization,
  and task/evidence/integration policy. A terminal's `done` badge is not task acceptance.
- **Git owns repository facts; Worktrunk remains the lifecycle adapter.** Herdr worktree methods
  have their own Git semantics (including removal without branch deletion). Do not mix two
  independent lifecycle owners. Use Worktrunk on the selected machine, then open/associate the
  resulting directory in Herdr. Replacing Worktrunk would be a separate decision. [H3, L1]
- **Names stay distinct:** a Herdr session is a server with terminals, not a Pi conversation;
  a Herdr workspace is a terminal grouping, not automatically a Piano workspace. Pane IDs can
  change when moved and agent aliases belong to the current occupant. Keep external handles
  behind the adapter, with machine/session qualification. [H1–H2, H5, L1]
- **Never have two writers:** a native Herdr Pi TUI session must not also be opened as a new live
  Pi RPC process by Piano. Attach to one owner, or require explicit stop/handoff. [L1]
- **Security remains Piano's responsibility.** Herdr/plugins execute with the OS user's powers,
  not a sandbox. A browser route must not expose arbitrary Herdr control or `server stop`.
  Authorize machine/action access, preserve host-key checks and explicit setup approval, and
  avoid default agent forwarding. A hosted backend's SSH authority can also be reachable to an
  unrestricted agent running under the same OS identity. [H1–H2, H6, L1]

This changes ADR 0001's current “Herdr remains an optional sibling” direction if adopted as a
required runtime. A new ADR should cover **INV-01/02/04/05/06/07/11/12**, including ownership,
dialogs, reconnect, worktrees, machine identity, authorization, and version compatibility. This
research does not supersede that decision or the roadmap's security gate. [L1]

## 5. Smallest useful next investigation

**Claim to test:** Herdr can supply selected-machine routing and detached execution without
replacing Pi's authoritative protocol or targeting the wrong session (INV-01/02/05/07/12).

First, from a legitimate Herdr-managed research session, read installed help/version, server
status, and `machine list --json`; verify support on each selected machine. Do not set a fake
`HERDR_ENV`, inspect the user's focused session from outside, auto-update servers, or enroll hosts
without permission. Recheck the installed interface rather than relying on these source examples.

Then, only with an explicitly authorized scratch topology:

1. Use one throwaway remote folder and dedicated Herdr session/pane, not an existing user's agent.
2. For A, dispatch a bounded task and observe submission, blocked/settled state, terminal takeover,
   disconnect, and reconnect. Confirm what history is actually available.
3. For B, start a scratch Piano worker in the dedicated pane, connect over the chosen structured
   transport, and run a fake-Pi session. Drop the controller connection: one child remains and
   stdout continues draining. Reconnect without resubmitting the prompt.
4. Verify identical-looking pane IDs on different machines cannot redirect actions; duplicate
   worker startup fails; a killed process is not presented as a continuing session.
5. Measure startup latency and the cost of repeated `--machine` CLI calls. Use CLI JSON initially;
   consider a supported persistent protocol client only if measured overhead justifies it.

Stop once the chosen experience is proved or a missing interface is established. A real model
smoke test, if later needed, should request only `Reply with exactly: X` and read it back. No
scratch topology, task dispatch, or failure experiment was run for this research.

## Sources

Herdr documentation citations are pinned to **v0.9.4**:

- **H1:** [Connecting machines](https://github.com/herdrdev/herdr/blob/v0.9.4/docs/next/website/src/content/docs/connecting-machines.mdx).
- **H2:** [CLI reference, saved SSH machines](https://github.com/herdrdev/herdr/blob/v0.9.4/docs/next/website/src/content/docs/cli-reference.mdx).
- **H3:** [Socket API: methods, plugins, events, worktrees](https://github.com/herdrdev/herdr/blob/v0.9.4/docs/next/website/src/content/docs/socket-api.mdx).
- **H4:** [Session state and restore](https://github.com/herdrdev/herdr/blob/v0.9.4/docs/next/website/src/content/docs/session-state.mdx) and [persistence/remote access](https://github.com/herdrdev/herdr/blob/v0.9.4/docs/next/website/src/content/docs/persistence-remote.mdx).
- **H5:** [Agent automation and lifecycle semantics](https://github.com/herdrdev/herdr/blob/v0.9.4/docs/next/website/src/content/docs/agent-automation.mdx).
- **H6:** [Plugins, startup hooks, execution and security](https://github.com/herdrdev/herdr/blob/v0.9.4/docs/next/website/src/content/docs/plugins.mdx).
- **S1:** [Inspected request schema/method catalog](https://github.com/herdrdev/herdr/blob/6521382dbed36f2d001417108149c338aee116ea/src/api/schema.rs).
- **S2:** [Saved-machine API bridge](https://github.com/herdrdev/herdr/blob/6521382dbed36f2d001417108149c338aee116ea/src/remote/saved.rs) and [remote command construction](https://github.com/herdrdev/herdr/blob/6521382dbed36f2d001417108149c338aee116ea/src/remote/attach.rs).
- **S3:** [Pi integration's TUI-only gate](https://github.com/herdrdev/herdr/blob/v0.9.4/src/integration/assets/pi/herdr-agent-state.ts#L229-L235).
- **P1:** [Pi 1.2.0 RPC](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/rpc.md) and [commands](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/rpc-commands.md).
- **L1:** [Piano ADR](../adr/0001-pi-rpc-workspace-workbench.md), [invariants](../development-invariants.md), [glossary](../glossary.md), [roadmap](../roadmap.md), [PiSessions](../../server/PiSessions.ts), [PiTransport](../../server/PiTransport.ts), [Worktrees](../../server/Worktrees.ts).

## Verification

Documentation-only review on this exe.dev VM. Checked relative links, source paths, stable/main
qualification, and the separation between documented contracts and proposals. No runtime tests,
model calls, browser journeys, or live Herdr validation; installed capabilities remain a stated gap.
