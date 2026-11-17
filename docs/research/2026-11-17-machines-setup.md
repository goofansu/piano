# Settings → Machines: discovery and manual peer setup

Researched **2026-11-17** against Piano `5063ba2f5479934aa5430c9927fb7d1233c1810c`.
This is a proposal, **not implementation or an accepted change to ADR 0004**. It narrows the
[November 9 configuration research](2026-11-09-peer-configuration-ui.md) to the requested two
add paths: discover attached exe.dev integrations when available, or add manually from any main.
“Main” means the backend serving the browser, not the browser's computer.

Evidence: public first-party documentation, source/test inspection, and two bounded read-only
Reflection GETs from this VM. No credentials were requested or sent; names and descriptive values
were omitted from captured output. No account management, provisioning, Piano configuration,
running service or database was changed. No peer connection was tested. External docs are live,
unversioned pages, not a pinned platform release.

## Recommendation

Add **Local → Settings → Machines**, with one **Add machine** action and two paths:

```text
Settings → Machines → Add machine
  From exe.dev       discover attached integrations → select → confirm target → check → add
  Add manually       target URL + connection details → check → add
```

- **From exe.dev** is available when the main backend positively detects Reflection capability
  at startup; manual add is always available. Discovery is local to that VM's attachments, not
  all the user's account VMs. Offer Refresh after the user attaches an integration externally,
  and Retry discovery after an unavailable startup check.
- Keep exe.dev responsible for granting access. Piano saves connections to already-running,
  same-owner Pianos. Do not add account-management OAuth, SSH-key discovery, VM provisioning or
  automatic integration creation for this feature.
- **Manual supports an outside main now at the transport level:** a laptop or other host can
  reach a private exe.dev target through its direct HTTPS URL and a VM-scoped token. The new work
  is the Settings form, private persistence and runtime activation, not a new tunnel. [L1, L2]
- Prefer immediate activation without restarting main. Removing a connection closes its local
  observers, not remote sessions, and does not revoke platform access. These lifecycle semantics
  must be deliberately added; the current configuration is startup-only. [L1, L3]
- **The important constraint:** current discovery does not give enough structured data for a
  correct one-click machine picker. Ship confirmed integration suggestions plus manual target
  entry initially. If selection alone is required, add the small peer self-description below
  or obtain a supported descriptor from exe.dev; neither exists in the current contract.

## Discovery finding

**Attached-integration discovery without account-management credentials is documented. An accurate
“select a machine” list containing only peer integrations and their authoritative target/Origin is
not established by the published Reflection response.** The earlier November 9 note's four-field
example remains current; that is an example, not proof that production can never return more fields. [R]

- **Documented:** Reflection exposes this VM's name and attached integration metadata. Peer
  integrations let attached VMs call a target without holding its generated key. [R, V]
- **Observed here:** root keys were `emoji`, `name`, `paths`; `/integrations` had the documented
  object envelope. Every returned entry had only `comment`, `help`, `name`, `type`; some had
  `type: "http-proxy"`. Both GETs returned 200. No integration names or descriptive values are
  retained in this note. This is one environment observation, not an exhaustive platform contract.
- **Unknown:** a structured peer discriminator, target VM/URL/port, target application's Origin,
  or attachment provenance. None appeared in the response here or the documented schema. We did
  not determine whether any listed proxy was a peer or inspect its target. [R, H, V]
- **Proposed safe fallback:** filter the observed `http-proxy` type as **integration suggestions**,
  not verified machines. The user confirms which are HTTPS-to-VM integrations and supplies each
  target URL/Origin before Piano tests it. Unknown types stay out of automatic candidates; manual
  entry remains available. Do not probe every attached service or parse/execute `help` to supply
  missing authority.
- **Capability request:** a documented, non-secret, VM-visible descriptor identifying peer mode,
  effective target URL (including port), and target VM identity would enable accurate platform
  candidates. These are proposed fields, **not existing API names**. Application compatibility and
  accepted Origin would still need validation. Do not obtain management credentials just to fill
  this metadata gap.

## Startup detection and exact Reflection assumptions

The documented fixed discovery endpoint is `https://reflection.int.exe.xyz/`. New accounts get
Reflection attached with `auto:all`, but attachments can change; reinstalling Reflection is also
documented. The VM name and emoji are always present at the index's top level, independently of
which metadata fields are enabled. Therefore a working Reflection response is a useful **positive
capability signal**, while failure is not proof that the backend runs outside exe.dev. [R, G, A]

The following are the **documented example shapes**, not responses observed from a VM: [R]

```json
{
  "name": "my-vm",
  "emoji": "🚀",
  "paths": [
    { "description": "owner email address", "path": "/email" },
    { "description": "integrations available to this VM", "path": "/integrations" },
    { "description": "tags set on this VM", "path": "/tags" },
    { "description": "comment set on this VM", "path": "/comment" },
    { "description": "default proxy port for this VM", "path": "/default_port" }
  ]
}
```

`GET https://reflection.int.exe.xyz/integrations` has an object envelope, **not a bare array**:

```json
{
  "integrations": [
    {
      "comment": "",
      "help": "curl https://reflection.int.exe.xyz/",
      "name": "reflection",
      "type": "reflection"
    }
  ]
}
```

The complete example also contains `llm` and `github` entries with the same four string fields. [R]

| Field/assumption | Evidence and implementation consequence |
| --- | --- |
| Root `name`, `emoji` | Explicitly always published. Identifies **this VM**, not an integration's target; no immutable VM ID is documented here. [R] |
| Root `paths[]`: `path`, `description` | Example strings advertising enabled metadata. Proposed: recognize only the fixed expected `/integrations` path; do not fetch arbitrary advertised URLs. [R] |
| `/integrations` → `integrations[]` | Attached integrations available to this VM, not account-wide VM inventory. No management token is used in the documented request. [R] |
| Entry `name`, `type`, `comment`, `help` | Example strings, not a formal exhaustive JSON schema or versioned enum. Proposed: validate required fields, tolerate unknown fields, treat descriptive text as inert data. [R] |
| `type === "http-proxy"` or `type === "peer"` | `http-proxy` was observed here, but is not specified by the Reflection examples. `peer` was not observed or documented as a distinct type; creation uses `http-proxy --peer`. Do not interpret HTTP-proxy type as peer authorization. [R, H, V] |
| `peer`, `target`, `url`, `port`, `origin`, `owner`, attachment rules | **No such structured entry fields are documented.** Do not invent them or derive them from `help`, `comment`, or a friendly name. [R] |
| `/default_port` | Described as the shared/default proxy port of **this VM**. Its response shape is not shown; it cannot supply a remote target's port. [R] |

**Unknown detection contract:** no general “running on exe.dev” environment variable, marker-file
contract, or attachment-independent identity endpoint was found in the reviewed docs or targeted
search of the official [consolidated docs][F]. This is a bounded negative finding, not proof none
exists. The docs mention legacy link-local metadata services, but do not establish a supported
identity-detection schema to substitute for Reflection. [F]

**Proposed startup behavior:** one bounded, backend-only HTTPS capability check against the fixed
Reflection origin, without credentials or redirects; validate the JSON, then query the fixed
integration path only if available. Distinguish “discovery available,” “integration listing not
exposed,” and “discovery unavailable.” Keep manual add available in all cases. Failure, malformed
JSON, or absent `/integrations` must not block startup, prove “not exe.dev,” or mean “no machines.”
No exact failure status codes, cache freshness, or change-notification contract are documented. [R]

## Integration URL, target identity, and attachment visibility

**Documented endpoint convention:** an HTTP proxy created as `--name mirror` is called at
`https://mirror.int.exe.xyz/`; the peer example independently maps `talk-to-bob` to
`https://talk-to-bob.int.exe.xyz/`. Peer integrations use the same hostname mechanics. Thus a
validated, confirmed HTTP-proxy name supports constructing its **proxy endpoint**, not its target.
The docs do not provide a complete integration-name grammar or a Reflection endpoint field. [H, V]

**Peer identification gap:** the **HTTPS to another VM** dashboard tile creates an HTTP-proxy
integration with peer authorization. Ordinary proxies can instead target unrelated APIs and
inject arbitrary configured headers. Name/type alone does not document a way to distinguish
these modes. A successful request to a proxy is not proof that it is a Piano peer. [H, V]

**Target/Origin gap:** `talk-to-bob` and target `bob` are separate creation inputs. Reflection does
not document a target URL, target port, target ownership proof, or canonical application Origin.
The proxy example shows the upstream `Host` changed to the configured target, and the HTTPS proxy
forwards `X-Forwarded-Proto`/`X-Forwarded-Host`; these are **request headers at the destination**,
not a target-discovery response or an `Origin`-rewriting promise. Do not infer target Origin from
an integration hostname or try to learn it from authentication redirects. Ask the user for the
configured target and the application's accepted Origin when these differ. [R, H, P]

**Visibility is effective access, not attachment provenance:** integrations may be attached by
`vm:<name>`, `tag:<tag>`, or `auto:all`. Reflection describes available attached integrations but
shows no rule/source, owner/team field, or inventory of unattached account integrations. Missing
listing permission is different from an empty list. Availability is also not readiness: step-up
approval can deny requests until approved, and ending approval does not close existing connections.
No immediate Reflection update/detachment visibility guarantee is documented. [R, A, S]

The peer guide says the target can be a VM the user **owns or has access to**; do not equate a peer
integration with proof of same ownership. Its generated key is scoped to the target VM and kept
outside both VMs. `X-Exedev-Source-Vm` is platform-attested **caller** identity at the target, not
remote identity returned to the source or an individual user's identity. Deleting the integration
removes its generated key. [V]

## Manual add from a main backend outside exe.dev

For a **private exe.dev target**, the documented non-browser mechanism is a VM HTTPS bearer token:
`ssh-key generate-api-key --vm=<target> --label=<label>`, or local signing with an already registered
SSH key. The namespace is `v0@<target>.exe.xyz`, distinct from management's `v0@exe.dev`.
The backend sends `X-Exedev-Authorization: Bearer <token>`; the proxy consumes and strips it.
`Authorization: Bearer` is deprecated for this purpose. No account-management credential needs to
be granted to Piano to **use** a user-supplied VM token. Creating it remains an authorized external
setup action, not something this research performed. [T, K, M] No reviewed contract makes an
attached integration available to an arbitrary non-exe backend; use the direct VM endpoint plus
token rather than assuming an `.int.exe.xyz` name works from a laptop. [G, A]

The documented scope is the **VM**, not a Piano service or individual port. No built-in port/path
scope is established. Signed `ctx` is available to the destination application's own authorization,
not an automatic service restriction. Recommend finite expiry and a separately revocable signing
key; removing that key revokes its tokens. `exe1` is an opaque handle for `exe0`, validated through
the underlying token on every use. These are credential-lifecycle requirements for a manual flow,
not grounds to copy the user's SSH private key into Piano. [T, K, M]

| Connection detail | Documented behavior / limitation |
| --- | --- |
| Direct endpoint | `https://<vm>.exe.xyz/` routes to the configured shared port. Do not hard-code it as 8000: the proxy can select from image `EXPOSE` ports or use `share port`. The peer UI guide describes 8000 as its default. [P, V] |
| Explicit target port | Additional HTTPS proxy ports **3000–9999** are documented, e.g. `https://<vm>.exe.xyz:8001/`. These alternate ports remain access-controlled. Other explicit ports are not established by this guide. [P] |
| Peer integration with custom port | Put the port in the **target URL**, e.g. the documented `https://bob.exe.xyz:3000/`. Call the normal integration hostname without copying that target port onto it. [V] |
| Origin | Proposed: retain explicit target scheme/host/port and separately validate the application's expected Origin. Platform metadata does not supply that application contract. [R, P] |
| Custom domains | Supported after DNS setup and registration, but the custom-domain guide does not establish VM-token use on aliases or a Reflection canonical-Origin mapping. Do not promise those combinations without validation; prefer the documented `.exe.xyz` route initially. [C, T, R] |

## Can selection work without asking for the target URL?

**Yes, with a new read-only Piano descriptor—not with Reflection alone.** An optional second slice
could add a fixed `GET /api/peer/info` on each peer. It would return a small versioned response with
Piano identity, a persistent instance ID, deployment revision and one explicitly configured peer
Origin. These are **proposed fields and route**, not current capabilities. Returning a selected
Origin is preferable to exposing the full allowed-origin list. [L2, L3]

The main would fetch this path only after the user selects a discovered integration, without a
browser cookie, management credential or guessed Origin. Current Router middleware allows a
plain GET without Origin while still checking Host; the exe.dev proxy still supplies private
access. Actual proxy behavior needs a scratch check. Main would keep dialing the **selected
integration endpoint**: the advertised Origin is a validated header value, never permission to
follow a returned URL or redirect. Then confirm the reported identity and perform `/ws/peer`.
An old peer or non-Piano proxy lacking this contract falls back to manual target entry. [L2]

This resolves application identification and Origin bootstrap under the existing configured-endpoint
trust model; it does not prove VM ownership, expose unattached machines, or make self-reported
identity cryptographic attestation. Persisting the instance ID could additionally detect a later
integration retarget instead of silently reusing old browser state. That adds an identity/recovery
contract and requires deliberate migration and tests. Do not scan every generic integration or
weaken the existing WebSocket Origin check to avoid this work.

**Choice:** use confirmation/manual target entry for the smallest implementation. For the desired
pick-and-add experience without extra target fields, prefer this bounded peer descriptor over
acquiring broad exe.dev management authority; a future platform peer descriptor is another option.
All peers must be upgraded before advertising that richer flow. It is not a pairing/token-minting
protocol and needs no public unauthenticated endpoint or general-purpose proxy.

## Proposed user journeys

### From exe.dev

1. Startup performs the bounded Reflection check above. Do not guess from browser hostname,
   `hostname`, an undocumented environment variable, or a DNS lookup alone. Detection failure
   leaves main usable with **Add manually**; show discovery as unavailable, not definitely non-exe.
2. **From exe.dev** lists candidate integration names with selection controls and already-added
   state. No candidate is saved or contacted merely because it was discovered. Multiple selection
   is useful, but each chosen entry must have its own confirmed target and check result.
3. With today's metadata, request each selected integration's target URL. Default its proposed
   Origin to that URL's origin; show an advanced **Allowed Origin** field when the target Piano
   uses another configured origin. Display proxy endpoint and target together for confirmation.
4. **Check connection** performs a bounded, backend-only `/ws/peer` handshake and reads the initial
   registry frame, then closes without selecting a session or sending a prompt. Reuse the existing
   gateway's validation, credentials and limits; a root-page 200 is not a Piano compatibility test.
   Success means a compatible peer boundary responded, not cryptographic proof of VM identity or
   exact matching revision. Deploy the same revision, as today. [L2, L3]
5. **Add machines** saves the reviewed selection atomically and refreshes the machine picker.
   A failed row is identified and remains unsaved; the user may explicitly deselect it and retry.
   A stale/changed selection must be reviewed again, not silently replaced by new discovery data.

Empty state: explain that **HTTPS to another VM** must be created/attached in exe.dev, provide an
external dashboard/docs link, then **Refresh**. Do not mint keys or attach VMs from Piano. Since a
peer may target a shared VM, explicitly retain the same-owner requirement rather than treating
integration access as ownership attestation. [V, L3]

### Add manually (including main outside exe.dev)

The simple form asks for **Name**, **Machine URL**, and the connection method:

| Method | User supplies | Server stores/uses |
| --- | --- | --- |
| Direct exe.dev VM | `https://<vm>.exe.xyz[:port]` and a VM HTTPS token | Direct endpoint, target Origin and a private token reference; `X-Exedev-Authorization` on HTTP and WS only to that VM. |
| Attached exe.dev integration | Integration endpoint and target URL; no token | Proxy endpoint and target Origin; available only where that attachment is usable. |

Use an advanced Allowed Origin override for non-default target configuration. Do not ask for a
machine ID or a server token-file path in the ordinary form. Manual entry is available on exe.dev
as well as outside it; an outside main must use the direct endpoint rather than assume attached
integration access. Creating the dedicated, finite-lived token is an external exe.dev action. [T, L1]

Token entry is a one-time secret submission to main's own-origin backend: never echoed in a GET,
URL, log, transcript, browser storage or ordinary machine object. Clear the input after submission
or cancellation. A connection check and save must bind to the exact submitted target/credential;
never reuse a successful check after either changes. Prefer a short-lived backend-held setup
attempt if Check and Add are separate actions. [L2, L3]

A failed check preserves non-secret form fields and a specific, sanitized reason; it does not
silently add a working-looking row. Once saved, offline/auth-failed machines remain configured
and can be retried. **Saved** is not a permanent readiness or authorization guarantee.

This satisfies “main outside exe.dev” without promising arbitrary non-exe **targets**. Piano has
no application authentication; HTTPS alone does not make a public target safe. Supporting other
target hosts/authentication schemes is a separate transport/security decision, not an excuse to
add arbitrary headers or disable certificate verification. [L3, L6]

### The Machines page

Show Local as non-removable and each configured peer as a quiet list row. Use **Add machine**,
**Check connection**, **Rename**, **Replace token** for direct VM entries, and **Remove**; keep
connection details on demand. Follow Settings' existing frame, list, form and confirmation
components, plus a palette destination. Do not present last check time as continuous monitoring.
Settings remains main-owned, never a new remotely proxied settings endpoint. [L4, L5]

Removal confirmation says it removes this connection and disconnects observers; remote sessions
continue. It must distinguish local credential deletion from exe.dev token revocation or integration
deletion. For expiry/revocation, tell the user how to replace the token or manage the integration
externally; do not promise automatic renewal or complete no-terminal revocation. [L1, L3, T, K, V]

## Implementation approach and ownership

The current architecture already has the right transport boundary, but **adding a form alone will
not activate a peer**. `ConfiguredPeers` is loaded once by `main.ts`; `Router.ts` captures the public
machine list, `PeerGateway.ts` captures its ID map, and `MachineHost` loads that list once. [L2, L4]

| Owner | Proposed change |
| --- | --- |
| New `server/ExeDiscovery.ts` | Fixed-origin Reflection capability/read adapter; bounded parsing and candidate metadata only. No account inventory, management credential, remote probes or mutation. |
| New `server/Machines.ts` | Own validated durable configuration, stable IDs, revisioned mutations, setup attempts and per-request immutable connection snapshots. The gateway asks it for a configured destination; settings routes do not manipulate a second map. |
| `server/PeerConfig.ts` | Reuse existing endpoint/ID/name/token validation. Preserve the 32-peer bound and fail-closed legacy file behavior. Separate validation from startup file loading as needed. |
| `server/PeerGateway.ts` / `Router.ts` | Look up live configuration per new request, never retarget one in flight. Reuse/expose a bounded server-only peer check. Read `/api/machines` from the same authoritative service. |
| `shared/http.ts` / `shared/machine.ts` | Typed main-only setup/check/add/rename/remove contracts and safe summaries. Keep ordinary machine lists as IDs/names; no credentials, file paths or raw discovery text. |
| Settings routes/page and `MachineHost` | Add `/settings/machines`; refresh configured machines after a mutation and on tab re-entry/focus. Reconcile removals and unknown IDs without substituting Local. |

**Persistence recommendation:** keep managed non-secret configuration in main's database through a
private store, not the session registry projection; store imported tokens in owner-only files with
server-generated paths. Reuse existing private-file checks. Stage a new credential file before
atomically committing its reference; failed saves clean up staged files, and recovery handles
orphans without deleting a referenced credential. Secrets are not Pi settings and must not enter
Pi/preview environment variables. Owner-only files do not sandbox Pi processes running as that
same trusted OS user; retain the existing same-owner trust model. [L2, L3, L6]

**Legacy configuration:** when `PIANO_PEER_CONFIG` is explicitly set, retain an externally managed,
read-only mode, visibly explained in Settings. Do not silently modify that arbitrary file or merge
two competing sources. A later explicit migration may preserve its IDs and import its credentials;
removing that startup override/restarting is an operator action, never an automatic UI restart.
The normal managed mode needs no restart for add/remove/rename/token replacement. [L1, L2]

**Identity and concurrency:** generate a stable ID once; renaming the label keeps it. A different
target requires a new identity, not repointing/recycling an ID whose routes/drafts/browser memory
refer to the old backend. Reject duplicate IDs/names and normalized duplicate connections; do not
claim two different proxy aliases can be deduplicated without target identity. Mutations carry the
observed configuration revision, so a stale tab cannot overwrite another tab's changes. [L2, L3]

For removal or token replacement, invalidate the old connection generation, block new requests
through it and close its local observers/relays. Never stop the remote Pi, resend a prompt, switch
the selected machine to Local, or report an interrupted mutation as definitely undelivered. Keep
late answers tied to the old generation. A removed machine's page becomes unavailable with an
explicit navigation choice; clean up its browser memory only after an authoritative list refresh.
Renaming must not disconnect unrelated work. [L3, L4]

**Security:** main-only Host/Origin/CSRF checks apply before discovery/check/mutation. Accept fixed
connection shapes, not arbitrary probe URLs; reject userinfo, paths, query/fragment, redirects and
production HTTP. Keep direct-token destinations restricted to canonical exe.dev VM HTTPS hosts;
validate integration names as single DNS labels before constructing the proxy hostname. No probing
unrelated attachments, broad management OAuth, browser-cookie forwarding, TLS bypass or tokenless
fallback. Bound candidate counts, bytes, concurrency, setup-attempt lifetime and timeouts. A
connection check is an SSRF boundary, not an exception to destination validation. [L2, L3, L6]

Before implementation, amend ADR 0004's explicit exclusion of discovery/machine CRUD and its
startup-only activation/rotation rule. Preserve INV-01/02/05/07/11/12; remote ownership, main-origin
browser traffic, fixed relay routes and same-owner/private access do not change. This does not
implement the roadmap's general remote/multi-user product. [L3, L6]

## Acceptance checks and delivery sequence

These are **proposed checks, not executed results**. Claim: a user can add an explicitly chosen,
authorized same-owner peer through either path without guessing a destination or restarting main.
The smallest discovery counterexample is an ordinary proxy and a peer with the same published
fields; the current schema cannot distinguish them. Do not ship an unqualified machine picker
until a supported descriptor or explicit target-confirmation step resolves that ambiguity. [R]

1. **Discovery contract:** get platform clarification or explicitly authorized scratch fixtures
   for ordinary proxy vs peer serialization, disabled integration listing, custom port, tag/auto
   attachments, removal, and step-up. Record exact field names/types; an observed extra field alone
   is not a stable public guarantee. Until then retain confirmation/manual fallback.
2. **Fail closed:** missing Reflection, timeouts, redirects, HTML, invalid/oversized JSON, missing
   fields and empty lists leave startup usable and manual add available. Malicious `help`/comments
   never execute commands, change a destination, or cause arbitrary requests.
3. **Candidate correctness:** no account-wide enumeration or probes of unrelated services. A
   confirmed candidate must match an explicit target/port and pass a bounded application-specific
   connection/identity check before it is called a connected machine; plain HTTP 200 is insufficient.
   If adding the descriptor, check wrong/changed instance identity, malformed/oversized responses,
   old-peer fallback and malicious advertised URLs/Origins: none may change the dialed endpoint.
4. **Transport evidence:** on separately authorized scratch resources, check root/default port
   and explicit `:8001`, actual Host/Origin handling, HTTP and WebSocket behavior, and rejection of
   wrong-VM/expired tokens. Peer docs establish HTTPS calls, not every application's socket policy.
5. **Authority boundary:** no management token, account SSH private key, browser cookie harvesting,
   or `help` parsing. Manual VM tokens stay backend-private; deny redirects/credential forwarding.
   Distinguish local removal, integration detachment, and platform credential revocation.
6. **Persistence/activation:** extend the existing config/token/gateway module coverage for failed
   saves, secret redaction, restart durability, stale two-tab writes, immediate add, rename without
   disconnect, removal/rotation during HTTP and WS traffic, and no fallback/replay. Existing
   `PeerGateway`, `PeerToken`, `Peers`, `MachineMemory` and `MachineOffers` tests cover much of the
   transport/ownership baseline, but not dynamic setup. [L7]
7. **User journey:** extend the existing remote browser journey with main-only Settings discovery
   selection, manual token entry, immediate picker refresh, reload and active-peer removal; cover
   disabled discovery and failing checks. Use fixture Reflection and dummy tokens on scratch Piano,
   then separately authorize a real hosted-main and outside-main HTTP/WS smoke check. Fake tests
   do not prove platform authentication or custom-port forwarding. [L7]

Implementation sequence: (1) settle the discovery descriptor/fallback and ADR change;
(2) managed configuration and manual add with dynamic activation;
(3) startup detection and discovered selection; (4) run `npm run verify -- <evidence-directory>`
and the affected scratch browser journey, then separately authorized live platform checks.
No new Pi runtime, fleet-management layer or general pairing protocol is needed.

**Research verification:** source/schema/link review and whitespace checks only; no runtime or
tooling directives changed. The live observation establishes only this VM's Reflection shape,
not target identities, peer compatibility or connection behavior. Module/app tests were not run
for this documentation-only change. All implementation/connection acceptance checks remain open.

## Sources

External pages accessed 2026-11-17. The consolidated document was searched for startup detection
and metadata references. The separate live observation used the two fixed Reflection paths above
with TLS verification, redirects/proxies disabled, a five-second timeout and a 64 KiB response cap;
only status, field names, known type literals and counts were emitted. It granted no new access.

[I]: https://exe.dev/docs.md
[R]: https://exe.dev/docs/integrations-reflection.md
[G]: https://exe.dev/docs/integrations.md
[H]: https://exe.dev/docs/integrations-http-proxy.md
[V]: https://exe.dev/docs/integrations-vm-to-vm.md
[A]: https://exe.dev/docs/integrations-attach.md
[P]: https://exe.dev/docs/proxy.md
[T]: https://exe.dev/docs/https-tokens-for-vms.md
[K]: https://exe.dev/docs/https-api-local-key.md
[M]: https://exe.dev/docs/https-api.md
[S]: https://exe.dev/docs/integrations-step-up.md
[C]: https://exe.dev/docs/cnames.md
[F]: https://exe.dev/llms-full.txt

- **I:** [Docs index][I]. **R:** [Reflection integration][R]. **G:** [Integrations][G].
- **H:** [HTTP proxy integration][H]. **V:** [VM-to-VM integration][V].
- **A:** [Attaching integrations][A]. **S:** [Step-up approval][S].
- **P:** [HTTP proxies][P]. **C:** [Custom domains][C].
- **T:** [HTTPS tokens for VMs][T]. **K:** [Local token signing][K]. **M:** [HTTPS API][M].
- **F:** [Consolidated official documentation][F].

Piano source inspection at the baseline above (implementation recommendations are proposals):

[L1]: ../remote-piano.md
[L2]: ../../server/PeerConfig.ts
[L3]: ../adr/0004-same-owner-piano-peer.md
[L4]: ../../web/src/components/MachineHost.tsx
[L5]: ../quiet-ui.md
[L6]: ../development-invariants.md
[L7]: ../testing.md

- **L1:** [Remote Pianos][L1], current hosted/laptop setup and deliberate limits.
- **L2:** [PeerConfig][L2], [main](../../server/main.ts), [Router](../../server/Router.ts),
  [PeerGateway](../../server/PeerGateway.ts), [machine schemas](../../shared/machine.ts) and
  [HTTP contracts](../../shared/http.ts): actual startup/configuration and transport boundaries.
- **L3:** [ADR 0004][L3], accepted ownership, credentials, activation and browser-memory rules.
- **L4:** [MachineHost][L4], [SettingsPage](../../web/src/components/SettingsPage.tsx),
  [routes](../../web/src/lib/routes.ts), [machine offers](../../web/src/lib/machineOffers.ts) and
  [machine memory](../../web/src/lib/machineMemory.ts): current UI ownership and loading.
- **L5:** [Quiet UI][L5], Settings components and action naming.
- **L6:** [Invariants][L6], [roadmap](../roadmap.md) and
  [RegistryDatabase](../../server/RegistryDatabase.ts): private same-owner scope and persistence.
- **L7:** [Testing policy][L7]; inspected [PeerGateway tests](../../test/PeerGateway.test.ts),
  [PeerToken tests](../../test/PeerToken.test.ts), [Peers tests](../../test/Peers.test.ts),
  [MachineMemory tests](../../test/MachineMemory.test.ts) and
  [MachineOffers tests](../../test/MachineOffers.test.ts). See the existing
  [remote journey](../../test/browser/remote-session.mjs) and [verification map](../../.agents/skills/verify-piano/features/README.md).
