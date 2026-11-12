# Runtime input limits

Piano bounds incoming work as well as browser delivery (INV-02–05, INV-09).
The policy is defined in `server/InboundCapacity.ts`; these are per-connection or
per-Pi-child limits, not global quotas or a security sandbox.

Every conversation-runtime byte cap below derives from one **maximum message**: the attachment policy's total
(`MAX_ATTACHMENT_BYTES` in `shared/attachments.ts`) after base64 encoding, plus a named
JSON/text allowance (`MAX_MESSAGE_BYTES` in `server/InboundCapacity.ts`). Raising the attachment policy raises every cap
below with it; about 83 MiB for today's 50 MiB policy.

| Boundary | Ordinary capacity | Reserved control capacity |
| --- | --- | --- |
| Browser work, per connection | 8 in-flight requests / 2 maximum messages of serialized input | 8 requests / 32 MiB |
| Session actions, per child | 32 in-flight actions / 2 maximum messages | 8 actions / 32 MiB |
| Pi RPC requests awaiting completion | 32 requests / 2 maximum messages | 8 requests / 32 MiB |
| Pi stdin writes not yet accepted by the sink | 32 writes / 2 maximum messages | 8 writes / 32 MiB |
| Pi output awaiting projection | 256 records / 1 maximum message | No reserved lane; overflow fails the child |

Both count and byte limits apply. Admission counts exact serialized UTF-8 bytes.
`InputBytes` lets JSON handle traversal, omissions, escapes and errors, replacing only
escape-free base64-alphabet `data` strings with empty strings and adding their byte lengths.
It is not validation: invalid attachments still reach the existing validation/refusal path,
and other data keeps normal JSON behavior. No serialized payload cache is retained.
Pi stdin serializes once for delivery and encodes into one final buffer with its newline,
without constructing a second newline-appended JSON string.

Control means dialog answers/cancellation, Abort,
Stop and queue restoration; at the RPC boundary this is UI responses, `abort` and
`clear_queue`. The reserved lanes do not reorder stdin or bypass a child that has
stopped reading. Delivery acknowledgements and heartbeat pings are handled promptly
without acquiring ordinary-work capacity, so a pending prompt cannot starve them.

- **WebSocket messages:** one maximum message, including all fragments. The Node `ws` parser enforces
  this while assembling messages; `WsClient` also checks before JSON decoding.
  Oversized messages close with code 1009. Compression is disabled. The platform's
  pausable socket reader backpressures buffered messages at its high-water mark.
- **RPC lines/input:** one maximum message. Output framing counts raw bytes before UTF-8
  decoding, JSON parsing, or waiting for a newline. This permits a full image upload batch
  plus JSON overhead, without an unlimited text allowance. Each ordinary lane holds two such
  prompts. The newline on a stdin write counts toward the input limit.
  Stdout framing grows geometrically while a partial line needs it. Storage over **1 MiB**
  has a **one-second reuse window** after a large line, so consecutive image events/history
  readbacks can reuse it rather than repeatedly allocate/copy the full growth ladder. Small
  records do not renew that window; smaller buffers remain reusable. At expiry an empty
  buffer is released. An unfinished line always keeps its bytes, and its completion schedules
  release again. One unreferenced timer per child owns this grace period; EOF, failure and
  reader cancellation clear it and release all framing storage. Growth remains amortized
  linear per line. This changes storage lifetime, not the line limit, history, preview-cache
  policy or output ordering.
- **Acknowledgement deadline:** a request's stdin write and Pi's acknowledgement share one
  deadline: `PiRequestTimeoutMs` (30 s), plus one second per whole MiB written
  (`server/PiTransport.ts`). Pi's JSONL reader rescans its buffer for every stdin chunk, so
  a long line takes disproportionately long to read: on an exe.dev VM a 28 MiB line took
  about 4.5 s and a 67 MiB one about 23 s, inside its 96 s deadline. Requests under 1 MiB
  keep the base deadline. A maximum prompt is therefore not reported uncertain merely
  because Pi was still reading it.
- **Excess ordinary/control work:** reject immediately, without changing selection,
  queuing for later, or sending that input to Pi. The browser receives an error;
  there is no automatic resend. Capacity is released when the work finishes, not
  when a browser stops waiting. Each reserved lane is itself bounded.
- **Output overflow:** fail the session/readiness and settle pending requests, then
  terminate Pi using bounded process cleanup. Never silently drop a record or
  block stdout behind work that may require a later response. Already accepted
  output drains before the terminal event. Diagnostics contain no raw RPC text.
- **Uncertain writes:** timed-out/interrupted writes retain their byte/count lease
  until the sink accepts them or the transport closes. A timeout does not prove
  non-delivery and does not authorize retry. A full control lane can still fail an
  answer; existing dialog-resolution uncertainty/recovery semantics remain in force.

The byte accounting describes serialized retained inputs, not a heap-size promise:
parsed objects/strings, one active record, framing storage, runtime buffers and
existing session history also consume memory. It does not bound Pi's own context,
number of browser connections, number of sessions, or HTTP request bodies.

## Remote session surfaces

The gateway relays a remote session's [Changes, pull request, Outputs and file reads](adr/0004-same-owner-piano-peer.md#session-surfaces-changes-files-and-the-session-rail)
as single requests, as it does slash-command reads and saving defaults, each bounded before and
after dialing. `RemoteRequests` in `shared/http.ts`
and `PeerGateway` define:

Where the remote bounds its own answer, the gateway waits that bound plus a 5 s margin for the
dial and the answer, so the remote's own error (Git or GitHub timed out, Pi did not list its
commands) reaches the browser instead of "machine unavailable":

| Request | Request body | Answer | Remote's bound (`shared/wire.ts`) | Gateway deadline |
| --- | --- | --- | --- | --- |
| Changes read, one file's patch, saved comparison | 16 KiB | 4 MiB JSON | Git observation, `CHECKOUT_TIMEOUT_MS` 30 s | 35 s |
| Written paths (Outputs) | 1 MiB, at most 1,000 paths | 1 MiB JSON | Git observation, `CHECKOUT_TIMEOUT_MS` 30 s | 35 s |
| Pull request read and change | 16 KiB | 1 MiB JSON | Git and GitHub together, `PULL_REQUEST_TIMEOUT_MS` 45 s | 50 s |
| Slash commands (folder probe or running session) | 16 KiB | 1 MiB JSON | `SLASH_COMMANDS_TIMEOUT_MS` 45 s | 50 s |
| File preview and download | 16 KiB | 34 MiB, relayed as sent | none; size only | 60 s |
| Save defaults | 16 KiB | 1 MiB JSON | none in total | 10 s |

A file answer is held whole in memory before it is passed on, at most **two per configured peer**
at once (68 MiB); a third is refused with 429, not queued. The answer ceiling is the largest
preview limit (`LARGEST_PREVIEW_BYTES` in `shared/files.ts`, a 32 MiB video) plus 2 MiB for its
multipart answer; the peer applies the per-format limits first. A compressed, oversized, late or
malformed answer is the remote unavailable (502). Nothing is retried.

The Changes and Outputs bound starts once the remote holds one of its Changes permits, so a wait
for a permit on a busy remote is not covered. Saving defaults checks a new model against the
remote's cached catalog; only an uncached one starts a Pi probe, whose reads are each bounded but
not in total, so a slow probe there still ends as "machine unavailable".

## Remote image HTTP lane

The [same-owner remote image extension](adr/0004-same-owner-piano-peer.md#raster-images-separate-preparation-unchanged-conversation-ownership)
keeps the gateway conversation cap at **1 MiB**, including reference-bearing sends. Original
images travel separately; the peer resolves the reference before the runtime limits above apply.
`shared/remoteImages.ts`, `ImageTransfer`, `PreparedImages` and `PeerImageGateway` define:

| Resource | Bound |
| --- | --- |
| Binary upload | 50 MiB original bytes + 16 KiB manifest + 4-byte length prefix |
| Manifest | One JSON object; exact fields, ten image descriptors; name 255 characters, cwd 4096, IDs 200 |
| Parts | At most ten contiguous rasters of declared sizes; no multipart headers, nested bodies or general file kinds |
| HTTP body handling | Count actual streamed bytes before allocation/JSON parsing; bound manifest before reading it; reject trailing/truncated bytes, compression and inconsistent Content-Length; missing length/chunked bodies still counted |
| Peer preparations | **Two slots total** across reading, unclaimed and consumed-but-unsettled batches; immediate busy refusal |
| Staged image budget | Two maximum batches = **100 MiB original bytes**; consuming replaces raw bytes with up to about 133.34 MiB base64 across both slots |
| Unclaimed lifetime | Ten minutes; sweep every 30 s and before prepare/claim; consumed entries never expire during an operation |
| Main HTTP concurrency | Per configured peer: two uploads, two image reads, two small cancellation requests; no waiting queue |
| Peer image reads | Two concurrently streaming reads |
| HTTP timing | 30 s without body progress, 180 s total; fetch/header wait also bounded by the 180 s deadline; browser upload deadline 185 s |
| Preparation/cancellation response | 1 KiB, schema-decoded, no arbitrary upstream error body forwarded |
| Transcript image response | 64 MiB, matching the independent disposable preview cache, not the 10 MiB original-upload ceiling; MIME allowlist, no compressed response |
| Preview metadata | At most 4096 cached images and 4096 observed session/hash memberships **globally**; oldest entries/memberships drop when full; byte eviction drops provenance too |

Both hops admit a request by the same rule, `imageRoute` in `ImageTransfer`: the route's method,
refused upgrade or compression headers, query (a valid preview address, none on a POST), content
type and declared length, so main never forwards what the peer refuses and both answer a malformed
request with the same status and error. Each hop adds only its own concerns: main its per-peer
lanes and forwarding, the peer its same-origin check (run first), preparation and preview reads.
The two-slot staging budget (`batches`) and the two transfers per lane (`laneTransfers`) are
separate limits that happen to be equal.

Main backpressures a binary stream without storing the batch. The peer validates before returning
an opaque reference and before creating work; a failed/cancelled ingest frees its slot. A consumed
reference is not reusable even after a known-unsent refusal. It holds its slot until the operation
settles, not just until its observer disconnects. Cancellation discards only unconsumed entries;
unknown preparation results expire. All staging is memory-only, with scope cleanup and no files
or database migrations. None of these paths retries input or falls back to Local.

These are data/lifecycle budgets, **not a process RSS ceiling**: browser Blob/base64 copies, JSON
serialization, Pi stdin and Pi-owned queues/history add memory. HTTP protocol headers remain under
Node's bounded HTTP parser; the binary format has no per-part header parser. The preview cache
itself remains at most 64 MiB / 4096 images; two in-flight reads can retain older evicted bytes temporarily. Opening
many peers multiplies main's per-peer concurrency, but each relay backpressures rather than
collecting whole images. Reserved controls still cannot overtake bytes already written to Pi's
local stdin. The separate HTTP lane solves network head-of-line blocking, not that runtime limit.

## Voice input

`shared/voiceInput.ts`, `dictation`, `Router` and `VoiceInput` bound main-owned transcription for
Local and peer composers. No audio traverses the conversation socket or peer gateway.

| Resource | Bound |
| --- | --- |
| Recording | 10 minutes; 25,000,000 actual Blob bytes; one live microphone/permission operation per page |
| Browser encoding | Refuse oversized chunks/Blob before FileReader; request a 1-second recorder timeslice |
| Main HTTP body | 33,333,336 base64 bytes + 32 KiB JSON envelope, actual streamed bytes before text/JSON allocation; compressed uploads refused |
| Ingestion | Two requests per backend across upload and transcription (the endpoint's `upload` in `shared/http.ts`), immediate 429 before the body is read when busy, no waiting queue; 30 s total body-read deadline |
| Service | Canonical base64 and decoded-byte validation before provider upload |
| Provider | 120 s operation deadline including response body; 1 MiB response JSON and 65,536 transcript characters; no redirects or automatic retries |
| Cancellation | Browser abort reaches fetch; HTTP disconnect/Effect interruption cancels provider fetch and releases capacity |

The browser timeslice is not a hard chunk/heap ceiling: backgrounding/locking can delay events.
Hidden pages discard active recordings; Stop commits before final audio arrives. Provider cancellation
cannot promise billing reversal. Main stores neither audio nor transcripts as history; only reviewed
text explicitly sent to Pi becomes conversation input.

## Verification

`test/PiInbound.test.ts` exercises PiSessions' public interface: capacity rejection,
reserved answer/Abort/Stop, recovery, count/byte record overflow during readiness,
newline-free oversized output, oversized input, fragmented UTF-8, and a prompt Pi reads
more slowly than the base acknowledgement deadline. Repeated large records followed by small
records and fragmented UTF-8 cover framing release boundaries. `test/InputBytes.test.ts`
compares admission sizing with JSON serialization, including image envelopes, optional fields,
arrays, escaped/non-ASCII strings, invalid direct inputs and JSON failures.
`test/ClientDispatch.test.ts` covers selection preservation and live heartbeats and
controls at client capacity. `test/OriginPolicy.test.ts` sends oversized single and
fragmented messages through the real Node server. The scratch-only
`test/browser-inbound-limits.mjs` observes overload, answering, acknowledgements,
heartbeat continuity and a subsequent prompt through `npx agent-browser` with fake Pi.

`PreparedImages.test.ts`, `PeerScope.test.ts`, `PeerGateway.test.ts`, `Machine.test.ts` and
`DraftSubmission.test.ts` cover image validation/resource bounds, scope/provenance, one-use/expiry/
cancellation, no retry/fallback and target-bound draft recovery. `test/browser/remote-session.mjs`
observes the two-peer affected journey, including uploads, dialogs, queues, Stop and reload. Set
`PIANO_TEST_LARGE_IMAGES=1` for its opt-in 50 MiB batch over a browser-throttled connection. The
gateway module test separately backpressures the main→peer hop of a maximum batch while sending
controls. Fake Pi and signature-valid padded rasters do not establish worst-case pixel decoding,
real phone memory, provider acceptance or authenticated exe.dev edge body/time limits.

`Dictation.test.ts` covers source-store identity, Stop/navigation, late permission, explicit abort,
newer typing/Send, recorder errors and actual byte accounting. `VoiceInput.test.ts` uses a stub
provider for canonical input, bounded responses, concurrency and timeout/abort. `VoiceInputHttp.test.ts`
checks the real Node streamed-body boundary and denied peer voice routes. The remote browser journey
also covers Local and peer dictation using fake device APIs and stub transcription responses; it is
not a real microphone, codec, mobile lock or credentialed OpenAI check.
