# Runtime input limits

Piano bounds incoming work as well as browser delivery (INV-02–05, INV-09).
The policy is defined in `server/InboundCapacity.ts`; these are per-connection or
per-Pi-child limits, not global quotas or a security sandbox.

| Boundary | Ordinary capacity | Reserved control capacity |
| --- | --- | --- |
| Browser work, per connection | 8 in-flight requests / 64 MiB serialized input | 8 requests / 32 MiB |
| Session actions, per child | 32 in-flight actions / 64 MiB | 8 actions / 32 MiB |
| Pi RPC requests awaiting completion | 32 requests / 64 MiB | 8 requests / 32 MiB |
| Pi stdin writes not yet accepted by the sink | 32 writes / 64 MiB | 8 writes / 32 MiB |
| Pi output awaiting projection | 256 records / 32 MiB | No reserved lane; overflow fails the child |

Both count and byte limits apply. Control means dialog answers/cancellation, Abort,
Stop and queue restoration; at the RPC boundary this is UI responses, `abort` and
`clear_queue`. The reserved lanes do not reorder stdin or bypass a child that has
stopped reading. Delivery acknowledgements and heartbeat pings are handled promptly
without acquiring ordinary-work capacity, so a pending prompt cannot starve them.

- **WebSocket messages:** 32 MiB including all fragments. The Node `ws` parser enforces
  this while assembling messages; `WsClient` also checks before JSON decoding.
  Oversized messages close with code 1009. Compression is disabled. The platform's
  pausable socket reader backpressures buffered messages at its high-water mark.
- **RPC lines/input:** 32 MiB. Output framing counts raw bytes before UTF-8 decoding,
  JSON parsing, or waiting for a newline. This permits the existing 20 MiB image
  upload batch after base64 encoding plus JSON overhead, without an unlimited text
  allowance. The newline on a stdin write counts toward the input limit.
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

## Verification

`test/PiInbound.test.ts` exercises PiSessions' public interface: capacity rejection,
reserved answer/Abort/Stop, recovery, count/byte record overflow during readiness,
newline-free oversized output, oversized input and fragmented UTF-8.
`test/ClientDispatch.test.ts` covers selection preservation and live heartbeats and
controls at client capacity. `test/OriginPolicy.test.ts` sends oversized single and
fragmented messages through the real Node server. The scratch-only
`test/browser-inbound-limits.mjs` observes overload, answering, acknowledgements,
heartbeat continuity and a subsequent prompt through `npx agent-browser` with fake Pi.
