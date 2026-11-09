# ADR 0004: Same-owner Piano through an exe.dev peer integration

Status: proposed; accepted when merged.

One developer already runs independent private Pianos on their exe.dev VMs. For the first
remote-conversation slice, the main Piano proxies one explicitly configured same-protocol peer
through exe.dev's scoped HTTP-proxy peer integration; Pi RPC remains local to each owning
backend. This supersedes the system-OpenSSH recommendation in the
[practical runner research](../research/2026-10-14-practical-remote-runners.md) for this slice:
existing private integration access avoids a second tunnel/authentication lifecycle and does not
turn Piano into a fleet manager.

## Boundary and consequences

- The peer owns its sessions, Pi processes, files, credentials, history and database. The main
  backend routes a bounded connection, never imports history or starts a local substitute
  (INV-01/02). Disconnect closes an observer, not the remote host; only explicit conversation
  actions affect the run. Neither gateway nor browser replays prompts.
- The browser speaks only to its current origin. Main validates Host and browser Origin before
  proxying; upstream receives the configured target Origin, not the browser's headers or the
  integration hostname. Only configured destinations and the slice's operations are admitted;
  redirects, unknown IDs and unsupported endpoints fail closed (INV-11). No browser cookies,
  bearer tokens or developer credential environment are copied to the peer.
- This is the existing trusted-developer boundary: the same owner controls both Pianos and the
  attached peer integration. exe.dev supplies private access and peer authentication. It is not
  multi-user authorization, a sandbox, enrollment, or VM-token/laptop authentication. Target
  configuration is a trusted identity assertion, not cryptographic attestation of a VM.
- Machine IDs qualify navigation and own separate client, draft, question-reply and catalog
  instances (INV-07). Drafts remain page-memory only. Remote catalogs are not persisted; local
  caches and surface memory remain local. Unsupported remote views never reuse local HTTP APIs.
- Reuse the existing session projection, composer, model/context controls and Pi dialog claims;
  preserve the peer's generation, sequence and delivery frames (INV-04/05). The browser remains
  the only reconnect owner. Gateway disconnect/failure does not promise whether an in-flight
  prompt was received: inspect the next snapshot before manually retrying.
- Compatibility means the configured peer speaks the current registry/session protocol, checked
  on connection, not that any Piano/Pi release works (INV-12). No target upgrade or protocol
  handshake extension is required. Fake-Pi and live peer evidence are separate from real-runtime
  compatibility; deployments must verify their specific peer versions.

The slice lists the peer's existing registered sessions, opens history/state, sends text, streams,
answers dialogs and stops. Remote creation, machine CRUD/provisioning, cross-machine projects or
search, files/Changes/attachments/previews/worktrees and remote settings/accounts are out.
[Setup and limits](../remote-piano.md) describe the exact startup configuration.
