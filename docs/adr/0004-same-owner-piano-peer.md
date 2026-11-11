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
  `/ws/peer`, its two slash-command reads, its [session surfaces](#session-surfaces-changes-files-and-the-session-rail)
  and its default-model save (the model picker's defaults,
  checked against the remote's own catalog), plus the fixed image routes below are routed.
  `RemoteRequests` in `shared/http.ts` lists the JSON requests; `shared/remoteImages.ts` names the
  image routes. Redirects, unknown IDs and other endpoints fail closed (INV-11).
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
  caches remain local, and each machine's remembered Surface tabs are kept apart from every
  other's. Unsupported remote views never reuse local HTTP APIs.
- Reuse the existing session projection, composer, model/context controls and Pi dialog claims;
  preserve the peer's generation, sequence and delivery frames (INV-04/05). The browser remains
  the only reconnect owner. Gateway disconnect/failure does not promise whether an in-flight
  prompt was received: inspect the next snapshot before manually retrying.
- Compatibility means main and peer run the same Piano revision; the registry frame is still
  checked on connection (INV-12). Peers are upgraded with main: one deploy updates every machine.
  There is no version negotiation; a peer without `/ws/peer` is unavailable. Fake-Pi and live peer evidence are separate from real-runtime
  compatibility; deployments must verify their specific peer versions.

The slice lists the peer's existing registered sessions, opens history/state, sends text and raster
images, streams, answers dialogs and stops. It also starts a session with text, images or both in
a folder open on the peer or one of its worktrees (a closed folder stays closed): the peer admits
that creation without a worktree, name or dispatch ancestry, optionally joining one of the peer's
[projects](#projects-the-peers-own-managed-from-main), and its selection then takes
the slice's actions. The model picker saves the peer's default model and effort for new sessions
through the peer's own settings
endpoint, which checks the model against the peer's catalog; Pi on the peer owns the file. Registering
folders, worktree creation, machine CRUD/provisioning, cross-machine projects or search,
managed app previews, session sharing and other remote settings/accounts are out. Voice input is the
main-origin composer utility defined below, not a remote service. Parallel worktree sessions
come from a remote session's own dispatch, which runs on the peer.
[Setup and limits](../remote-piano.md) describe the exact startup configuration.

## Projects: the peer's own, managed from main

Switching machines shows that machine's sessions and its projects. Each Piano's projects live in
its own database, and the peer already sends them with its session list, so the Projects index, a
project's home and the sidebar's project groups are the views Local shows, read from the peer's
list. There are no cross-machine projects: a project names sessions of one machine, and two
machines' projects with the same name are unrelated (INV-01/07).

- The peer admits creating, renaming, instructing, marking done and deleting a project, moving
  one of its listed sessions into or out of one, and starting a session that joins one. Its
  registry checks each as it does for its own browser: an unknown project is refused, and deleting
  a project keeps its sessions. Dispatch's inherited membership stays on the peer, where the parent
  session is.
- This widens what main may write on the peer beyond starting sessions and saving the default
  model. Project instructions join Pi's system prompt for the project's later sessions, including
  ones started on the peer itself. The trust boundary is unchanged: the same owner already sends
  prompts to those sessions from main.
- The peer admits rename, pin, archive and delete of a session it lists, so a remote session's
  menus are Local's. Rename starts the session's Pi when it is stopped, because Pi owns the name;
  archive and delete stop it, and delete removes its history on the peer. Each is the explicit
  action of the same owner, behind the dialogs Local shows. Sharing stays with the peer's Piano:
  it publishes through the peer's Radius sign-in over HTTP, which the gateway does not route.
- The session header is Local's. Its Artifacts menu and the phone sheet's Pull request row are
  links out of Piano to URLs the peer already sent with the session and its list; they add no
  request to the peer. The app preview, which needs the peer's status read and Stop, stays out.

## Session surfaces: Changes, files and the session rail

A remote session shows what a Local one does, except its managed app preview and sharing: the
session rail (Environment and Outputs), Changes with its comparison and pull request, and files
opened from the transcript, Changes or Outputs. This supersedes the earlier limit that a remote
grants no workspace file access.

- Git, GitHub and the files stay on the peer (INV-01). Main relays the peer's own endpoints for
  the Changes read, one file's patch, the saved comparison, written paths, the pull request read
  and change, and a file's preview and download. `RemoteRequests` in `shared/http.ts` lists them
  with their limits. The peer resolves workspace and session IDs in its own database, as for its
  own browser; main checks IDs, method, body shape and size before dialing, and nothing else.
- A file read follows the peer's own rule: a path may leave the workspace, including an absolute
  path, so main can read any file the peer's user can, within the preview formats and sizes. This
  is the same owner's access on a machine they already send prompts to (INV-11), not a sandbox.
- JSON answers are read whole under a per-request limit and checked against the endpoint's
  response before they reach the browser. A file is relayed as the peer sent it, with only its
  content type and attachment name: no cookie, redirect or compressed body, at most two files in
  flight per peer and no queue. A larger, slower or malformed answer is the peer unavailable,
  never a partial one. No request is retried.
- The peer's refusal reaches the browser in its own words where only the peer can know the reason
  (a missing file, a comparison it cannot save, GitHub's answer).
- The pull request uses the peer's GitHub sign-in. Linking, finding and removing a link change
  the peer's database.
- Every browser request names the machine it is for, captured where it is made; a remote's
  request never falls back to Local's endpoint with the remote's IDs (INV-07).
- Main and peers deploy together (INV-12). An older peer answers these as it always did; an older
  main never asks.

## Raster images: separate preparation, unchanged conversation ownership

This extends the original text-only slice, not general file access. Dictation has its separate
main-origin boundary below. Both composers
use the existing PNG/JPEG/GIF/WebP policy: ten images, 10 MiB each, 50 MiB combined original bytes.
Raising the conversation WebSocket cap would put Stop, dialog answers and heartbeats behind
base64 uploads on slow links. Keep that cap at 1 MiB and use a separate bounded HTTP lane:

1. The browser captures its machine, draft, directory/session, selection and connection before
   sending. `POST /api/peer/images` streams a binary batch through main to that configured peer.
   Its length-prefixed JSON manifest names the target in the body, never a filesystem URL.
   Both hops count actual bytes before buffering; the peer checks registered identity, manifest,
   count/byte limits and every MIME/signature before returning a random preparation reference.
2. The peer holds only temporary memory, not files or database rows. Two batch slots reserve up
   to 100 MiB of original bytes; unclaimed references expire after ten minutes. This replaces
   the proposed temporary-file staging with a smaller bounded lifecycle: restart/teardown forgets
   preparations, without disk cleanup or another durable image store. See the exact
   [resource budgets](../runtime-input-limits.md#remote-image-http-lane).
3. Normal `act`/`create_session` carries a small `preparedImages` reference. PeerScope still
   refuses inline remote images. ClientDispatch rejects mixed inline/reference input, verifies
   that the reference was prepared for this session (or, before a session exists, for this
   folder or worktree), and consumes it once **before** starting
   Pi or creating a session. It resolves to the existing SessionAction images; PiRecords retains
   all Pi translation. A consumed slot stays reserved through operation settlement, including
   when the observer disconnects. Expiry/cancellation cannot release an in-flight input's slot.
4. Preparation failure or cancellation restores that draft ahead of newer typing. Navigation
   invalidates a captured send even if the user returns to identical IDs. Stop can cancel the
   pending upload while still stopping the conversation. Only known-unsent input is recoverable;
   a socket/write uncertainty never reuses a reference or automatically sends again. `inputId`
   correlates receipts; it is not deduplication (INV-02/03/04/07).
5. Transcript projection binds cached hashes to their observed session. The exact source-owned
   renderer URL becomes `/peer/<machineId>/api/peer/image-preview` with workspace/session/hash
   query values. The peer verifies registered session membership and cached provenance; it never
   reads an arbitrary history/file to satisfy an image URL. Thumbnails and full-image links use
   the same mapper. Bytes remain disposable (64 MiB cache); an evicted image can stay unavailable
   until the session is reopened. No Local fetch fallback, gateway frame rewriting, snapshot
   bytes or second transcript store (INV-01/05).

The third fixed route, `POST /api/peer/images/cancel`, discards an unconsumed reference. Lost
preparation results expire; no mutation is retried. HTTP lanes have independent concurrency,
byte and time limits, reject redirects and compressed bodies, and forward only configured
Origin/credentials and the required content type/length. Image reads return only raster MIME,
`private, no-store` and `nosniff`, never upstream cookies. Host/Origin/Sec-Fetch-Site admission
still precedes dialing (INV-11). Main and peer must upgrade together; there is no inline or Local
compatibility fallback (INV-12). Scratch fake-Pi, fault-injected and throttled evidence proves
Piano's boundaries, not external edge limits, real-device memory or provider image acceptance
(INV-09). Pi still owns processing, persistence and text-only queue restoration, including its
reported empty image-only queue entries.

## Voice input: main-origin assistance, machine-owned drafts

This amendment accepts the main-owned option in the
[remote-composer research](../research/2026-11-09-remote-composer-inputs.md). It deliberately does
**not** accept peer enrollment, machine CRUD or credential management proposed by the
[configuration research](../research/2026-11-09-peer-configuration-ui.md).

- Both composers use the browser's microphone and the main Piano's dedicated voice key and
  preference. Main can itself be a VM. Only main-origin `GET /api/settings/voice-input` and
  `POST /api/voice/transcribe` are composer utilities on remote views; they are explicit, never
  peer-to-Local fallback. Settings writes remain in **Local → Settings → Preferences**. Its
  **Voice input** toggle controls existing-session and New-session composers on Local and all
  peers: off hides every idle microphone; on shows them. Active Stop/Cancel controls remain
  available; turning the preference off does not cancel an operation. This visibility amendment
  supersedes the off-state remote setup shortcut, not dictation ownership or draft isolation
  (INV-01/07/11). Verify off/on/off across both composers on Local and peers. No voice route is
  added to the peer allowlist, and no peer/OpenAI credential enters a conversation (INV-01/11).
- Recordings and source project/folder/branch/session spelling hints go browser → main → OpenAI
  (`gpt-transcribe`). The key dialog discloses that this applies to every machine. Audio is
  ephemeral input assistance, not an attachment or history. Only the reviewed draft text reaches
  the peer on explicit Send; the existing image lane and 1 MiB conversation cap are unchanged
  (INV-01/02/04).
- The page-lifetime controller captures the source draft **store and key** and an operation's
  cancellation identity. Colliding IDs on different machines cannot share results. One live
  microphone/permission acquisition is allowed per page. Navigation or hiding the page cancels
  uncommitted recording; late grants release all tracks. Stop commits immediately and snapshots
  hints before final recorder events. Transcription then survives ordinary navigation and appends
  to its original hidden draft, or replaces the visible draft's current selection. A result after
  Send becomes an unsent addition, not another prompt. Late render work cannot focus a different
  field or displace newer typing (INV-02/07).
- Explicit **Cancel recording**, **Cancel transcription**, pagehide or host teardown releases
  resources and aborts pending transcription; stale successes/errors cannot settle a replacement
  operation. Cancellation cannot promise provider work or charges were prevented. No automatic
  retries. Constructor/start/recorder/track failures discard audio and preserve the draft.
- Actual recording bytes, main HTTP ingestion before JSON parsing, concurrent work, provider
  response bytes/text and deadlines are bounded; see [voice budgets](../runtime-input-limits.md#voice-input).
  These are resource limits, not a guarantee about browser heap on delayed mobile chunks or a
  transcription provider's entitlement/quality. Fake devices/providers establish Piano ownership
  and failure handling; real microphone, codecs, mobile background/lock and paid-provider behavior
  require separate evidence (INV-09/11/12).
