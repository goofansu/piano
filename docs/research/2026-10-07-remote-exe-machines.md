# Connecting exe.dev machines to Piano

Researched **2026-10-07** against Piano `53d93d03e2a54c69c269cdd8fd12baea7ddd2240`,
locked/installed **Pi 1.0.2**, and current first-party exe.dev documentation.
This is a recommendation, **not an implemented feature or an accepted security ADR**.
No other VM, production registry, running backend, or user session was accessed or changed.

## Recommendation

**One Piano UI/control plane, with a persistent Piano worker on each connected machine.**
Keep Pi, its configuration/history, Git, and Worktrunk on the machine containing the project.
Connect the control plane to workers using exe.dev's **VM-to-VM peer integration**, subject to a
small transport/security feasibility check. Use SSH tunneling to the same worker as the fallback,
not SSH-launched Pi as the long-term execution model. [E1–E4, P1, L1–L5]

The peer hostname is for the **controller VM**, not the browser: integrations are available to
attached VMs. A controller outside exe.dev would instead need SSH or direct authenticated HTTPS.
The browser talks only to Piano's own origin. [E2, E8]

```text
Browser
  │ private authenticated HTTP/WebSocket access
  ▼
Piano control plane (machine connections, authorization, aggregated UI)
  ├── local execution adapter → existing local Piano modules
  ├── peer HTTPS → worker on VM A → SessionHosts → PiSessions → pi --mode rpc
  └── peer HTTPS → worker on VM B → SessionHosts → PiSessions → pi --mode rpc
                     │
                     └── machine-local projects, Git/wt, Pi history/resources, captures
```

Start with **one trusted owner connecting existing machines**, explicit enrollment, and manual
worker installation. Do not bundle automatic VM creation, multi-user execution, transparent file
sync, live-session migration, or scheduling into the first version. Selecting a machine chooses
where a session and its files live; it does not move an existing session or checkout.

Today, separate Piano installations with separate browser URLs are the low-change alternative.
A unified UI requires implementation: there is no current machine selector or remote worker
transport. The current `SessionHosts` name refers to **Pi process ownership**, not a fleet of
machines. [L1–L4]

Affected contracts: **INV-01** (authoritative stores), **INV-02–05** (ownership, outcomes,
dialogs, reconnect), **INV-06–09** (machine-local workspaces and evidence), **INV-11–12**
(authorization/isolation and compatibility). Write the security/isolation ADR before exposing a
worker or broadening access; this research does not supersede ADR 0001. [L6]

## What exe.dev provides

| Documented fact | Consequence for Piano |
| --- | --- |
| VMs, even in one account, do not share an implicit private network. SSH and Tailscale are documented alternatives. [E1] | Another VM's private IP is not an enrollment mechanism. |
| A peer integration proxies to a target VM's HTTPS endpoint using an automatically generated, target-VM-scoped key held by exe.dev. Neither VM receives that key. [E2] | Prefer platform-mediated machine authentication over copying SSH keys or bearer tokens onto every machine. |
| The target receives `X-Exedev-Source-Vm`. exe.dev strips caller-supplied values and verifies a short-lived, target-bound attestation before delivering the header. It identifies a VM, not a person or process. [E2] | An authenticated worker can allowlist the controller VM, but everyone able to run code on that controller has that machine's authority. |
| Peer integrations can target a VM the owner can access, optionally with a port. Deleting the integration removes its generated key. [E2] | Enrollment need not make workers public. Cross-account/team access still needs explicit access and validation. |
| Private HTTPS access is the default; alternate ports 3000–9999 are also proxied and require VM access. [E3] | Loopback binding alone does not prevent an authenticated VM collaborator reaching a control port through the platform. Enforce worker authorization on every exposed route. |
| `/exec` supports remote commands but has no stdin or PTY, a 30-second timeout, and combines stdout/stderr. [E4] | Useful for bounded provisioning checks, **not** Pi's long-lived bidirectional JSONL transport. Do not apply these `/exec` limits to the separate peer HTTP proxy without evidence. |
| VM HTTPS tokens use a VM-specific namespace; `X-Exedev-Authorization: Bearer …` is the preferred header. The proxy consumes it and can pass signed token `ctx` to the app. [E5] | A viable fallback for direct HTTPS, but tokens belong only on the server, with expiry/revocation and application authorization—not in the browser or registry JSON. |
| Reflection lists metadata and attached integrations, not the whole account's fleet. `ssh exe.dev ls --json` supplies VM inventory and ready-to-use `ssh_dest`. [E6, E7] | Manual enrollment first. Later discovery should offer candidates, not silently authorize them. Do not derive SSH destinations from VM names when inventory supplies them. |

**Important unresolved point:** the peer documentation promises HTTP(S) forwarding but does not
establish WebSocket upgrade behavior, idle limits, SSE flushing, maximum bodies, or connection
revocation behavior. Ordinary exe.dev browser WebSocket usage is not proof that the *peer
integration* has identical behavior. Verify these before picking the worker event transport. [E2, E3]

## Transport choices

| Option | Assessment |
| --- | --- |
| **Peer HTTPS → persistent worker** | Preferred exe.dev-native direction: no VM-held peer secret, platform-vouched caller VM, no fleet-wide SSH key. Test WebSocket/SSE; bounded HTTP observation is a viable simpler experiment. |
| **SSH tunnel → persistent worker** | Good fallback and generic-machine direction. Worker/Pi survive tunnel loss. Use verified host keys, noninteractive dedicated credentials and bounded reconnect; avoid permanent forwarding of a personal SSH agent. Exe.dev documents VM-to-VM SSH, but this exact tunnel topology still needs testing. [E1, E7] |
| **Direct VM HTTPS token → persistent worker** | Also viable; more token lifecycle work. The token is VM-scoped, not inherently project- or action-scoped. [E5] |
| **`ssh -T … 'cd … && exec pi --mode rpc'`** | Possible transport experiment, not the product design. Network loss can close Pi stdin, which requests shutdown; there is no persistent remote owner to reattach to. It also leaves directory browsing, history, Git, trust and images unresolved. [P1, L1–L5] |
| **exe.dev `/exec` → Pi RPC** | Reject for ongoing sessions: no interactive stdin, mixed output and bounded command lifetime. [E4, P1] |
| **Tailscale** | Reasonable if already deployed or non-exe machines become important; adds another network/identity dependency and does not replace worker authorization or lifecycle handling. [E1] |
| **Embed Pi SDK centrally / remote-shell tools only** | Not necessary. Remote shell tools alone leave Pi configuration/history and other capabilities on the controller; this is not the same as running Pi on the selected machine. Preserve the accepted RPC process seam. [P1–P3, L6] |

Do not build all transports now. Prove peer HTTPS first; select one supported transport behind a
small execution-machine interface. If peer WebSockets work, reusing Piano's event vocabulary is
attractive. If they do not, test bounded HTTP snapshots/polling or fall back to an SSH tunnel.
A poll is an observation, never an implicit prompt retry. SSE/long polling also require their own
buffering/timeout check; they are not automatically safe substitutes.

## Why this is more than changing the Pi launcher

The source audit finds these machine-local assumptions:

- **Pi process:** `PiSessions.spawnChild()` invokes local Node + CLI with local `cwd` and inherited
  environment. `PiCli`'s override is a **JavaScript entry path**, not a remote command string.
  Changing `PIANO_PI_CLI` to an SSH command is not supported. [L1]
- **Execution ownership/history:** `SessionHosts` canonicalizes checkout paths with local
  `realpath`, owns child scopes/locks, reads Pi session files and deletes them locally.
  `SessionFiles` uses Pi's `SessionManager`; it is not a network store. [L2]
- **Registry:** selected projects, worktrees, workspace IDs and session references contain local
  absolute paths. Adding a project checks the local filesystem. [L3]
- **Workspace operations:** directory listing/mkdir, Git discovery, Worktrunk creation, trust
  changes and revision captures run locally. Moving only Pi would inspect or mutate the wrong VM.
  Worktrunk creation currently requires **0.80.0**. [L4, L5]
- **Models and resources:** model catalogs are probed/cached per local cwd, and trust/settings
  use that machine's Pi environment. Available credentials/models can differ by worker. [L1, L5, P2]
- **Images and browser state:** image previews are a bounded process-local cache exposed through
  relative URLs. Session keys, drafts, catalogs and trust caches lack machine identity. [L3–L5]

The remote seam therefore belongs **above the machine-local execution modules**, not just inside
`spawnChild()`. A worker should reuse the existing `SessionHosts`, `PiSessions`, `Registry`,
`Catalog`, `Worktrees`, `ProjectTrust`, `SessionFiles` and `WorkspaceRevisions` implementations.
Keep every Pi-specific command/event conversion in `PiSessions`.

## Proposed ownership and interface

### One owner at each layer

For the smallest federation design:

- Each worker's **registry** owns that machine's explicitly selected projects, worktrees,
  workspace identities and session references. Pi owns its history there; Git owns repository
  facts there. Captures/evidence remain outside registry configuration.
- The controller stores machine connection identity, labels and access policy. Remote project
  lists are projections of worker registries, not a second editable copy of them. Mutations go
  to the owning worker. The existing controller registry can continue owning local selections.
- The browser holds projections and unsent drafts. No automatic scan/import of all Pi history.
- A worker's **server lifetime**, not a browser or network request, owns its Pi children.
  Run it under a process supervisor such as systemd, independently of the controller's connection.

This partitions registry authority rather than replicating it. Do not give both controller and
worker independent writable copies of the same project/session registration. Centralized registry
ownership is another possible architecture, but adds durable coordination and is not needed for the
first connected-machine experience. [L2, L3, L6]

A machine interface needs a version/capability handshake; project/worktree selection and operations;
model/trust inspection; session create/open/observe/act/archive/delete; and scoped capture/image
retrieval. Reuse `SessionAction` / `SessionEvent` inside the machine envelope. Do not expose an
arbitrary unauthenticated shell endpoint or simply forward the existing unguarded router.

**One authoritative worker per machine/Pi environment.** Existing ownership locks are in memory,
not cross-process leases. If a remote machine already runs Piano, use that execution owner rather
than installing a second owner against the same Pi files. A duplicate worker startup must fail or
use an explicit takeover procedure. A concurrent terminal writer is not made safe by federation. [L2]

### Machine-qualified identity everywhere

Use a stable, persisted `machineId`, independent of its display name, hostname and connection URL.
Pin the worker identity during explicit enrollment and reject unexpected identity changes. Copies
of a VM must not silently reuse enrollment identity; require re-enrollment after cloning.

Illustrative identities, not an implemented schema:

```text
workspace reference = (machineId, workerWorkspaceId)
session reference   = (machineId, workerWorkspaceId, piSessionId)
observation cursor  = (machineId, workerEpoch, piGeneration, sequence)
```

The worker still resolves checkout aliases locally before applying its ownership key. The
controller never runs `realpath()` on a remote path. Qualify browser drafts, selections, deep links,
catalog/trust caches, images, captures and action results—not just sidebar labels. Migrate existing
browser/local references explicitly to the local machine. A revision content hash need not change,
but its observation receipt must identify machine/workspace/environment. [L2–L6]

### Disconnection is not execution failure

| Event | Required outcome |
| --- | --- |
| Browser closes or controller→worker connection drops | Pi continues on the worker, subject to explicit worker lifecycle/idle policy. UI says disconnected/unknown, not completed or exited. |
| Controller restarts | Reconnect, fetch authoritative worker snapshot, then attach ordered live events. Never resend the last mutation automatically. |
| Pi or worker actually exits | Report the observed exit/restart. Reopening a saved Pi session restores conversation, not interrupted shell commands. |
| Worker unreachable | Keep its known entries distinguishable from reachable ones; don't replace them with an apparently empty project list or silently run locally. |
| Lost mutation acknowledgement | Mark the result uncertain; query/reconcile it. Never infer rejection from a transport timeout. |
| Revoked connection | Deny further control promptly; define how existing streams close. Revoking access or forgetting a machine is not implicitly aborting all its work. |

Pi request IDs correlate responses, and Piano's current numeric submission IDs order observations;
neither is durable retry deduplication. Preserve the existing no-auto-resubmit rule. Give remote
mutations stable request identities and explicit acceptance/outcome lookup if retry is added.
Deduplication and retention must live at the worker where effects happen. After a worker crash,
an absent result does not prove a prompt/worktree operation never ran. Do not promise exactly-once
execution across the Pi write/acknowledgement gap. [P1, L1, L2, L4, L6]

Keep session generation and sequence semantics across the extra hop. Bound buffers independently
on worker→controller and controller→browser; a slow observer must not block Pi stdout draining.
Avoid one global mutation lock: a prompt can wait for an extension dialog whose answer/abort must
remain deliverable. [P1, L1, L4, L6]

## Enrollment and security

**Prerequisite:** an implemented, authenticated worker—not today's raw Piano router. Example
operator commands below describe future setup and were **not run**. `piano-hub` and `build-a` are
placeholder VM names; port `8787` is an illustrative dedicated worker port.

1. Install a matching Piano worker release on `build-a`, with Node, locked Pi, Git, and the
   supported Worktrunk version where worktree creation is needed. Run as the intended Unix user
   so its HOME, PATH, Pi configuration and project access are correct. Do not copy the controller's
   entire home directory, `auth.json`, SSH keys or environment.
2. Configure worker authorization to accept only the enrolled controller via the trusted ingress;
   protect every worker route and any WebSocket upgrade. Bind to loopback, keep the VM private,
   and ensure no alternate raw route bypasses those checks.
3. From the owner's authenticated operator terminal, create a **one-way** peer integration:

   ```sh
   ssh exe.dev integrations add http-proxy \
     --name piano-build-a \
     --target https://build-a.exe.xyz:8787/ \
     --peer --attach vm:piano-hub
   ```

   The documented attachment grants the controller VM use of this integration. Do **not** attach
   it to `auto:all` or every worker. Peer authorization uses the platform-delivered
   `X-Exedev-Source-Vm`, checked against enrollment policy. [E2, E8]
4. Enroll `https://piano-build-a.int.exe.xyz` in Piano, verify the worker handshake/identity and
   versions, then explicitly choose a project on that worker. Handshake routes and worker mode
   are proposed functionality, not existing commands. Reflection may later suggest integrations,
   but its free-form `help` text is not a trusted discovery protocol or executable instruction. [E6]
5. Configure Pi providers/resources **on the worker**. Exe.dev LLM integrations can provide models
   without putting provider keys on the VM; Reflection documentation says Pi is
   preconfigured for discovery. That does not establish discovery for Piano's locked CLI and
   arbitrary user setup: probe the actual worker CLI/cwd. Keep model choices machine-specific.
   Trusting a project remains a separate, explicit decision. [E9, P2, L1, L5]

Security requirements before shipping:

- **Controller compromise is fleet compromise.** Peer secrets cannot be extracted, but any code on
  the controller VM can use attached peer integrations. A hub that also runs unrestricted Pi has
  that ambient authority. Accept this only for trusted-owner use; isolate the controller from
  untrusted agent/preview workloads for stronger containment. Workers should not get integrations
  back to the controller or to other workers by default. [E2, P3]
- **Authentication is not authorization.** Private exe.dev Web access does not itself mean
  permission to run Pi, delete history or browse arbitrary directories. Authorize the user at the
  controller, the controller at the worker, and the selected machine/workspace/action at each
  routing seam. Treat a machine peer header as machine identity, not end-user identity. [E2, E3, L6]
- **Trust the header only on the trusted proxy path.** Direct network routes and local untrusted
  processes must not be able to impersonate that ingress. Same-VM root/code execution is outside
  the trusted-owner containment claim; loopback and header strings alone do not isolate it.
- **Browser protection:** check Origin/CSRF and authorization for mutating HTTP and WebSocket
  routes. Render remote transcripts as untrusted, preserve redaction, and proxy image retrieval
  with machine/session authorization; content hashes are not access tokens. Keep generated
  preview applications on separate origins from control. [L4, L5, L6]
- **Constrain enrollment:** accept explicit configured destinations, not arbitrary URLs supplied
  in session messages; validate redirects/targets to avoid SSRF and credential forwarding.
  Gate project registration separately from execution in selected roots. Apply payload limits,
  deadlines and resource limits at the worker.
- **Revocation is a lifecycle operation:** detaching the integration blocks its use; removing a
  machine from Piano's UI does not itself revoke platform access. Test revocation of already-open
  streams and decide whether active jobs continue or require a separate stop action. [E2, E8]

## Suggested delivery slices

1. **Feasibility + security decision.** On two explicitly authorized scratch VMs, test peer GET/POST,
   caller identity, spoofed-header rejection, direct/alternate-port bypass, WebSocket upgrade,
   streaming/idle behavior, disconnect/reconnect, payload sizes and revocation. No model calls are
   needed. Select one transport and record the trust model in an ADR. Do not provision machines
   or change account integrations just to complete this documentation task.
2. **Read-only connected machines.** Manual enrollment and a worker capability handshake; machine
   selector; remote directory/project/history/model views. Test two machines with identical paths
   and copied session IDs, unavailable workers, wrong worker identity and incompatible versions.
   Keep the local path working through the same interface.
3. **Remote session execution.** Create, prompt, steer, dialogs, abort, reload and reconnect through
   the remote owner. Use fake Pi/network failures to test dropped acknowledgements, controller
   restart, two tabs and duplicate ownership. One short real-Pi reply confirms worker configuration;
   separately inspect worker PID/cwd or a scratch file to prove where execution occurred.
4. **Complete the existing journey remotely.** Worktree creation, trust, capture/diff, attachments,
   rename/archive/delete and authenticated images all target the selected machine. Exercise partial
   Worktrunk failure, missing checkout and worker restart without deleting or relabeling history.

Each application slice requires the existing tests/typecheck and an observed scratch-browser
journey. New machine/session actions must also appear in Mod+K; show the selected machine where it
helps distinguish projects, and offline status when actionable—not permanent transport diagnostics.
Defer auto-discovery/provisioning, multi-controller leases, cross-machine file/session migration and
multi-user isolation until there is a concrete need. [L6]

**Best first experiment:** an authenticated worker stub on a second scratch VM, observed through
one peer integration. Prove caller identity and event delivery before refactoring Piano. The major
implementation work is machine-scoped ownership/routing and authorization, not launching Pi.

## Evidence and limitations

- Primary-source web/document review and direct local source inspection; Linux, Node **v24.21.0**.
- Installed Pi `rpc.md`, `cli.md`, `sessions.md`, `configuration.md`, `security.md` and
  `environment-variables.md` matched tagged **v1.0.2** byte-for-byte. Cached tag commit:
  `cd32f7725fdbddbaecdff5b1e68491563394e0ca`.
- A read-only background research invocation was attempted with no session persistence; it exited
  before model work because that invocation had no credential for its selected model. No findings
  rely on it; the source audit was performed directly. Log: `/tmp/piano-remote-research-I1PM6c/agent.log`.
- Public exe.dev documentation was retrieved successfully; the complete combined source is retained
  at `/tmp/pi-web-fetch-ueLbkH/output.md`. Temp paths are local research artifacts, not durable evidence
  promised by the repository.
- **Not tested:** peer connectivity, worker authentication, WebSocket/SSE support, SSH forwarding,
  token/connection revocation, remote Pi execution, installation or browser UX. These are explicit
  feasibility/implementation gates. No account credentials or integrations were inspected.
- Documentation-only review: 22 local links resolve; six tagged Pi source paths exist; 16 exe.dev
  links match retrieved first-party pages/sections. Staged `git diff --check` passes. No application
  run or new regression tests were needed. This does not establish working multi-machine execution.

## Sources

Exe.dev sources were read on 2026-10-07; they are live documentation, not immutable version pins.
Most linked pages were read through the first-party [combined documentation](https://exe.dev/docs/all).

- **E1:** [Cross-VM networking](https://exe.dev/docs/faq/cross-vm-networking).
- **E2:** [VM-to-VM integration](https://exe.dev/docs/integrations-vm-to-vm), including caller attestation, ownership, ports and revocation; [HTTP proxy integration](https://exe.dev/docs/integrations-http-proxy).
- **E3:** [HTTPS proxy](https://exe.dev/docs/proxy); [sharing](https://exe.dev/docs/sharing); [Login with exe](https://exe.dev/docs/login-with-exe).
- **E4:** [HTTPS API](https://exe.dev/docs/https-api), especially FAQ limits; [running commands on VMs](https://exe.dev/docs/https-api-run-on-vm).
- **E5:** [HTTPS tokens for VMs](https://exe.dev/docs/https-tokens-for-vms).
- **E6:** [Reflection integration](https://exe.dev/docs/integrations-reflection).
- **E7:** [SSH API/inventory](https://exe.dev/docs/api); [SSH destinations](https://exe.dev/docs/faq/ssh-destination).
- **E8:** [Attaching integrations](https://exe.dev/docs/integrations-attach).
- **E9:** [LLM integration](https://exe.dev/docs/integrations-llm); [integration secret storage](https://exe.dev/docs/integrations#where-secrets-live).
- **P1:** Pi 1.0.2 [RPC protocol](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/rpc.md) and [CLI](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/cli.md).
- **P2:** Pi 1.0.2 [configuration](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/configuration.md), [session storage](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/sessions.md), and [environment](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/environment-variables.md).
- **P3:** Pi 1.0.2 [security and project trust](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/security.md).
- **L1:** [PiSessions](../../server/PiSessions.ts), `spawnChild`, `openSession`, `probe`; [PiCli](../../server/PiCli.ts); [PiEnv](../../server/PiEnv.ts).
- **L2:** [SessionHosts](../../server/SessionHosts.ts), ownership keys, `reference`, `open`, `peek`, retirement/finalization; [SessionFiles](../../server/SessionFiles.ts).
- **L3:** [Registry](../../server/Registry.ts); [wire types](../../shared/wire.ts); [browser store](../../web/src/store.ts).
- **L4:** [Router](../../server/Router.ts); [WsClient](../../server/WsClient.ts); [server lifetime](../../server/main.ts).
- **L5:** [Worktrees](../../server/Worktrees.ts); [WorkspaceRevisions](../../server/WorkspaceRevisions.ts); [ProjectTrust](../../server/ProjectTrust.ts); [Catalog](../../server/Catalog.ts); [ImagePreviews](../../server/ImagePreviews.ts).
- **L6:** [ADR 0001](../adr/0001-pi-rpc-workspace-workbench.md); [invariants](../development-invariants.md); [roadmap](../roadmap.md); [private development](../development-on-exe-dev.md); [testing policy](../testing.md); [project instructions](../../AGENTS.md).
