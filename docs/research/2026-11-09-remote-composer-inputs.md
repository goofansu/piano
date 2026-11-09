# Images and voice input in remote composers

Research date: **2026-11-09**. **Proposal, not implemented or accepted policy.**
Piano source baseline: `4c15e8485f0c7d023f56d96107510a0aeec96e77`.
The lockfile resolves Pi Coding Agent **1.5.0**, Effect and platform-node **4.1.2**;
matching installed packages in `/home/exedev/piano/node_modules` were inspected read-only.
This dedicated research worktree has no installed dependencies. Source inspection and
public documentation establish the findings below, not runtime compatibility. [C1]

## Recommendation

1. Support **the existing raster image policy**, on both New session and existing remote
   sessions: button, paste, drop, image-only, steering and follow-up. Do not call this
   general file upload support. Keep Pi responsible for processing and history.
2. Treat voice as **main-Piano dictation into a machine-owned draft**. Use the main
   Piano's existing dedicated OpenAI key; send only the reviewed text to the peer when
   the user presses Send. Do not add remote transcription/settings proxy routes for this slice.
3. Fix ownership before exposing controls: the existing dictation singleton writes into
   **Local's draft store**, unlike the machine-partitioned composer. Simply removing
   `!remote` is unsafe, including when two machines have identical session IDs/paths.
4. For images, prefer a **bounded HTTP preparation lane on the owning peer**, followed
   by a small, one-use reference in the ordinary session action. Keep the conversation
   WebSocket responsive. Reusing inline images is fewer changes, but raising the gateway's
   1 MiB cap alone cannot safely deliver the accepted 50 MiB batch over slow remote links.
   Choose the transport explicitly before implementation; the staging design below is a
   recommendation, not a new storage requirement already accepted by the project.
5. Add only narrowly addressed image-preparation and transcript-image reads. Do not
   enable workspace files, managed app previews, arbitrary URL fetching, remote accounts,
   folder trust or general remote settings as a side effect.

These recommendations extend the deliberately text-only slice in
[ADR 0004](../adr/0004-same-owner-piano-peer.md) and [remote Piano](../remote-piano.md).
An implementation must amend that boundary decision, not quietly widen it. Preserve
[ADR 0001](../adr/0001-pi-rpc-workspace-workbench.md), the
[invariants](../development-invariants.md) and [roadmap](../roadmap.md):
**INV-01** Pi/history ownership; **INV-02/03** no replay and Pi-owned dispositions/queues;
**INV-04/05** responsive dialog controls and ordered snapshots;
**INV-07** machine/workspace identity; **INV-09** bounded evidence;
**INV-11** private access, credentials and untrusted content;
**INV-12** same-revision peers and tested Pi compatibility.

## Observed image path and blockers

| Boundary | Current behavior and exact blocker |
| --- | --- |
| Browser acquisition | Both `Composer` and `NewSessionComposer` use `DraftEditor`. It hides Attach and Voice when remote and disables `attachmentEvents` for remote. Paste/drop with files are prevented but not added; the hidden file input cannot help. `AttachmentDraftView` itself is not remote-gated. [C2], [C19] |
| Draft | `useDraftEditor` uses `useDrafts`; `MachineHost`/`machineStores` give each machine its own page-memory store. [C20], [C21] `addImages` captures that store and draft key across file reads. Signature/MIME, size/count/aggregate checks run before base64 encoding; an invalid addition preserves accepted images. Drafts are not persisted. [C3] |
| Existing-session send | `composerControl.messageCommand` includes attachments in `act` (`prompt` or `steer`); `PiRecords` maps them to Pi `prompt.images`, using `streamingBehavior: followUp` or `steer`. No new Pi provider adapter is needed. [C4], [C5] |
| New-session send | `newSessionCommand` already includes attachments in `create_session`; readiness allows an image without text. `ClientSessions.create` opens/attaches first, then delivers the first prompt with attachments. A later invalid-image rejection can therefore leave a created session; creation and prompt acceptance are separate. [C4], [C6] |
| Browser → main → peer | The machine client uses `/peer/<machineId>/ws`; main connects only to the configured peer's `/ws/peer`. `PeerGateway` forwards original frames, but admits at most **1 MiB** per client message and outbound buffered data. It decodes the wire schema, not the peer's action policy. [C7], [C8], [C22] |
| Peer admission | `PeerScope.actionAllowed` rejects nonempty attachments on prompt/steer. `creationAllowed` also rejects them. Registered directory/session and selection checks are separate and must remain. `ClientDispatch` sends ordinary sequenced refusals rather than gateway-invented frames. [C9] |
| Peer → Pi | Shared wire schema bounds image batches; `PiRecords.imagesValid` additionally requires canonical base64 and matching raster signature/MIME. PiSessions owns act/acknowledgement, queue and history; PiTransport owns stdin capacity/deadlines. [C5], [C10], [C24] |
| Transcript → browser | PiRecords projects image blocks to `/api/image-previews/<sha256>`. `ImagePreviews` is a **64 MiB** disposable byte cache, repopulated from Pi history; saved-history workers return preview bytes to the backend. Router serves image bytes with `private, no-store` and `nosniff`, or 404 after eviction. The cache currently has no session-membership binding. [C11], [C23], [C30], [C31] |
| Remote thumbnail/full image | `MessageAttachments` hides the whole group remotely. Removing that guard alone would fetch the **main's** root-relative image URL. Neither `peerApiPath` nor the gateway HTTP allowlist accepts image reads. Both the thumbnail and its Open attached image link need a machine-owned URL. Workspace-file links remain independently disabled. [C7], [C19], [C22] |

The accepted [image policy](../image-attachments.md) is PNG/JPEG/WebP/GIF, **ten images,
10 MiB each, 50 MiB total original bytes**; all limits apply, including exact boundaries.
Base64 is about 66.67 MiB before JSON. No SVG, HEIC, PDF, text, audio or arbitrary binary
kind is accepted by the image wire type. Valid raster signatures are not proof of successful
pixel decoding or provider acceptance. Pi may resize, omit or reject images according to
its settings/model; a browser preview is not proof of model receipt. [C5], [C10]

### Image-only and queued messages

Existing local contracts already allow images without text, including queued input. Restore
queue/Edit and Stop restore **text only**; pending image queues survive browser reconnect
while Pi lives, not a Pi/backend restart. Never add a browser-owned queue or reconstruct
attachments from optimistic rows. [C3], [C4], [C5], [C12]

The policy records Pi 1.2.0's image-only empty-row issue. Inspection of installed **1.5.0**
`dist/core/agent-session.js` still finds `_queueSteer`/`_queueFollowUp` storing text separately
and removal guarded by `if (messageText)`: an empty message cannot enter that removal branch.
This is source evidence of the same risk, **not a fresh runtime reproduction**. Preserve
Pi's reported empty entry/pending count; Edit/Stop uses Pi's clear-queue API. Including text
avoids the documented problem; do not silently inject text or hide the row. [P1], [C12]

### Not general file support

The [file research](2026-10-14-file-attachments.md) proposes conversion to Pi text/images;
the [text-validation follow-up](2026-10-15-text-file-validation.md) proposes strict UTF-8,
NUL-free text with a 1 MiB per-file resource ceiling and a separate unresolved aggregate/context
budget. Those are proposals, not current composer capabilities; their historical image counts
and transport figures are superseded by the current policies above. Remote image transport must
not accidentally accept those new kinds. Voice recording is an ephemeral transcription input,
not an audio attachment sent to Pi. PDF conversion, arbitrary files, disk-path staging for
Pi tools, OCR and video understanding are separate deliverables.

## Observed voice path and ownership choice

Today the microphone uses browser `getUserMedia({audio:true})` and `MediaRecorder`, preferring
WebM/Opus, WebM, MP4, then Ogg/Opus when supported. Stop collects a Blob, FileReader base64-encodes
it, and `api.transcribe` posts JSON to **`/api/voice/transcribe` on the main origin**. There is
no peer route. `VoiceInput` reads the dedicated enabled/key preference in Piano's database,
decodes audio, and sends multipart to `https://api.openai.com/v1/audio/transcriptions` with
`model=gpt-transcribe`, `response_format=json` and spelling hints. It returns trimmed text,
not audio/history. The key is server-side (sent to OpenAI), separate from Pi provider credentials;
the database schema uses a text column, not a claim of encryption at rest. No credential values
were read. [C13], [C14], [C15], [C27]

The settings singleton is page-wide and main-owned. Settings is not rendered on a remote machine.
The current key dialog already discloses “Voice input sends recordings and session context to
OpenAI.” Hints are project/folder/branch/session names, each clipped to 512 characters, read when
the recording stops. They can contain sensitive names; this is more than sending audio alone.
The returned transcript replaces the shown draft's current selection, or appends to its original
draft when hidden; it never auto-sends. [C13], [C14], [C16], [C28], [C29]

**Ownership defect if enabled as-is:** `VoiceInputButton` constructs one module-level
`createDictation({drafts})` using the imported Local singleton. Its keys contain cwd/session ID
(or just `new-session`), not machine ID. Machine-keyed React remounts do not repair the store
captured by that singleton. The composer has the right remote draft store; dictation does not.
The existing dictation tests cover switching sessions in one store, not identical keys in
independent machine stores. [C3], [C13], [C16], [C18]

| Choice | Setup, disclosure and limitations | Assessment |
| --- | --- | --- |
| **Main-Piano dictation** | Configure one dedicated key under Local → Settings → Preferences. Audio and captured remote spelling hints go browser → main → OpenAI; only text goes to the selected peer after Send. It may work while a peer is unavailable, but Send must stay unavailable. No remote key lookup or settings routing. | **Recommended minimum.** Explicit input-assistance service, not fallback execution. Document that “main” may itself be a VM, not the user's laptop. |
| Peer-owned dictation | Configure a separate key on each owning Piano's own UI; browser → main gateway → selected peer → OpenAI. Both backends handle audio in transit. Needs narrowly allowlisted state GET and transcription POST, per-peer state and 120-second-class deadlines, plus unavailable/setup behavior while remote Settings remains absent. | Choose only if per-peer billing/credential ownership is required. Never copy a main key to the peer or fall back to main when unavailable. |
| Browser-to-provider or browser SpeechRecognition | Changes credential/privacy/browser compatibility contracts; not the existing tested service. | Out of scope. Do not expose the OpenAI key or silently use another transcription provider. |

If the recommended ownership is accepted, record it explicitly in ADR 0004 as a main-origin
composer utility. It does not transfer ownership of remote Pi credentials, sessions or history.
Keep main voice-settings reads explicitly separate from `peerApiPath`: **not** “try peer, then
Local.” Update the remote browser journey's current blanket prohibition of `/api/*` requests to
permit only named main voice endpoints, while still rejecting local session/file fallthrough. [C17]

### Browser and provider requirements (external evidence)

- Microphone access requires a secure context and permission. HTTPS main-origin access or
  localhost qualifies; an arbitrary HTTP LAN address does not. The browser recording origin,
  not the peer's URL, requests permission. Embedded pages need the appropriate microphone
  Permissions Policy. Users may leave the permission promise pending indefinitely. [B1]
- `MediaRecorder.isTypeSupported()` is capability advice, not a guarantee that recording can
  start under current resources. Catch constructor/start failures, handle recorder `error` and
  track termination, and release all tracks/timers on every terminal path. The current adapter
  wires data/stop but not recorder errors; `createDictation` only catches microphone acquisition,
  not recorder construction/start. [B2], [B3], [C13], [C16]
- Stop delivers final data before the stop event. Keep that ordering and discard cancelled
  recordings even when late data/stop arrives. A timeslice enables periodic byte checks but is not
  exact; mobile locking/backgrounding can yield a much larger delayed chunk. Keep a wall-clock
  limit and count actual Blob bytes, not chunk count or estimated bitrate. [B3], [B4]
- Current OpenAI documentation **does list and recommend `gpt-transcribe`** for completed audio,
  supports context prompting, and returns transcription text. Do not replace it with an older
  model based on historical knowledge. The guide states 25 MB uploads; the API reference explicitly
  includes Ogg (and FLAC), although the guide's shorter list omits them. Piano's Ogg choice is
  supported by the API reference, but browser/container interoperability still needs evidence.
  Filename extension and content type must describe the actual recording, not just rename bytes.
  Existing mock-provider tests do not establish account access, format decoding or quality. [O1], [O2], [O3]
- OpenAI's current data-controls table lists `/v1/audio/transcriptions` as not used for training,
  with no abuse-monitoring or application-state retention, subject to its published controls and
  exceptions. Do not generalize this to Pi's coding provider or promise universal zero retention.
  Recording, hints, cost and selected service still require disclosure. [O4]

### Source-bound asynchronous work and teardown

**Preserve the intended existing behavior:** leaving a draft cancels permission acquisition/active
recording; a permission granted late has every track stopped immediately. Once the controller enters
`transcribing`, it continues and lands in the original draft even if another session is shown:
`cancel` deliberately ignores that phase. There is a source-level race to cover: `stop()` only calls
MediaRecorder.stop; the phase changes in its later stop event. Navigation in that gap can still
cancel an explicitly stopped recording. Mark the user's Stop commitment before awaiting final data,
while still waiting for that data before uploading. No AbortSignal currently reaches the
transcription fetch from this controller. [C13], [C16]

**Proposed contract:** put dictation controllers in the page-lifetime machine stores (or use
an equally explicit composite owner); capture `{machineId, draftStore, draftKey, operationId}`
plus the transcription service and hints. Keep them alive across machine switches just as drafts
are retained. Never derive a result destination from the currently selected machine. A late
result must not focus another machine's textarea, overwrite later typing or settle a newer
operation. Snapshot hints at Stop; New page directory changes must not relabel a recording
already committed for transcription. Pending file reads/uploads need the same source binding.

Add explicit disposal/abort support for page teardown and any user cancellation of a transcription,
without changing normal switch-after-Stop behavior. Abort cannot guarantee OpenAI did no work or
charged nothing; do not retry automatically. Recordings still active at navigation/unmount are
cancelled, not submitted. Handle page hiding/locking deliberately and test on real mobile hardware;
React unmount alone does not cover every browser lifecycle event. A transcript arriving after its
original draft was sent becomes a new unsent draft addition, never another prompt. Prefer one
active microphone per page even with independent machine controllers.

## Resource/transport constraints: why removing guards is insufficient

These are **current source constants**, not measurements on a remote connection. [C7], [C8], [C10], [C15], [C25], [C26]

| Boundary | Current capacity/deadline |
| --- | --- |
| Browser socket | No application byte-buffer admission in `SocketLike`; send acceptance is not server receipt. Connect 10 s; ping every 5 s after pong; matching pong due in **8 s**. |
| Main Node WebSocket parser and peer parser | `inboundLimits.frameBytes`: about **82.67 MiB** (50 MiB base64 + 16 MiB text/envelope allowance), including fragmented message; compression disabled. |
| Main peer gateway, browser → peer | **1 MiB** input/outbound buffered cap; 5 s connection/initial registry deadline; **10 s** upstream send callback deadline. Input over the gateway cap currently closes 1008, before forwarding. |
| Peer → main → browser | Gateway: 8 MiB frame/total unacknowledged bytes, 64 frames, 15 s acknowledgement deadline. Peer delivery: 8 MiB frames, 32-frame/8 MiB window, 256-frame/8 MiB queue, 10 s acknowledgement deadline. Images are URLs, not bytes in these snapshots. |
| Peer ordinary work | Per browser connection: 8 requests / two maximum messages. Per child actions/RPC requests/stdin writes: 32 each / two maximum messages. Reserved controls: 8 / 32 MiB per lane. These do not make controls overtake bytes already on a socket or stdin. |
| Pi acknowledgement | 30 s plus 1 s per whole MiB written, including write and acknowledgement; about 96 s for a 66.67 MiB image batch, more with text. Timeout is not proof of non-delivery. |
| Voice | 10-minute browser timer; schema allows base64 for **25,000,000 binary bytes** (~33.33 MB JSON audio). Provider operation timeout 120 s. No aggregate recording-byte check before FileReader, no service transcription-concurrency gate, no bounded provider-response reader. |
| HTTP bodies | Router reads `request.text` before schema validation. No configured `MaxBodySize` was found; installed Effect 4.1.2 defaults it to undefined and Node's text reader uses that setting. Wire/decoded-audio caps therefore do **not** bound pre-parse HTTP allocation. [C23], [E1], [E2] |

A 66.67 MiB WebSocket upload takes about **56 seconds at 10 Mbit/s**, before overhead
(arithmetic, not measured performance). Application pings, delivery acks and Stop queued behind
that data cannot meet 8/10/15-second deadlines. The gateway also waits serially for upstream
send completion. Per-child reserved lanes help only **after input arrives**. Merely changing
`clientBytes` to `frameBytes`, or raising every timeout, is not adequate control responsiveness.

### Transport decision and proposed bounded image preparation

| Approach | Cost and consequence |
| --- | --- |
| Inline base64 through existing WS | Smallest code diff; reuse current wire and PiSessions validation. Requires derived per-frame/aggregate caps at both hops, browser send admission, upload-aware liveness and slow-link control evidence. Large messages still block later application frames. Suitable only with an explicitly accepted lower remote limit/network envelope; not a claim of full current-policy parity. |
| **HTTP preparation, then a small WS reference** | More lifecycle work, but upload traffic does not sit ahead of a dialog answer/Stop in the conversation stream. Retains existing 1 MiB gateway input cap for reference-bearing actions and 8 MiB output cap. Pi stdin still receives bounded base64 locally. Recommended for the full 50 MiB policy. |

Proposed preparation contract, deliberately limited to raster images:

1. On explicit Send, freeze the original draft revision and target, validate locally, then upload
   the batch through main to **that peer**. Keep local preview/removal behavior; do not upload merely
   because a file was picked. Allow cancellation before prompt submission. New typing must not be
   consumed by the older send. If machine/session selection changes before the small WS submission,
   cancel that pending send and retain its original draft; never adopt the new selection ID.
   A successful upload alone must not create a Pi session.
2. Use a fixed POST route such as `/peer/<id>/api/image-inputs` → `/api/peer/image-inputs`.
   Stream bounded multipart binary rather than whole-batch base64 JSON through main. Bound actual
   bytes, part count, headers and metadata while reading (starting budget: ten file parts,
   50 MiB binary total plus 64 KiB framing/metadata), including missing/lying Content-Length
   and chunked bodies. Reuse the raster validator on peer; filenames are display labels, never paths.
3. The peer issues a random, short-lived batch handle, bound to an existing registered
   workspace/session or a registered directory plus pre-session draft nonce. Main does not persist
   image bytes. Peer temporary bytes are outside Git and Piano's database, inaccessible as arbitrary
   filesystem paths. This is disposable preparation, **not a second durable attachment/history store**.
4. A new bounded wire input reference is resolved by the peer before delivering the ordinary
   `SessionAction` with images through PiSessions; keep Pi-specific translation in PiRecords.
   `PeerScope` admits only this image capability on the already allowed prompt/steer/create paths.
   Reject mixed inline/reference ambiguity, wrong owner, expired/consumed handles and unlisted targets.
   Do not expose the peer's prepared-input resolver through a generic proxy action.
5. Claim the handle once for submission; retain its bytes/lease until the operation completes or
   transport closes, not merely until the browser disconnects. After Pi consumes or may have consumed
   it, never auto-reuse/replay. On a provably unsent refusal, return an explicit outcome and preserve
   the original browser draft for deliberate retry. Unknown creation/send requires inspecting the
   authoritative peer snapshot. `inputId` correlation is not general server-side deduplication.
6. Bound abandoned handles and clean them on expiry, cancellation and backend restart. Suggested
   initial budgets to validate: 10-minute unclaimed TTL; one upload in flight per draft; two active
   batch preparations and 200 MiB total staged originals per peer backend, with immediate busy
   rejection rather than waiting. Expiry must not delete an actively leased submission. Use generated
   private temporary names; cleanup must not depend on a live browser. Defaults are proposals, not
   measured operating limits; cap metadata/counts as well as bytes.
7. Give upload/read-idle and total deadlines separately (starting candidates: 30 s idle, 180 s total
   for 50 MiB), while retaining normal conversation heartbeat deadlines. Bound main relay concurrency
   and peer validation concurrency; release stream buffers on disconnect. Two TCP requests can still
   compete for bandwidth, so measure Stop/dialog latency under saturation. If those budgets cannot
   support the intended link, fail explicitly rather than quietly lower image quality or switch peers.

If the user chooses inline transport instead, keep HTTP staging out and make its missing slow-link
and memory evidence a release blocker; do not ship an unexplained lower limit. Neither option needs
new provider calls for images. Changing transport does not change original image limits or guarantee
provider acceptance.

### Narrow transcript-image proxy

Use a fixed GET route, e.g. `/peer/<id>/api/image-previews/<hash>?workspaceId=…&sessionId=…`,
backed by a **peer-only** image read. Strictly validate a 64-character hex hash, bounded IDs and
exact query keys/method; reject arbitrary paths, URLs, redirects, traversal and encoded separators.
The peer should verify the registered session and that the hash belongs to its projected history.
That needs provenance alongside the disposable cache, including the saved-history worker path;
the existing hash-only cache cannot prove membership. A content hash is not authorization. Do not
turn a cache miss into a fetch of an arbitrary local file or an unbounded history scan. Reopen/reselect
can repopulate; an unavailable preview is not permission to resend its prompt. [C11]

Map only exact recognized peer-relative image-preview URLs in the **source-owned renderer**; reject
absolute/unknown URLs rather than prefixing arbitrary transcript strings. Do not rewrite gateway
WebSocket frames or delivery IDs. Use that mapping for both `<img>` and full-image link, retaining
machine identity across navigation and cache keys. No Local fallback on remote 404/502, no main
copy of peer history, no main cache mistaken for the peer's cache.

Keep gateway Host/Origin/Sec-Fetch-Site checks, configured destinations and per-request immutable
credentials. Construct upstream headers from configuration only: no browser cookies, Authorization,
forwarded proxy headers or developer environment. Do not follow redirects; never forward upstream
Set-Cookie or arbitrary content headers. Return only raster MIME, bounded bytes, `private, no-store`
and `nosniff`; use bounded response streaming, cancellation and deadlines. The peer cache admits up
to **64 MiB per cached image**, unlike the 10 MiB original-upload ceiling: set/document an independent
preview response cap (initially 64 MiB to match existing behavior), bounded concurrency and aggregate
in-flight bytes. Do not reuse the gateway's 1 MiB JSON response reader. [C7], [C11]

### Voice hardening without a peer proxy

Before enabling remote dictation, bound main HTTP ingestion **before** `request.text`/JSON parsing:
base64 maximum plus an explicit envelope budget, enforce actual streamed bytes and canonical base64,
then the 25,000,000-byte decoded limit. Reject oversize Blobs before FileReader; use chunk accounting
and the existing wall-clock limit during recording. A timed or chunked recorder is not a hard browser
heap guarantee. Bound provider-response bytes/text and concurrent transcriptions (e.g. two active
per backend with immediate busy refusal); the current save semaphore serializes settings, not calls.
Propagate cancellation and retain the 120 s provider deadline; do not automatically resend on timeout.

If peer-owned voice is chosen later, only add `GET /api/settings/voice-input` (enabled/hasKey) and
`POST /api/voice/transcribe` through dedicated peer routes; keep settings writes denied. Validate and
limit both hops, preserve peer identity throughout, and choose an end-to-end deadline that covers
upload plus the provider deadline instead of the gateway's current 10 s HTTP timeout. Remote off,
missing key, provider denial and unreachable peer are distinct outcomes, never reasons to use Local.

## Scoped implementation sequence and acceptance evidence

No checks in this section have been executed by this research. Follow
[testing policy](../testing.md): public observable contracts, not private-helper choreography.

| Slice / bounded claim | Scope | Smallest useful checks, then scratch evidence |
| --- | --- | --- |
| **1. Dictation ownership and bounds** — text lands only in its source draft, never auto-sends | Machine stores, `VoiceInputButton`, dictation controller, main voice ingestion/service; keep provider/key model | Extend `Dictation.test.ts` and `Machine.test.ts`: Local + two peers with identical cwd/session and New keys; delayed permission, switch during recording, Stop→navigation before the recorder stop event, stop-then-switch during transcription, concurrent typing/send, late frame focus and cancellation. Extend `VoiceInput.test.ts` with real HTTP body-limit coverage, oversized/malformed audio, bounded response, timeout/abort/concurrency; stub provider, no real key. |
| **2. Image preparation/transport** — accepted bytes reach owning Pi once; invalid data never reaches Pi | Choose transport; narrow HTTP routes and peer input resolution if staging; preserve `PeerScope` restrictions, PiSessions seam and receipts | Extend `PeerScope.test.ts`, `Peers.test.ts`, `PeerGateway.test.ts`, `PiSessions.test.ts`, `DraftSubmission.test.ts`: image-only and text+image prompt/steer/create; exact/one-over count/file/total boundaries; signature/MIME/base64 denial; wrong peer/session/selection, duplicate/expired handle, cancellation/cleanup, provably unsent vs uncertain. Invalid New input must not unexpectedly create work. |
| **3. Transcript previews** — only owning peer bytes display, including saved history | Source-owned URL mapping, narrow peer image read and cache provenance; no workspace files | Extend `Machine.test.ts`, `SessionHistory.test.ts` and gateway tests: same hash/IDs on different peers, wrong-session hash, malicious absolute/encoded URL, 404/eviction/reprojection, redirect, invalid MIME, oversized or endless upstream body, interrupted read; no Local request or leaked credential. |
| **4. Expose both composers** — button/paste/drop, image-only and dictation usable together | Remove only proven remote guards in DraftEditor/MessageAttachments; retain unsupported remote controls | Extend existing `test/browser/remote-session.mjs`, not a duplicate critical path. Main + two independent scratch peers with colliding IDs and dummy credentials, fake Pi and stub transcription. Capture UI, network routing, peer receipts and bounded process memory; assert no unsolicited send. |
| **5. Slow/failing links and real compatibility** — controls remain useful; reconnect never replays | Gateway/HTTP/browser timing and capacity; actual locked Pi version | Throttle both browser→main and main→peer; exercise 50 MiB batches, concurrent transcript events, Stop and dialog answers, full queues, disconnect after upload/before ack, restart/expiry and offline second peer. Extend `PiInbound.test.ts`, `OriginPolicy.test.ts` and delivery coverage only for newly uncovered risks. Keep installed-Pi queue/processing compatibility distinct from fake-Pi tests. |

For each behavior slice run `npm run typecheck`, `npm run lint`, `npm test`; use the
`verify-piano` scratch workflow with isolated database/HOME/Pi dirs and retained evidence.
The existing local image tests already cover image-only snapshots, malformed wire input,
10/50 MiB boundaries and text-only queue restoration; reuse them, do not claim that they cover
remote transfer. Existing gateway tests deliberately assert the old 1 MiB input refusal and
blocked routes, and must change only where the chosen contract changes. [C12], [C17], [C18], [C32], [C33]

The two-peer browser journey should additionally cover:

- New and saved/running sessions; picker/paste/drop/removal; invalid mixed batch preserves
  accepted draft; source-bound delayed reads/uploads; switch/back/forward/reload isolation.
- Queued steering and follow-up with and without text; show Pi's real pending state, including
  the documented empty row; Edit/Stop text-only restoration; no inferred attachment counts.
- Reload/reconnect restores sent images from peer history, not browser drafts. Unsent drafts
  remain page-memory-only. Broken transport or authentication never retries a mutation or uses
  another peer. Browser disconnect does not Stop Pi.
- Deny cross-site GET/POST/WS, wrong Host/Origin, unknown machine, wrong method/query, arbitrary
  paths, settings writes and folder trust. Capture upstream headers with **dummy** tokens and
  assert no browser credential forwarding, redirects, local API fallthrough or local Pi starts.
- Voice off/missing/removed key; permission denied/pending/no device; constructor/start/recorder
  error; empty and oversized audio; MP4/WebM/Ogg negotiation; source hints and text-only peer send.
  A Local-only voice setting must remain Local-only even while editing remote drafts.
- Desktop Chromium/Firefox and Safari/iOS with real microphone permission, background/lock,
  and late grant. Browser API fakes establish ownership, not codec/device compatibility.

Follow [Quiet UI](../quiet-ui.md): reuse **Attach images**, **Voice input**, **Stop recording** and
existing progress/error feedback on both composers, not a second remote toolbar. Machine identity
already appears in navigation. Keep the main/OpenAI disclosure in the key dialog or on-demand
Details; provide a discoverable route to Local's Preferences when setup is needed, not remote
settings pretending to be available. Do not advertise all files, successful model receipt, or
successful delivery at upload completion. Review desktop/mobile screenshots and keyboard/focus
behavior for the affected journey; there is no need to restyle unrelated surfaces.

## Open decisions and limits of this research

1. **Accept main-owned transcription?** Recommended: one explicit main service, one key,
   machine-owned draft result. If per-peer billing is required, use the peer-owned branch above;
   no automatic provider/machine selection.
2. **Full 50 MiB remote parity or a deliberately smaller inline slice?** Recommended: full
   policy through bounded HTTP preparation. This costs a temporary-handle lifecycle and ADR
   amendment; inline support requires an explicit supported network/size envelope and evidence.
3. **Preparation and resource budgets:** TTL, staged-byte/concurrency budgets and deadlines above
   are starting proposals. Measure memory, upload and control latency on intended laptop/mobile/VM
   paths. Per-connection caps do not bound total process heap or unlimited sessions/tabs. Peer edge
   body/message/time limits were not inspected or contacted; verify the actual authenticated pair.
4. **Privacy UX and cancellation:** confirm the main-service disclosure, hint fields and whether
   to offer explicit Cancel while transcribing. Preserve existing stop-then-switch semantics unless
   deliberately changed; cancellation cannot promise billing reversal.

Review scope: local code/tests and matching installed dependency source, official OpenAI/MDN/W3C
pages fetched on the date above. No external repository checkout, real credentials, production
peer/service contact, paid model/transcription calls, dependency installation, app run, deployment
or restart. Tests were **read, not run**. Browser microphone/codec behavior, actual network limits,
peak memory and provider entitlement/quality remain unverified. This documentation-only change
requires source/document review, relative/pinned-link checks and `git diff --check`, not application
verification. The PR records those outcomes and its exact documentation revision/environment.

## Sources

Piano code links pin the inspected revision. Symbol names above disambiguate larger files.
Relative policy/research links provide context, not claims that proposed features are implemented.
External documentation is mutable; its observation date is 2026-11-09.

[C1]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/package-lock.json
[C2]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/web/src/components/DraftEditor.tsx#L118-L180
[C3]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/web/src/lib/messageDraft.ts
[C4]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/web/src/lib/composerControl.ts
[C5]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/server/PiRecords.ts#L617-L700
[C6]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/server/ClientSessions.ts#L421-L449
[C7]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/server/PeerGateway.ts
[C8]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/web/src/lib/ws.ts
[C9]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/server/PeerScope.ts
[C10]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/docs/runtime-input-limits.md
[C11]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/server/ImagePreviews.ts
[C12]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/test/PiSessions.test.ts
[C13]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/web/src/components/VoiceInputButton.tsx
[C14]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/shared/voiceInput.ts
[C15]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/server/VoiceInput.ts
[C16]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/web/src/lib/dictation.ts
[C17]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/test/browser/remote-session.mjs
[C18]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/test/Dictation.test.ts
[C19]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/web/src/components/Attachments.tsx
[C20]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/web/src/lib/machineStores.ts
[C21]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/web/src/components/MachineHost.tsx
[C22]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/web/src/lib/machine.ts
[C23]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/server/Router.ts
[C24]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/shared/wire.ts
[C25]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/server/InboundCapacity.ts
[C26]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/server/BoundedDelivery.ts
[C27]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/server/RegistryDatabase.ts
[C28]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/web/src/components/PreferencesSettings.tsx
[C29]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/web/src/App.tsx
[C30]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/server/PiHistoryWorker.ts
[C31]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/server/PiHistoryJobs.ts
[C32]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/test/PeerGateway.test.ts
[C33]: https://github.com/goofansu/piano/blob/4c15e8485f0c7d023f56d96107510a0aeec96e77/test/VoiceInput.test.ts
[P1]: https://unpkg.com/@earendil-works/pi-coding-agent@1.5.0/dist/core/agent-session.js
[E1]: https://unpkg.com/effect@4.1.2/src/http/HttpIncomingMessage.ts
[E2]: https://unpkg.com/@effect/platform-node@4.1.2/src/NodeHttpIncomingMessage.ts
[B1]: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
[B2]: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static
[B3]: https://w3c.github.io/mediacapture-record/
[B4]: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event
[O1]: https://platform.openai.com/docs/guides/speech-to-text
[O2]: https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create
[O3]: https://developers.openai.com/api/docs/models/gpt-transcribe
[O4]: https://platform.openai.com/docs/guides/your-data
