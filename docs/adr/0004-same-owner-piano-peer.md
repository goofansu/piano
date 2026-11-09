# ADR 0004: Same-owner remote Piano through exe.dev private access

Status: proposed; accepted when merged.

One developer already runs independent private Pianos on their exe.dev VMs. For the first
remote-conversation slice, the main Piano proxies explicitly configured peers running the same
Piano version:
through exe.dev's scoped HTTP-proxy peer integration from an attached VM, or directly through
exe.dev's HTTPS proxy with a VM-scoped token from the developer's laptop. Pi RPC remains local to
each owning backend. This supersedes the system-OpenSSH recommendation in the
[practical runner research](../research/2026-10-14-practical-remote-runners.md) for this slice:
existing private integration access avoids a second tunnel/authentication lifecycle and does not
turn Piano into a fleet manager.

## Boundary and consequences

- The peer owns its sessions, Pi processes, files, credentials, history and database. The main
  backend routes a bounded connection, never imports history or starts a local substitute
  (INV-01/02). Disconnect closes an observer, not the remote host; only explicit conversation
  actions affect the run. Neither gateway nor browser replays prompts.
- The browser speaks only to its current origin. Main validates Host, browser Origin and
  `Sec-Fetch-Site` before dialing; upstream receives the configured target Origin, not the
  browser's headers or the integration hostname. Only configured destinations, the remote's
  `/ws/peer`, its two slash-command reads and its default-model save (the model picker's defaults,
  checked against the remote's own catalog) are routed, as `RemoteRequests` in `shared/http.ts`
  lists them; redirects, unknown IDs and other endpoints fail closed (INV-11).
- The peer decides the slice, not the gateway. Main attaches at the peer's `/ws/peer`, where the
  peer admits only its registered sessions and the slice's actions, and answers every refusal with
  that request's ordinary reply in its own delivery sequence. The gateway is a bounded,
  authenticated pipe: it neither filters requests nor injects or renumbers frames, so a refusal
  never has to end the connection. A separate path, not a header, marks the connection: nothing in
  transit can strip it, and a peer without it fails closed. Folder trust is outside the slice, since
  it runs project extensions on the peer. Slash commands come from two reads: a running
  session's own read needs no peer mode, because the peer resolves its IDs in its own registry;
  a saved session's folder read goes to the peer's `/api/peer/commands`, which answers only for a
  registered folder, with the path in the POST body. No browser-supplied
  cookies or bearer tokens, or developer credential environment, are copied to the peer.
- This is the existing trusted-developer boundary: the same owner controls both Pianos and the
  attached peer integration or VM token. exe.dev supplies private access and authentication. It is
  not multi-user authorization, a sandbox or enrollment. Target configuration is a trusted
  identity assertion, not cryptographic attestation of a VM.
- Laptop access adds an explicit backend-owned credential file per VM, read at startup and wrapped in a
  redacted value. Only the configured direct HTTPS VM endpoint receives the token, on both HTTP
  and WebSocket handshakes, via `X-Exedev-Authorization`; exe.dev strips it before the target.
  The browser sees neither the token nor its file path. The token grants VM-wide HTTPS access,
  not Piano/port-specific permission. Missing/expired/revoked credentials fail closed, with no
  tokenless fallback or mutation replay. Rotation requires an explicit local backend restart;
  provisioning and revocation stay outside Piano (INV-02/11).
- Startup configuration accepts a bounded `peers` list, retaining the single-peer object format.
  IDs and display names are unique; one invalid entry refuses startup rather than admitting a
  partial set. Runtime unavailability is independent: each request/socket captures one peer,
  including its Origin and credential, and never falls back to another. This is a configured
  switcher, not discovery, machine CRUD or cross-machine orchestration (INV-07/11).
- Machine IDs qualify navigation and own separate client, draft, question-reply and catalog
  instances (INV-07). Drafts remain page-memory only. Remote catalogs are not persisted; local
  caches and surface memory remain local. Unsupported remote views never reuse local HTTP APIs.
- Reuse the existing session projection, composer, model/context controls and Pi dialog claims;
  preserve the peer's generation, sequence and delivery frames (INV-04/05). The browser remains
  the only reconnect owner. Gateway disconnect/failure does not promise whether an in-flight
  prompt was received: inspect the next snapshot before manually retrying.
- Compatibility means main and peer run the same Piano revision; the registry frame is still
  checked on connection (INV-12). Peers are upgraded with main: one deploy updates every machine.
  There is no version negotiation; a peer without `/ws/peer` is unavailable. Fake-Pi and live peer evidence are separate from real-runtime
  compatibility; deployments must verify their specific peer versions.

The slice lists the peer's existing registered sessions, opens history/state, sends text, streams,
answers dialogs and stops. It also starts a session with a text first message in a folder or worktree
the peer already registered: the peer admits that creation without a worktree, project, name,
dispatch ancestry or attachment, and its selection then takes the slice's actions. The model
picker saves the peer's default model and effort for new sessions through the peer's own settings
endpoint, which checks the model against the peer's catalog; Pi on the peer owns the file. Registering
folders, worktree creation, machine CRUD/provisioning, cross-machine projects or search,
files/Changes/attachments/previews and other remote settings/accounts are out. Parallel worktree sessions
come from a remote session's own dispatch, which runs on the peer.
[Setup and limits](../remote-piano.md) describe the exact startup configuration.
