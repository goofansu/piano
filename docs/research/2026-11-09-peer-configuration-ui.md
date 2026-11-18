# Configuring Piano peers without a terminal

Researched **2026-11-09** against Piano **`4c15e8485f0c7d023f56d96107510a0aeec96e77`**
and current public, first-party exe.dev documentation. This is research for a configuration
proposal, **not an implementation, accepted boundary change or tested connection**.
No account credentials, integrations, VMs, services or databases were inspected or changed.

## Findings for the design decision

**A guided no-terminal setup is feasible with documented platform primitives. Fully automatic,
narrowly authorized pairing is not established.** There are two different jobs:

1. **Grant access in exe.dev.** The hosted case already has a documented dashboard flow;
   both hosted integration creation and laptop VM-token minting have browser-approval links
   accepted by the public, read-only preflight endpoint. [E1, E2, O1, O2]
2. **Save and activate the peer in Piano.** Piano currently reads `PIANO_PEER_CONFIG` and token
   files at startup; the machine picker does not do configuration, enrollment or discovery.
   A Settings surface and safe activation policy would be new work. [L1, L2]

Best short-term direction: let **exe.dev authorize, Piano configure**. Keep management credentials
out of Piano; send the user to exe.dev for explicit approval, then validate/save the resulting
connection in Piano. Hosted main can avoid handling any secret. Laptop main needs a one-time
VM-token import unless a secure platform callback is established. Revocation is a separate,
partially unresolved no-terminal journey—not something a local Remove action can promise.

| Main backend | Documented bootstrap | What a Piano configuration UI would add | Principal limitation |
| --- | --- | --- | --- |
| **exe.dev VM** | Integrations → **HTTPS to another VM** → choose target/port and attach only to main's VM. A prefilled approval link also passes preflight. [E1, O1] | Explicit import of integration endpoint and target Origin, stable machine ID, validation and activation. Optional Reflection-assisted suggestions. | Dashboard success, attachment discovery and real peer connectivity still need observation. No automatic return/callback contract found. |
| **Laptop** | Browser approval link for `ssh-key generate-api-key --vm=… --label=… --exp=30d` passes preflight; its response says the key is shown once to the user. [O2] | One-time secret import into backend-private storage plus direct target endpoint/Origin; never chat or browser persistence. | Preflight is not a successful mint/import. Secure handoff, renewal and no-terminal early revocation remain acceptance gates. |
| **Either, automatic management** | HTTPS management API or MCP OAuth can perform account operations with suitable authority. [E3, E4] | Dedicated management adapter, explicit consent, credential lifecycle and reconciliation. | Browser MCP sign-in is documented as account-wide. Command restrictions do not constrain arbitrary flag values to one peer pair. |

The October 7 [remote-machine research](2026-10-07-remote-exe-machines.md) remains useful for the
threat model, but not as a current feature inventory. Current docs explicitly describe dashboard
peer setup, suggest links and MCP OAuth. Current Piano already has remote conversations. [E1–E4, L1]

## What is documented, and what was observed

### Hosted main: platform-managed peer authority

The **HTTPS to another VM** tile takes a target VM, optional port, and attachments. Catalog search
can find an owned VM by name and preselect it. The equivalent command is
`integrations add http-proxy --name … --target https://<target>.exe.xyz[:port]/ --peer --attach vm:<main>`.
exe.dev generates a target-VM-scoped key and retains it outside both VMs; deleting the integration
removes the generated key. `X-Exedev-Source-Vm` identifies the source VM, not an individual user.
Anyone able to execute code on that source VM can exercise the attached authority. [E1, E5]

Choose a **direct attachment to main**, not `auto:all` or a mutable shared tag. Attachment and
`integrations detach <name> vm:<main>` are documented. Multiple attachment rules must be accounted
for when withdrawing access; removing one rule is not proof that no other rule grants it. [E6]

Reflection exposes the VM's own name and configured metadata, including its attached integrations.
Its documented integration records contain `name`, `type`, `comment` and `help`; they are not a
promised structured target/port/owner identity handshake. It is not account-wide inventory or a
management authorization endpoint. Suggest candidates only; never execute `help` text or infer a
trusted peer identity from a friendly name. [E7]

### Laptop main: VM tokens are not management tokens

VM HTTPS tokens use the signing namespace `v0@<vm>.exe.xyz`; management tokens use `v0@exe.dev`.
VM tokens authenticate to the target's HTTPS proxy, **not** to exe.dev commands. The proxy consumes
`X-Exedev-Authorization: Bearer …` before forwarding. A VM token is not limited to Piano or one
port. Signed `ctx` is available for an app's own authorization; it is not a built-in platform
Piano-only permission, and current Piano does not acquire such a restriction merely by storing a
token. [E8, E9, L1, L2]

Documented minting uses `ssh-key generate-api-key --vm=…`, or offline signing with an already
registered SSH private key. Offline signing is programmatic, but does **not** solve initial
identity enrollment or justify copying the user's SSH private key onto a Piano VM. Removing the
underlying SSH key revokes its tokens; an `exe1` token is only a handle for an `exe0` token and is
validated through it on each use. Use a dedicated label/key and finite expiry to isolate
revocation. No claim is made about already-open WebSocket revocation. [E8–E10]

### Browser approval links: a useful narrow handoff, not an OAuth callback

`https://exe.dev/suggest?command=<encoded-command>` is documented to describe an action for human
review and possible approval. Not every command/argument is supported. Its `preflight=1` GET is a
non-mutating support check: **200 means suggestible, not authorized or executed**. [E2]

On 2026-11-09, public unauthenticated preflight GETs using only invented example names returned:

| Hypothetical command | Observed status and result |
| --- | --- |
| `integrations add http-proxy --name piano-research-example --target https://piano-research-target.exe.xyz/ --peer --attach vm:piano-research-main` | **200**, `commandName: "integrations add"`; approval text names source, target and an API key scoped to that VM. [O1] |
| `ssh-key generate-api-key --vm=piano-research-target --label=piano-research-example --exp=30d` | **200**, `commandName: "ssh-key generate-api-key"`; approval text says: “The key is shown once, only to you.” [O2] |
| `ssh-key remove piano-research-example` | **400**, `reason: "not-linkable"`. [O3] |
| `integrations detach piano-research-example vm:piano-research-main` | **400**, `reason: "not-linkable"`. [O4] |

These were **only preflight requests**, not dashboard approval, token generation or connection
experiments. No normal execution link was opened. The result supports offering a prefilled
platform approval handoff, not claiming an end-to-end working wizard. The docs do not establish a
callback, result token exchange, `postMessage` protocol or secure direct delivery into Piano.
Do not invent one or put a credential in a URL. An explicit return-and-check step is sufficient
for a hosted first slice; a laptop import must be separately designed and verified.

The integration dashboard is documented as a management UI. A dashboard-only path to revoke a
VM token's key was **not verified** in the reviewed public sources. The command-link route above
cannot fill that gap. Expiry limits exposure but does not replace an emergency revoke action.

### Management API and OAuth: available, but more authority than pairing needs

The HTTPS management API is `POST https://exe.dev/exec`, with the SSH command as its body and JSON
output enabled. Together with the documented integration commands, this supplies an API path for
create, attach, list and detach; token generation/removal are SSH-key commands. This is documented
API composition, **not a test of these operations or their exact permission strings**. An
implementation must check production command help/schema in an authorized scratch account. [E3,
E5, E6, E10, E11]

Management bearer tokens can be generated through an existing SSH identity or signed locally.
`cmds` limits command names, **not their flags, arguments or options** (the documented exception
is `ssh <vm-name>`). The default command list does not grant integration creation or token minting.
Granting an integration-management or token-mint command must not be described as “only attach this
main to this target”: the reviewed API does not promise those argument-level constraints. A
UI allowlist is not a credential's scope. `ctx` is uninterpreted by exe.dev. [E3]

There **is browser OAuth**: exe.dev's MCP server supports Streamable HTTP, OAuth and dynamic client
registration. Its official guide explicitly says signing in lets the agent do anything the account
can on every accessible VM. The general MCP endpoint exposes `exec`; narrower curated endpoints
list/create VMs and run VM commands, not a peer-only consent grant. This is a possible automatic
management path, not proof of a least-privilege peer setup flow or permission to send its OAuth
credential to the VM HTTPS proxy. [E4]

The MCP guide also documents tag-limited, command-limited tokens, generated separately with
`--tag`, `--cmds` and expiry. Do not assume tag restrictions constrain integration attachment,
token minting or delegated credentials: those effects are not established by its VM-operation
examples. The HTTPS API page's listed payload fields and the simulated command explorer do not
fully describe that tag feature. Verify effective scope and delegation before relying on it. [E3,
E4, E11]

No peer-specific OAuth scope, device-authorization flow or permission-preserving exchange from
browser VM login to a backend VM token was found in the reviewed sources. This is a bounded
negative finding, **not a claim that exe.dev has no OAuth**. The documented MCP OAuth is real;
its broad consent is the problem for this use case.

### Can an attached integration do account management?

**Not by virtue of being attached.** A peer integration supplies a target-VM token; Reflection
supplies metadata. Neither is documented as delegating exe.dev account-management authority.
Using the peer token against `/exec` confuses signing namespaces. [E1, E7–E9]

A generic HTTP-proxy integration can inject a supplied bearer credential. One could investigate
vaulting a separately authorized management credential behind such an integration, but the exact
exe.dev-to-itself route and supported commands were not tested. Even if supported, secret custody
is not least privilege: every process on the attached VM could exercise whatever that credential
allows. Vaulting prevents extraction, not account operations through the proxy. It also requires
someone to grant management authority in the first place. Do not choose this merely to avoid a
terminal. [E3, E5]

## Could an already-authenticated target Piano approve pairing?

**As an intent/approval screen, yes in principle; as a source of new platform authority, not with
the existing login primitive alone.** This is a deduction from the documented boundaries:

- Login with exe gives target requests a stable user ID/email and supports a login redirect.
  It does not document token minting or delegation. An authenticated target request is not an
  account-management bearer token, and the target does not receive the peer integration's key.
  A user with shared VM access is not automatically its owner. [E1, E12]
- A target-issued Piano pairing secret would still encounter the outer private exe.dev proxy.
  Without an integration or VM token, the main backend cannot use it to cross that gate. Making
  a pairing endpoint public would widen the trust boundary rather than solve authorization
  within ADR 0004. Browser-to-target API calls or copying browser cookies would violate the
  current own-origin/backend-credential boundary. [E8, E12, L2]
- A target screen could show the exact source/target/port and send the owner to a platform
  approval link. Hosted main could then check its authorized integration. Laptop main still
  needs the VM-token handoff. An application pairing intent can bind consent to one request;
  it cannot make the missing platform credential appear. [E1, E2, O1, O2]

A new pairing protocol would need one-use, expiring intent state bound to exact instances, initiating
browser and owner identity; explicit confirmation on the trusted target; strict callback origins;
and no replay or arbitrary callback/URL fetch. No such protocol, ownership mapping or secure
credential exchange was exercised here. Do not call it safe merely because both tabs are logged in.

## Bounded options and acceptance gates

### Preferred near-term scope

Propose a **Machines** Settings surface for already-running, same-owner Pianos, not VM provisioning.
Use **Add machine** for an association, keep the current picker for switching, put transport details
on demand, and make outgoing exe.dev links visibly external. Settings structure, confirmation,
feedback and palette naming should follow [Quiet UI](../quiet-ui.md). This is a UI recommendation,
not an inspected prototype. [L3]

1. **Hosted:** platform dashboard/approval link grants one-way access; Piano saves a validated peer.
   No management token, SSH key or VM bearer secret needs to enter Piano.
2. **Laptop:** platform approval link mints a dedicated, finite-lived VM token; user imports it once
   into Piano's own-origin form for backend-private storage. This is a proposed exception for
   secret input, not routine browser credential delivery or storage. No automatic token refresh.
3. **Both:** “saved”, “active”, “reachable” and “revoked” must not be conflated. If configuration
   remains startup-only, say it needs restart rather than silently restarting the backend. To
   eliminate that terminal/restart step, safe runtime activation is separate implementation work.

Before claiming **complete no-terminal lifecycle**, verify the actual dashboard revoke path for
laptop tokens and integration withdrawal. If unavailable, retain explicit external revocation
instructions and describe the feature as guided setup, not complete peer management.

### Fully automatic option, only with an explicit authority decision

MCP browser OAuth could bootstrap a deterministic management client without an operator terminal,
but it gives broader authority than this task needs. Prefer a future exe.dev grant scoped to
**one source, one target and the required operations**, or a platform-owned approval/result exchange.
Request that capability rather than assuming it exists. If broad OAuth is consciously accepted,
keep it out of model-visible tools, isolate credential custody from Pi/preview workloads, minimize
retention, validate cleanup/revocation, and audit/reconcile every uncertain mutation. A command-only
management token is narrower than unrestricted OAuth, but not proven pair-scoped. [E3, E4]

A hosted proxy holding management authority is not recommended for the short-term design. The
dashboard handoff already avoids that expansion. A laptop's existing SSH identity could execute
fixed operations programmatically, but that is a different credential/trust choice, not a reason to
discover or copy keys automatically. Neither option was tested.

### Acceptance gates before implementation can claim success

- **Boundary:** amend/supersede ADR 0004's exclusion of enrollment/machine CRUD and external
  mint/revoke ownership deliberately. Preserve INV-01/02/07/11/12; do not turn this small convenience
  feature into the roadmap's general remote/multi-user product. [L2–L4]
- **Platform handoff:** observe dashboard approval/cancel/wrong account, exact target and port,
  direct attachment, return to Piano, and a real connection on explicitly authorized scratch
  resources. Preflight alone is insufficient. No automatic replay of uncertain platform mutations.
- **Credentials:** confirm VM versus management scope, dedicated revocable identity, expiry,
  permissions/atomic storage and failed-write cleanup. No tokens in URLs, logs, telemetry,
  transcripts, exports or browser persistence. Import input clears after submission; subsequent
  reads never return the secret or file path. Prevent managed previews from inheriting it.
- **Browser and network:** same-origin/CSRF protections on all configuration mutations; strict
  Host/Origin checks; validate destinations before any probe, refuse redirects, arbitrary private
  hosts and credential forwarding. A connection test must not become an SSRF service. Keep all
  backends loopback/private and browsers on their own Piano origin.
- **Identity and activation:** stable machine IDs cannot be silently repointed or recycled into
  old routes/drafts. Reject duplicate/invalid configurations atomically. Define which configuration
  generation active sockets retain and how updates close them; never switch an in-flight request
  to another peer. Verify actual same-revision peers (INV-07/12), not just a successful HTTP response.
- **Removal and revocation:** distinguish removing Piano configuration, detaching/deleting the
  platform integration, removing a token's key and explicitly stopping a remote run. Close local
  observers when authority is withdrawn; test new and already-open connections separately.
  Remote runs remain remote-owned and are not implicitly stopped or replayed (INV-02).
- **Failure:** expiry, denied consent, offline peer, wrong VM, rotation, restart and two-tab edits
  must fail closed. Never execute locally as fallback or replay a prompt to recover connectivity.

## Evidence limits and source ledger

Review environment: dedicated research worktree on Linux `6.12.115`, UTC 2026-11-09. The note's local
baseline is the full commit above. Public docs were retrieved via Firecrawl; discovery used Radius.
All cited external documents/preflight URLs returned HTTP 200 except the two intentional 400
unsupported-command checks. Temporary fetch rate limits were retried after reset, not treated as
feature failures. Search snippets were not used to override retrieved page content.

Sources are **live, unversioned pages accessed 2026-11-09**, not immutable release pins. The MCP
walkthrough states “Updated Oct 28, 2026 · tested end to end Oct 27, 2026”; those are the publisher's
claims, not tests performed here. CLI-reference URLs now show an explicitly **simulated** explorer;
its integration command is not simulated at all, so it cannot establish production behavior.

No authenticated dashboard session, OAuth consent, live API command, token mint/revoke, peer
HTTP/WebSocket connection, same-owner pairing or browser import was tested. No application code
changed; document/link review and `git diff --check` are the relevant checks, not app runs or the
code test suite. Remaining uncertainties are gates above, especially secure token handoff,
no-terminal revocation, effective management scopes and live connection lifecycle.

### exe.dev primary sources

- **E1:** [VM-to-VM integration](https://exe.dev/docs/integrations-vm-to-vm), especially “Setup from the UI”, key custody, caller identity and deletion.
- **E2:** [Suggest links](https://exe.dev/docs/suggest-links), human approval and preflight semantics.
- **E3:** [HTTPS API](https://exe.dev/docs/https-api), authentication, `cmds`, default permissions and `/exec` semantics.
- **E4:** [MCP server](https://exe.dev/docs/mcp) and [MCP walkthrough](https://exe.dev/deploy/exe-mcp), OAuth/dynamic registration, account-wide sign-in, tag/command-limited tokens and tool surfaces.
- **E5:** [Integrations](https://exe.dev/docs/integrations.md) and [HTTP proxy integration](https://exe.dev/docs/integrations-http-proxy), dashboard management, listing, injected credentials and editing.
- **E6:** [Attaching integrations](https://exe.dev/docs/integrations-attach), direct/tag/automatic attachments and detachment.
- **E7:** [Reflection integration](https://exe.dev/docs/integrations-reflection), documented metadata and example schema.
- **E8:** [HTTPS tokens for VMs](https://exe.dev/docs/https-tokens-for-vms), namespace, consumed authorization header and signed context.
- **E9:** [Local key creation](https://exe.dev/docs/https-api-local-key), signing, key revocation and `exe0`/`exe1` relationship.
- **E10:** [SSH-key command explorer](https://exe.dev/docs/cli-ssh-key), list/add/remove/generate command inventory; simulated, not execution evidence. Revocation is also documented in E4/E9.
- **E11:** [Token-generation help](https://exe.dev/api?cmd=help+ssh-key+generate-api-key) and [integration explorer](https://exe.dev/docs/cli-integrations); simulated/reference limitations described above.
- **E12:** [Login with exe](https://exe.dev/docs/login-with-exe), identity headers and login redirect, not credential delegation.

### Public, non-mutating preflight observations

These links include `preflight=1`; names are invented, not discovered account resources.

- **O1:** [Peer integration creation preflight](https://exe.dev/suggest?command=integrations%20add%20http-proxy%20--name%20piano-research-example%20--target%20https%3A%2F%2Fpiano-research-target.exe.xyz%2F%20--peer%20--attach%20vm%3Apiano-research-main&preflight=1).
- **O2:** [VM-token creation preflight](https://exe.dev/suggest?command=ssh-key%20generate-api-key%20--vm%3Dpiano-research-target%20--label%3Dpiano-research-example%20--exp%3D30d&preflight=1).
- **O3:** [Key-removal preflight](https://exe.dev/suggest?command=ssh-key%20remove%20piano-research-example&preflight=1).
- **O4:** [Integration-detachment preflight](https://exe.dev/suggest?command=integrations%20detach%20piano-research-example%20vm%3Apiano-research-main&preflight=1).

### Piano sources

- **L1:** [Remote Pianos](../remote-piano.md), existing modes, stable IDs, token files and startup-only activation.
- **L2:** [ADR 0004](../adr/0004-same-owner-piano-peer.md), same-owner peer boundary and exclusions.
- **L3:** [Development direction](../README.md), [Quiet UI](../quiet-ui.md), [glossary](../glossary.md) and [roadmap](../roadmap.md).
- **L4:** [ADR 0001](../adr/0001-pi-rpc-workspace-workbench.md), [invariants](../development-invariants.md) and [testing policy](../testing.md).
