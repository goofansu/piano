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

Both count and byte limits apply. Control means dialog answers/cancellation, Abort,
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

## Verification

`test/PiInbound.test.ts` exercises PiSessions' public interface: capacity rejection,
reserved answer/Abort/Stop, recovery, count/byte record overflow during readiness,
newline-free oversized output, oversized input, fragmented UTF-8, and a prompt Pi reads
more slowly than the base acknowledgement deadline.
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
