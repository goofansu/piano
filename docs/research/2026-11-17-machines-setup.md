# Settings → Machines: integration selection and registry storage

Researched **2026-11-17** against Piano `5063ba2f5479934aa5430c9927fb7d1233c1810c`.
Updated with the user's scope decisions: **only attached exe.dev integrations for this slice;
VM name is the only required setup field, defaulted from the integration name; configuration lives
in the registry; Piano requires no token.** Manual/outside-main setup is deferred.

This is a proposal, **not implementation or an accepted change to ADR 0004**. It narrows the
[November 9 configuration research](2026-11-09-peer-configuration-ui.md). “Main” means the backend
serving the browser, not the browser's computer. Registry means Piano's existing database, not a
new store or a local JSON configuration file.

## Chosen flow

```text
Settings → Machines → Add machine
  list attached integrations
  select one or more
  confirm VM name for each (prefilled from integration name)
  check connection → save in registry → refresh machine picker
```

The user does not enter a target URL, Origin, token, display name or machine ID in this flow.
For a selected integration and the confirmed VM name:

```text
endpoint = https://<integration-name>.int.exe.xyz
origin   = https://<vm-name>.exe.xyz
name     = <vm-name>
```

The integration name determines the connection endpoint; the VM name determines the Origin and
initial machine label. They may differ. For an integration named `talk-to-bob` targeting VM `bob`,
the prefilled VM name is `talk-to-bob`; the user changes it to `bob`. Prefilling is a convenience,
not a claim that Reflection established the integration's target. [E1, E2]

The standard path assumes the target Piano accepts its canonical `https://<vm-name>.exe.xyz`
Origin. Non-default Origins, custom domains/ports requiring an override, manual connection setup,
outside-main access and token management are **not part of this slice**. A failed check explains
that the selected integration or VM name needs attention; it must not silently guess another
Origin, disable Origin validation or switch to unauthenticated/direct access.

No new peer-information endpoint, platform descriptor, account-management OAuth or pairing
protocol is needed. The existing `/ws/peer` handshake can check the selected connection. [L1, L2]

## Is the method reliable?

**The approach fits the existing same-owner transport. It is not yet live-connection verified.**
The user supplies the one missing input, the target VM name, so Reflection's lack of a structured
target URL is not a blocker. An HTTP-proxy integration's documented endpoint convention supplies
the other input. [E1–E3, L1]

Reliability depends on these explicit conditions:

- Main runs on an exe.dev VM with the selected integration attached and usable. Discovery lists
  that VM's available integrations, not all account VMs. [E1, E4]
- The user chooses an **HTTPS to another VM** integration for an already-running, same-owner Piano.
  An ordinary API proxy can also appear as `http-proxy`; type alone does not prove it is a peer.
  User selection and a Piano-specific handshake are therefore both necessary. [E1–E3]
- The confirmed VM name supplies an Origin the target Piano accepts. Main sends that Origin on
  the existing HTTP and WebSocket paths; it still dials the selected integration endpoint. [L1]
- The target supports `/ws/peer` and runs the same Piano revision as main, as required today.
  Reading a valid initial registry frame checks the protocol boundary, not exact version equality
  or cryptographic VM identity. A page returning HTTP 200 is insufficient. [L1, L2]

**No Piano token does not mean no authentication.** exe.dev creates and retains the integration's
VM-scoped credential outside both VMs. Piano neither asks for, stores nor manages that credential.
Attachment grants the source VM access; it is not individual-user authorization or a sandbox. [E3]

A connection check is a point-in-time result. Detachment, step-up approval, network failure or a
stopped peer can later make a saved machine unavailable. Keep the saved configuration and explain
the failure; never fall back to Local or replay a prompt. Removing a saved machine is not revoking
platform access or stopping remote work. [E4, E5, L2]

The configured integration remains a trusted destination assertion. A successful handshake does
not prove its configured target is the claimed VM or that both machines have the same owner.
Do not describe this setup as an authenticated instance-identity handshake; it retains ADR 0004's
existing trust model. [L2]

## Discovery evidence and startup detection

Public first-party documentation was reviewed, and two bounded read-only Reflection GETs were
made from this VM. No credentials were requested or supplied, and no account management,
provisioning, Piano configuration, running service or database was changed. Names and descriptive
values were omitted from captured output. No peer connection was tested.

### What Reflection supplies

The fixed endpoint is `https://reflection.int.exe.xyz/`. Its documented example exposes this VM's
`name`, `emoji` and available metadata `paths`. The integration listing is a separate fixed path:

```json
{
  "integrations": [
    {
      "name": "reflection",
      "type": "reflection",
      "comment": "",
      "help": "curl https://reflection.int.exe.xyz/"
    }
  ]
}
```

This is the documentation's example shape, not a live integration name copied from this VM. [E1]

The actual read-only observation on 2026-11-17 found:

| Request | Observed result |
| --- | --- |
| `GET /` | 200; top-level fields `emoji`, `name`, `paths`; `/integrations` advertised. |
| `GET /integrations` | 200; object envelope with `integrations`; every entry had only `comment`, `help`, `name`, `type`; some types were `http-proxy`. |

Neither the documentation nor this observation supplies a structured peer-mode discriminator,
target VM/URL/port, allowed Origin or attachment provenance. `http-proxy` is observed here, not a
versioned Reflection enum established by its examples. The earlier missing-target concern is
resolved for this design by **the user-confirmed VM name**, not by inventing extra metadata. [E1]

### Proposed detection behavior

At startup, main makes a bounded backend-only HTTPS check against the fixed Reflection origin,
without credentials or redirects. A valid response is a positive discovery-capability signal;
then fetch the fixed `/integrations` path if advertised. Do not follow arbitrary advertised URLs,
execute `help`, parse comments as authority or infer the target VM from an integration name.

Reflection is attached with `auto:all` for new accounts, but attachments can change. Failure is
not proof that main is outside exe.dev. No attachment-independent identity endpoint or supported
“running on exe.dev” environment variable was established by the reviewed docs. [E1, E4, E6]

Distinguish discovery available, listing not exposed, unavailable and an empty list. None should
block Piano startup or remove previously saved machines. Offer **Retry discovery** on failure
and **Refresh** after the user attaches an integration externally. With no usable integration,
this slice cannot add a machine; do not invent a manual/token fallback.

## Detailed setup journey

1. Open **Local → Settings → Machines**. Settings manages main's connections, not a peer's
   Settings, and does not become a remotely proxied settings endpoint. [L2, L3]
2. **Add machine** lists attached `http-proxy` entries as **Available integrations**, with selection
   and already-added state. No discovery row is automatically saved or contacted.
3. For each selected entry, show **VM name**, prefilled from the integration name. The user may
   accept or edit it. This is the only required setup field beyond the selection; derive endpoint,
   Origin and initial label as above. Keep the selected integration visible while editing.
4. **Add machines** validates the inputs and checks each selected connection through `/ws/peer`,
   using its derived Origin. Read and validate the initial registry frame, then close the check
   connection without selecting a session or sending a prompt. Reuse the gateway's bounds and
   validation; do not scan unselected integrations or require another peer endpoint. [L1]
5. Save the validated selection atomically in the registry, then refresh the machine picker.
   The check and commit must use the same reviewed inputs. If a row fails, identify it and save
   none; the user can correct its VM name or explicitly deselect it and retry. Do not silently
   commit a partial selection or replace it with newly discovered data.

An empty list explains that **HTTPS to another VM** must first be created/attached in exe.dev,
with an external link and Refresh. Creating integrations, minting credentials and provisioning
VMs remain outside Piano. Access can include shared VMs, so retain the same-owner requirement
rather than presenting integration access as ownership proof. [E3]

Use existing Settings frames, list rows, form/confirmation components and palette naming. The
page lists saved machines and offers connection checks and removal. Show Local as non-removable.
A last successful check is not continuous monitoring. Removal confirmation says that the local
connection is removed and observers disconnected; remote sessions continue. [L2–L4]

## Registry persistence and implementation ownership

**The registry is the sole configuration source for this feature.** Do not write `peers.json`,
credential files, browser storage or a second database. No tokens are part of the stored record.
Persist the user's choices and a stable machine identity; derive connection URLs rather than
keeping competing editable copies:

| Stored value | Purpose |
| --- | --- |
| `id` | Server-generated stable machine ID for routes and browser memory. |
| `integrationName` | Selected attached integration; determines the proxy endpoint. |
| `vmName` | Confirmed VM name; determines the Origin and initial public machine name. |
| `position` | Stable order in the machine list. |

Use the registry's transaction/revision boundary for atomic batch saves and stale-write detection.
Validate integration and VM names as single permitted DNS labels before URL construction, enforce
existing machine-ID/name uniqueness and the 32-peer bound, and reject duplicate configured
integrations. A missing/failed registry read must not masquerade as an authoritative empty list
and trigger removal of browser memory. [L1, L3, L5]

Current code loads `ConfiguredPeers` once from `PIANO_PEER_CONFIG`; `Router.ts` captures the machine
list, `PeerGateway.ts` captures its map, and `MachineHost` loads the public list once. The new flow
must replace those startup snapshots with registry-backed configuration and refresh the browser;
writing a database row alone cannot activate a peer. [L1, L3]

| Owner | Proposed responsibility |
| --- | --- |
| New `server/ExeDiscovery.ts` | Fixed-origin Reflection capability/read adapter, bounded parsing and integration suggestions; no account management or remote probes. |
| Registry / `server/RegistryDatabase.ts` | Store machine configuration in the existing database with schema migration and atomic/revisioned writes; no parallel configuration files. |
| New `server/Machines.ts` | Validate setup, derive connection details, coordinate checks/saves/removal, and provide immutable configured-connection snapshots from the registry. |
| `server/PeerConfig.ts` | Reuse applicable validation; file/token loading is not a setup mode or configuration authority for this feature. |
| `server/PeerGateway.ts` / `Router.ts` | Read current configured destinations per new request, expose a bounded server-only connection check, and serve `/api/machines` from the same source. |
| `shared/http.ts` / `shared/machine.ts` | Typed main-only discovery/add/check/remove contracts; ordinary machine lists remain IDs/names, not raw discovery metadata. |
| Settings / `MachineHost` | Add `/settings/machines`, VM-name prefills, checked batch saves, immediate picker refresh and reconciliation on tab re-entry/focus. |

Replacing the current file-backed startup source is part of implementation, not a second supported
mode. Do not silently merge file entries into the registry or import tokens. An existing deployment
using `PIANO_PEER_CONFIG` needs an explicit cutover; this research performs no migration or restart.
The new registry-backed setup does not restart main when adding or removing a machine.

Each request/socket captures its own immutable connection details. Removing a machine blocks new
requests and closes that machine's local observers/relays; remote Pi keeps running. Never rebind
an in-flight request, resend a prompt, redirect input to Local or claim that an interrupted send
was definitely undelivered. A removed machine's page becomes unavailable with an explicit
navigation choice. Only an authoritative list refresh clears its browser memory. [L2, L3]

A new target gets a new machine identity; do not recycle an ID into old routes/drafts. The VM name
is connection configuration, not merely an editable label. Changing it must not be implemented as
a cosmetic rename of a saved machine. Same-name or aliased integrations do not establish a shared
backend identity. [L2]

## Security and verification gates

Before implementation, amend ADR 0004's exclusion of discovery/machine CRUD and startup-only
configuration. Preserve INV-01/02/05/07/11/12: peer-owned sessions, main-origin browser traffic,
bounded fixed relay routes, private same-owner access, no replay/fallback and tested compatibility.
This is not the roadmap's general remote/multi-user product. [L2, L5]

Host/Origin/CSRF checks precede setup/check/mutation. Browser input chooses an attached integration
and VM name, not an arbitrary URL. Revalidate selection server-side before dialing; reject unknown
integrations and malformed names. No redirects, TLS bypass, browser-cookie forwarding, arbitrary
headers, account-management authority or unauthenticated fallback. Bound discovery responses,
candidate counts, concurrency and timeouts. External integrations can inject their own configured
credentials; a connection check must not become an unrestricted proxy. [E2, L1, L2]

These are **future acceptance checks, not executed results**:

1. **Name default and derivation:** selecting `bob` prefills VM name `bob`; endpoint is
   `https://bob.int.exe.xyz`, Origin is `https://bob.exe.xyz`. Selecting `talk-to-bob` and editing
   VM name to `bob` changes only the derived Origin/label, not the selected integration endpoint.
   Reject blank/malformed names before dialing. No URL, Origin or token field is required.
2. **Discovery failures:** absent/disabled Reflection, timeouts, redirects, HTML, malformed or
   oversized JSON and empty lists leave startup and saved machines usable. Retry is explicit;
   untrusted descriptions never execute commands or select destinations.
3. **Connection failures:** an ordinary proxy, unavailable peer, rejected Origin or incompatible
   initial frame is not saved as a working machine. Check only selected integrations. A failed
   batch or stale registry revision saves none; transient success is not a permanent guarantee.
4. **Persistence:** saved choices survive main restart in the same registry; no config/token files
   are written and no legacy file entries are merged. Failed database writes leave no phantom
   machine in the picker. Adding is immediately usable without restarting main.
5. **Ownership/lifecycle:** concurrent peers with colliding session IDs remain isolated; removal
   during HTTP/WS activity closes only that machine's observers, never stops remote Pi and never
   replays input or substitutes Local. Existing `PeerGateway`, `Peers`, `MachineMemory` and
   `MachineOffers` tests protect much of the baseline, not dynamic setup. [L6]
6. **Browser journey:** extend the existing remote scratch journey for selected integrations,
   unchanged/edited VM-name defaults, failed checks, atomic batch save, immediate picker refresh,
   reload and removal. Fixture Reflection/fake Pi prove Piano behavior, not actual exe.dev access.
7. **Live transport:** separately authorize a scratch hosted main and peer; verify an attached
   HTTPS-to-VM integration, canonical VM Origin, HTTP and `/ws/peer`, and unavailable/denied access.
   No live peer connection or integration mutation was performed in this research.

Implement registry-backed configuration and dynamic activation, then discovery and the Settings
journey. Run `npm run verify -- <evidence-directory>` and the affected scratch browser journey for
code changes. A separate live platform check is needed before claiming the actual deployed pair
works; documentation and a correct-looking hostname do not establish that result.

## Evidence limits and sources

Research checks are source/schema/link review and whitespace checks only; no runtime/tooling
changes were made and module/app tests were not run. The earlier live observation used the two
fixed Reflection paths with TLS verification, redirects/proxies disabled, a five-second timeout
and a 64 KiB response cap. Only status, field names, known type literals and counts were emitted.
It establishes one VM's metadata shape, not targets, ownership or peer compatibility.

External pages are live/unversioned, accessed 2026-11-17. No new live observation was needed for
the user's subsequent scope decisions.

- **E1:** [Reflection integration](https://exe.dev/docs/integrations-reflection.md): metadata and
  example response; no structured peer target contract.
- **E2:** [HTTP proxy integration](https://exe.dev/docs/integrations-http-proxy.md): endpoint-name
  convention and proxy behavior.
- **E3:** [VM-to-VM integration](https://exe.dev/docs/integrations-vm-to-vm.md): HTTPS-to-VM setup,
  target configuration and platform-owned credentials.
- **E4:** [Integrations](https://exe.dev/docs/integrations.md) and
  [attachments](https://exe.dev/docs/integrations-attach.md): effective VM access and attachment rules.
- **E5:** [Step-up approval](https://exe.dev/docs/integrations-step-up.md): approval and existing
  connections. Removal/revocation must not be conflated with stopping a run.
- **E6:** [Consolidated official documentation](https://exe.dev/llms-full.txt): reviewed for startup
  detection/metadata references; absence of another contract is a bounded finding.
- **L1:** [PeerConfig](../../server/PeerConfig.ts), [main](../../server/main.ts),
  [Router](../../server/Router.ts), [PeerGateway](../../server/PeerGateway.ts),
  [machine schemas](../../shared/machine.ts) and [HTTP contracts](../../shared/http.ts): inspected
  startup configuration, validation and transport boundaries.
- **L2:** [ADR 0004](../adr/0004-same-owner-piano-peer.md) and [Remote Pianos](../remote-piano.md):
  current ownership, trust and deliberate limits; the research does not amend these contracts.
- **L3:** [MachineHost](../../web/src/components/MachineHost.tsx),
  [SettingsPage](../../web/src/components/SettingsPage.tsx), [routes](../../web/src/lib/routes.ts),
  [machine offers](../../web/src/lib/machineOffers.ts) and
  [machine memory](../../web/src/lib/machineMemory.ts): current UI loading and ownership.
- **L4:** [Quiet UI](../quiet-ui.md): Settings structure and action naming.
- **L5:** [RegistryDatabase](../../server/RegistryDatabase.ts),
  [invariants](../development-invariants.md) and [roadmap](../roadmap.md): persistence and trust scope.
- **L6:** [Testing policy](../testing.md), [PeerGateway tests](../../test/PeerGateway.test.ts),
  [Peers tests](../../test/Peers.test.ts), [MachineMemory tests](../../test/MachineMemory.test.ts),
  [MachineOffers tests](../../test/MachineOffers.test.ts),
  [remote journey](../../test/browser/remote-session.mjs) and
  [verification map](../../.agents/skills/verify-piano/features/README.md).
