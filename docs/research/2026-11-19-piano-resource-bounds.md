# Piano resource bounds: architecture, rationale and consolidation

Research snapshot, 2026-11-19. Checked Piano **16eaf5beb160fba618be1f2b723a4722eb1ef23b**
(including #904) and locked Pi packages **1.5.2**.[^versions] This is one project-wide source inventory and
proposal, **not new policy, configuration, code or permission to change any limit**. No live user
sessions, credentials, organization settings or artifact contents were read; no uploads or session
generation calls were made. Where the exact numeric choice has no recorded rationale, that remains unknown.

## Overview: follow the data, not the number

```text
human input / attachments
  → Piano admission + queues → Pi RPC → Pi history/context → model token window
files / network / tools
  → acquisition bounds → tool-result presentation → Pi history/context
Pi events/history
  → Piano projection + delivery → browser rendering / previews
saved session / authored document
  → publication bounds → Radius storage (not model context)
```

These are different objects, units and owners. A file can be safe to store but too large to send to
one model request; a short tool result can still require an expensive download; clipping the UI
cannot protect the model. One universal `MAX_CONTENT_SIZE` would hide those distinctions.

| Layer | Existing owner | What the bound protects | Consolidation direction |
| --- | --- | --- | --- |
| Original user inputs and cross-runtime envelopes | `shared/attachments.ts`, `remoteImages.ts`, `voiceInput.ts`, `http.ts` | Admitted input size, encoding/framing and relay cost | Reuse these contracts; derive wrappers from payload + framing, not another unrelated literal. |
| Pi transport and live delivery | `server/InboundCapacity.ts`, `BoundedDelivery.ts`, `PiTransport.ts` | Queue/record/frame memory, backpressure, control responsiveness | Keep server-owned policy local; share the same protocol only where another participant needs it. |
| Model-facing tool output and context | Tool implementation; Pi's truncation and compaction modules | Per-result text versus whole-context tokens | Reuse Pi contracts where compatible; do not treat browser clipping or transport admission as context management. |
| File previews and browser rendering | `shared/files.ts`; renderer-specific modules | File acquisition, fan-out, parser/render work | File admission already has a shared owner; rendering-work limits remain separate from bytes and tokens. |
| External operations and publication | Feature owners such as Radius, Git, voice and previews | Transfer bytes, operation duration, concurrency, uncertainty | Keep provider facts distinct from Piano policy; derive outer timeouts from inner operation contracts. |
| Stored/retained state and schema fields | Feature-owned caches, schemas and lifecycle modules | Metadata growth, valid identities and mutually exclusive work | Same number is not a shared policy; document scope before considering reuse. |

### Findings that change the original size discussion

- **Neither 10 MiB nor 16 MiB is a documented Radius per-file limit in the inspected sources.**
  Share's 10 MiB is an existing Piano policy; #904's 16 MiB download cap was chosen as headroom,
  not from a service limit or measured workload. Replacing one with the other does not supply
  the missing rationale.
- **There is no single Piano context cap.** Local input/RPC admits about **82.67 MiB serialized**,
  peer input **1 MiB**, ordinary Pi `read` retains **50 KiB / 2,000 lines**, and the model uses
  a **token** window. None implies the others. Direct custom extension results do not inherit a
  universal automatic 50 KiB clamp.
- **Much of the project is already centralized by feature.** The real duplication candidates
  below are narrower than “move every number to shared constants.” A global constants file would
  add coupling without establishing a coherent resource budget.
- **Purpose is usually clearer than numeric sizing.** Existing errors, ADRs and control flow
  often explain why a gate exists, but not why its exact value is appropriate. This audit records
  that gap instead of retroactively inventing measurements.

## 1. Radius: documented limits versus unknowns

Freshly inspected the public [Artifacts guide](https://radius.earendil.com/docs/artifacts),
[documentation index](https://radius.earendil.com/docs),
[agent API guide](https://radius.pi.dev/v1/agent.md) and
[OpenAPI 3.1 document](https://radius.pi.dev/v1/openapi.json), plus the connected MCP tool
**descriptions/schemas only**. A targeted official-domain search found the API sources; no
artifact/account operation was executed.

| Question | What the authoritative source establishes | What it does not establish |
| --- | --- | --- |
| Per-file upload/download maximum | The guide supports documents, Pi sessions and multi-file sites. OpenAPI `artifacts.create` and `artifacts.versions.publish` document binary request bodies; `artifacts.scratch.files.put` accepts binary upload and optional gzip metadata. The inspected input schemas/descriptions specify no numeric file-byte maximum. | No evidence for 10 MiB, 16 MiB, 128 KiB, unlimited uploads, or a supported raw/decompressed maximum. |
| Organization storage/count quotas | `artifacts.summary.read` returns `artifact_count`, `artifact_limit`, `storage_bytes`, `storage_limit_bytes`, including temporary scratch-upload usage. Owners/admins can read it. | The public schema supplies field types, not universal numeric quota values. No organization summary was read, and total storage quota would not by itself be a per-file maximum. |
| Retention | Guide default: 90 days from latest publication; configurable organization/per-artifact lifetime. OpenAPI organization TTL fields have maximum **31,536,000 seconds = 365 days**; a publication must fit its organization's maximum. | Not a byte cap. Retention resets do not establish permanent archival guarantees. |
| Transfer capability lifetime | MCP upload/download descriptions say their presigned URL expires **within 10 minutes** and transfers original file bytes separately. | Not the artifact-page expiry, a 10-minute file-size allowance, or a reason for Piano's 60-second operation deadline. |
| Viewer and bandwidth limits | No numeric large-session rendering, upload-rate or bandwidth guarantee was found in the inspected guide/API contracts. | No live boundary testing or provider-capacity claim. |

The older [session-artifact research](2026-10-13-radius-session-artifacts.md#operational-limits-known-versus-unknown)
also left upload size unestablished. The current schema adds a useful discovery path for actual
organization quotas, but still does not justify a hardcoded per-file size. Radius documentation
lists `feedback@earendil.com` for unresolved service questions; no message was sent.

**Implication:** decide artifact acquisition/publication policy from documented service guarantees
and an explicit local memory/transfer budget. Independently decide model-facing page policy. Do
not infer either from Session Share's existing number, or confuse successful schema validation
with a measured supported maximum. This report selects no replacement value.

## 2. Consolidation proposal: one owner per contract

Preserve [`web → shared ← server`](../README.md). The
[layer lint](../../scripts/lint-boundaries.mjs#L4-L6) allows only environment-neutral shared imports
(`effect`, Pi schema, `zod` currently), and [checks local import direction](../../scripts/lint-boundaries.mjs#L89-L100).
The browser cannot import a server or `scripts/` owner merely to obtain a number. Constants should
live with the **semantic owner**, shared only when multiple runtimes enforce the same contract.

### Strong candidates: real duplicated contracts

1. **Delivery queue default**: `makeDelivery`'s `{messages:256,bytes:8 MiB}` and
   `socketLimits.queue` in [BoundedDelivery](../../server/BoundedDelivery.ts#L9-L61) are the same
   queue-default shape in one server module. Reuse one owner-local object. Do **not** merge queue,
   in-flight-window and frame-byte fields just because they are all 8 MiB: they constrain different
   allocations and encoding phases; the relationships should remain explicit.
2. **Dispatch wait bounds**: tool schema literals 1,000/60,000 vs exported runtime
   `WAIT_MIN_MS`/`WAIT_MAX_MS`. The extension can reuse its runtime exports (or a narrow
   `shared/dispatch` contract if another runtime needs them). 32 handles is a separate tool schema
   cap; runtime/CLI absence should be considered deliberately, not “fixed” by inventing a global
   queue limit.
3. **Preview helper request envelope**: 65,536-byte checks in `preview.ts` and `PreviewOwner.ts`
   implement the same request protocol. Keep a single constant in an existing scripts protocol
   owner; `PreviewRequest.ts` or a narrowly scoped helper module could own it. Do not put it in a
   universal `shared/limits.ts`; the browser never sends this protocol. The 32 KiB response and
   6,000-character diagnostic tail are different bounds. CLI and adapter diagnostic-tail policy
   may share if deliberately defined as the same visible result, not merely equal today.
4. **Attachment filename**: 255 in wire attachment schema, remote manifest and browser filename
   normalization is one cross-runtime contract. Prefer existing `shared/attachments.ts` ownership
   over another constants file.
5. **Remote image envelope derivation**: `bodyBytes` repeats literal 16 KiB already named
   `manifestBytes`. Derive the envelope from manifest allowance + existing attachment total +
   framing width. The 4-byte prefix is protocol format, not a configurable budget.
6. **Workspace-path schema reuse, cautiously**: preview/download and written-file paths repeat
   4,096, and image target cwd repeats it too. Reuse a narrowly named path schema/constant only
   after agreeing they have the same character/byte semantics. Do not include webhook URLs,
   HTML attributes or image cache counts simply because all use 4,096.

### Radius and model-facing text: settle policy before moving constants

The current artifact page, escaped-page, complete-download and publication caps all live in one
extension, while raw Session Share has its own owner. They are not four copies of the same
quantity. The architectural questions come first:

- Should every file accepted by Session Share be readable through the artifact tool? If yes, that
  is a cross-feature compatibility relationship to preserve, not evidence for a particular extra
  number of MiB. Keep the standalone artifact package independent of Piano-only runtime imports.
- Should Piano-owned tool text follow Pi's existing output policy, or a deliberately different
  product budget? Pi exports truncation defaults; duplicating a new default per tool needs a
  reason. Its line-based reader cannot simply replace byte paging of single-line artifacts.
- The publication schema's 131072 and execution's `128 * 1024` encode one document admission
  policy at two checks. A single owner-local byte allowance could supply both, while retaining
  the authoritative UTF-8 check and documenting that schema length has different units.
- Artifact title admission/receipt storage likewise refer to the same title but currently count
  codepoints versus code units. Clarify the contract before mechanically sharing a numeric value.

No replacement caps, generalized limiter, configuration framework or global `shared/limits.ts`
is proposed here. Reuse the existing semantic owners first; only a demonstrated cross-runtime
contract belongs in shared code. Review policy/value changes separately from deduplication.

### Already shared: retain these sources of truth

- `attachments`, `remoteImages`, `imagePreviews`, `voiceInput`, `files`, `drafts`, `literalSecret`,
  `urlId`, `dispatch`, `share`, and the existing `wire` Changes/deadline/name constants.
- `RemoteRequests` derives relay deadlines/response envelopes from owning limits; browser
  written-file batching imports `WRITTEN_PATHS_LIMIT`; server/browser voice and image policies
  already share definitions; preview start schema/adapter/description already use
  `START_TIMEOUT_SECONDS`; peer output window imports server `socketLimits`.
- `LAST_ANSWER_CHARS=2,000` already serves the status tool and webhooks (not full wait attribution).
  Known-secret minimum already
  serves DisplayProjection and webhook token eligibility. No second “webhook answer limit” or
  “webhook minimum secret length” is needed.

### Same number is not same policy

- 10 MiB attachment vs file-image preview; 64 MiB image cache vs allowable preview response;
  1 MiB file text vs remote input vs provider JSON vs per-file patch; 20 MiB Markdown images,
  HTML resources, audio and PDF files; 32 MiB video vs PDF canvas memory.
- 20,000 project instructions vs library body vs HTML/Markdown structure counts; 32 peers/hooks/
  frames/handles/recursion; 80 project name vs generated session title vs peer display name.
- 30 s Pi/dispatch/read/upload/heartbeat-related values; 60 s worktree creation, file transfer,
  session share and MCP process startup; 5 s provider status, supervisor, browser confirmation and
  SQLite waits. These may need explicit outer/inner derivations, not a single timeout value.
- Markdown/HTML strings, bytes and work-unit counters must not all become `MAX_CONTENT_SIZE`.
  First clarify units and enforcement points. Parse-then-check is not equivalent to stream-before-
  allocation checking.
- Git's repeated 8 MiB / 20 s defaults are a possible **owner-local** cleanup, but not a reason to
  put subprocess and preview-host command policy in shared/browser code.

## 3. Artifact publication and reading: Piano-owned boundaries

| Surface | Enforced bound and behavior | Owner / enforcement |
| --- | --- | --- |
| `radius_artifact_create` / `update` | `content` schema has `maxLength: 131072` Unicode codepoints[^schema]; execution separately rejects `Buffer.byteLength(content) > 128 * 1024`. The latter is the actual UTF-8 document-byte cap, before JSON escaping and request metadata. No truncation. | [`extensions/radius-artifacts/index.ts:34–57,158–173`](../../extensions/radius-artifacts/index.ts#L34-L57) |
| `radius_artifact_view` page | `maxBytes` defaults to **16,384**, accepts **4–32,768**. `offset` is a zero-based UTF-8 byte position. Stops before splitting a codepoint; additionally stops before escaped page text exceeds **32,768 bytes**, excluding string delimiters. Invalid UTF-8, an interior-codepoint offset or offset beyond EOF is rejected. | [`index.ts:63–85,313–366`](../../extensions/radius-artifacts/index.ts#L63-L85); [`RadiusClient.ts:7–9,194–232`](../../extensions/radius-artifacts/RadiusClient.ts#L194-L232) |
| View download | **16 MiB actual streamed response bytes** per selected file; larger downloads error, not truncate. Each page downloads the entire file again, then selects its page in memory. There is no Range/cache/local-file continuation. | [`RadiusClient.ts:157–194`](../../extensions/radius-artifacts/RadiusClient.ts#L157-L194) |
| View tool result | Model-facing text is `JSON.stringify(data)`; `details` and `structuredContent` carry the same data. Page budgets do **not** bound the complete result: metadata/manifest remain extra. Multi-file artifacts without a selected path and non-text files return metadata/manifest only. Pin returned revision/path when continuing with `nextOffset`; `null` means EOF. | [`index.ts:87–95,319–368`](../../extensions/radius-artifacts/index.ts#L87-L95) |
| Radius adapter transport | **4 MiB** per MCP HTTP response stream; combined cancellation/absolute **60 s** lifetime, **30 s** connect and call timeouts. These are safety bounds on responses, not artifact storage quotas or token limits. | [`RadiusClient.ts:43–86,110–126`](../../extensions/radius-artifacts/RadiusClient.ts#L43-L86) |
| Session Share | **10 MiB saved raw JSONL**, with file-size, identity/version and validity checks. Over-limit or changing files are refused; history is not truncated. Share calls `RadiusClient` directly, bypassing the extension's 128 KiB publication policy. One in-flight share per machine, **60 s** operation deadline. | [`shared/share.ts:4–5`](../../shared/share.ts#L4-L5); [`server/PiHistory.ts:210–255`](../../server/PiHistory.ts#L210-L255); [`server/SessionSharing.ts:64–143`](../../server/SessionSharing.ts#L64-L143) |

These caps are hardcoded application policy except for the bounded per-call page size/offset.
The earlier [sharing verification note](2026-10-13-session-sharing-verification.md) explicitly
says the 10 MiB bound is Piano policy, not a discovered Radius limit (lines 28–30). A 10 MiB
JSONL file can need substantially more than 10 MiB when embedded in a JSON request; neither raw
file bytes nor the downloaded 16 MiB should be described as “context tokens.”

## 4. Piano input admission and transport are not context pruning

The former `docs/runtime-input-limits.md` is **absent at this revision**; commit `3b42675a`
deleted it. Its last version was inspected as historical context, but the claims here were
traced to current enforcement, including changed pending-output behavior.

`MAX_MESSAGE_BYTES = 4 * ceil(50 MiB / 3) + 16 MiB = 86,682,284`.
The 16 MiB is an envelope/text allowance in the formula, **not a separate enforced text-field
maximum**. Prompt and steer `text` are plain `Schema.String`; the actual local ceilings are on
serialized messages. Accepted text is forwarded without size truncation (with skill-command
whitespace normalization).[^input]

| Boundary | Current hardcoded capacity | Actual enforcement |
| --- | --- | --- |
| Local browser → Piano message | One `MAX_MESSAGE_BYTES`, including assembled WebSocket message; checked again before decoding. Oversize closes/refuses, does not shorten text. | [`server/main.ts:55–62`](../../server/main.ts#L55-L62); [`server/WsClient.ts:55–72`](../../server/WsClient.ts#L55-L72) |
| Browser connection's admitted work | **8** ordinary requests / **2 × MAX_MESSAGE_BYTES**; separate control lane **8 / 32 MiB**. | [`server/ClientDispatch.ts:474,565–583`](../../server/ClientDispatch.ts#L565-L583) |
| Session actions; outstanding Pi RPC requests; pending stdin writes | Each ordinary lane **32 / 2 × MAX_MESSAGE_BYTES**; each control lane **8 / 32 MiB**. Capacity exhaustion refuses unsent input. | [`server/PiSessions.ts:670–724`](../../server/PiSessions.ts#L670-L724); [`server/PiTransport.ts:94–99,397–429,464–511`](../../server/PiTransport.ts#L397-L429) |
| Each Pi RPC record | Same **86,682,284-byte** ceiling. Stdin checks UTF-8 `JSON.stringify(record)` **plus one LF byte**. Stdout counts raw line bytes **before decoding/parsing**, excluding the LF delimiter. Oversized stdout fails the child. | [`server/PiTransport.ts:227–232,254–283,397–409`](../../server/PiTransport.ts#L254-L283) |
| Pi events pending projection | **256 records / MAX_MESSAGE_BYTES**. A subscribed consumer allows backpressure until room is freed; over-capacity before consumption starts, or a single oversized record, fails. This is not arbitrary record dropping or automatic context compaction. | [`server/PendingRecords.ts:28–64`](../../server/PendingRecords.ts#L28-L64); [`server/PiTransport.ts:177–192`](../../server/PiTransport.ts#L177-L192) |

The count/byte lanes are per connection/child, not a whole-system memory budget. Admission sizing
uses exact JSON UTF-8 size via `InputBytes` (escape-free base64 is counted without duplicating it).
The policy and acquire/release check live in
[`server/InboundCapacity.ts:5–33`](../../server/InboundCapacity.ts#L5-L33) and
[`server/InputBytes.ts:1–11`](../../server/InputBytes.ts#L1-L11).

Pi acknowledgement/write deadlines default to **30 s + 1 s per whole MiB**; the base is an
injectable `PiRequestTimeoutMs`, not a model-token setting
([`server/PiTransport.ts:34–43,434–511`](../../server/PiTransport.ts#L34-L43)). Pi 1.5.2's own
stdin JSONL reader accumulates until LF without a size guard; Piano supplies the above host
boundary. Pi RPC forwards the prompt into `AgentSession`, whose text-input handling/expansion
has no corresponding universal character/token truncation.[^pi-input]

Image upload policy is separate: **10 images, 10 MiB original bytes each, 50 MiB total**,
validated using base64-decoded byte size and MIME/signatures. Pi then performs model-facing
image preparation, not Piano's upload validator.[^input]

## 5. What enters the model versus what the UI reads

See the runtime inventory for peer/delivery envelopes, browser file previews and session-observer
limits. Those paths do not automatically append downloaded/previewed content to model context.

| Reader/output path | Bound, unit and consequence |
| --- | --- |
| Pi built-in text `read` | **2,000 lines or 50 × 1,024 UTF-8 bytes** retained, then continuation notice. `offset` is **1-based lines**, unlike Radius byte offsets; `limit` selects fewer lines but does not lift the byte/line ceiling. A first selected line over 50 KiB yields a diagnostic rather than a partial line. No fixed maximum text-file size: local streaming keeps bounded selected text while counting the rest; custom non-streaming operations/unusual ranges may read the whole file into memory. Same bounded text reaches codemode. [^pi-read] |
| Pi image preparation | Separate from text truncation: auto-resize defaults on, with a **2,000 × 2,000 pixel / under 4.5 MiB base64-encoded payload** target and JPEG quality 80. Settings/model resize profiles can change this; it is not the original-upload byte limit or an unconditional guarantee when image processing fails. [^pi-images] |
| Pi built-in `bash` | Model-facing output keeps the **last 2,000 lines / 50 KiB** with spill-file guidance. Structured callers such as codemode instead retain up to **1 MiB raw output bytes**, decoded as text (start/end plus omission marker for larger output); a script decides what to emit. [^pi-bash] |
| Pi built-in MCP adapter | Model-facing text retains **20 KiB UTF-8**, split between start/end, plus markers/spill-file path. Structured codemode callers receive the full MCP result (without `_meta`). This is the **built-in MCP adapter**, not a universal extension policy and not the directly registered `radius_artifact_view`. [^pi-mcp] |
| Pi `codemode` result | Default **10,000 estimated tokens = 40,000 JS code units** of combined text retained, half start/half end; extra headers/markers/path are added and images are outside that text budget. `// @options: {"max_output_tokens": ...}` changes it per call (nonnegative safe integer, not an actual tokenizer count). Only emitted/returned output reaches the model, not every intermediate tool result. [^pi-codemode] |
| Piano transcript display | Ordinary tool detail arguments clamp at **4,000 JS code units**, output at **20,000**; nested output at **4,000**. Dispatch cards clamp params at **8,000**, answer at **20,000**. This is React rendering only. `PiRecords.serializeMessage` projects the original text, then strips controls; these clamps do not rewrite Pi history or model context. [^display] |

Codemode also has distinct resource safeguards: **256 MiB VM memory**, **16,777,216 emitted
text/base64-image code units** or **100,000 emission calls** before script failure, and store
values limited to **262,144 JSON code units each / 1,048,576 total**. The output emission cap
is not a token window or an artifact download cap. The VM limit is hardcoded; worker concurrency
defaults to two and is configurable through `PI_CODEMODE_MAX_WORKERS`.[^pi-codemode]

**No universal custom-tool text clamp:** the registered-tool wrapper delegates directly;
agent-core accepts the result, runs the optional after-tool hook and creates a `toolResult`
with its content. `AgentSession` runs extension result hooks and image normalization, which
leaves text unchanged; `convertToLlm` passes normal tool-result messages through. The extension
docs therefore tell tool authors to truncate their own outputs. Optional extension hooks can
change this behavior, but the default pipeline does not automatically apply `read`'s 50 KiB
limit to every tool.[^custom-tools]

The **10 MiB share cap is not a general session-history load cap**: Piano's history worker reads
the saved file whole, then uses Pi's `buildSessionContext()` for the snapshot, not every raw
pre-compaction entry ([`server/PiHistoryWorker.ts:28–47,53–58`](../../server/PiHistoryWorker.ts#L28-L58)).
Browser rendering limits and the 8 MiB delivery boundary remain separate.

There is also **no `read`-tool cap on automatically loaded instruction files**: Pi's context-file
loader reads the selected AGENTS/CLAUDE file whole and interpolates its content into the system
prompt. Explicit `/skill:name` expansion reads the skill body whole. These are different paths
from asking the model to call `read` on a skill file; ordinary skill discovery advertises only
name/description/path.[^instructions]

## 6. Whole-model context: tokens and compaction

The selected model's **`contextWindow`** supplies the token window; there is no fixed Piano-wide
number. It can come from model metadata or configuration overrides. Changing local metadata does
not increase the provider's real capacity. Pi's catalog also has `inputLimits.maxRequestBytes`
and image-count metadata, but the 1.5.2 docs explicitly say those fields do not yet rewrite or
reject history; source search found schema declarations, not a universal enforcement path.[^models]

Pi 1.5.2 defaults to automatic compaction enabled, with **`reserveTokens: 16384`** and
**`keepRecentTokens: 20000`**. Trigger: `contextTokens > contextWindow - reserveTokens`.
Each token setting resolves independently through an exact `provider/modelId` override, ordinary
settings, then defaults. These are user/project-configurable and auto-compaction can be disabled.
`keepRecentTokens` is an approximate retention target respecting message/tool-call boundaries,
not a hard per-message size allowance.[^compaction]

Estimation combines valid last-assistant usage with estimates of trailing messages; absent or
invalidated usage falls back to **JS characters / 4**, including prompt/tool declarations, with
an image estimate. It is not an exact tokenizer or UTF-8-byte conversion. Pi checks the projected
context between tool turns before the next assistant request, and supports one compact-and-retry
recovery after selected overflow/length failures. The ordinary pre-prompt check happens **before
adding the new prompt**; it is not a guarantee that an individually enormous new prompt is
pre-trimmed to fit.[^compaction]

Compaction appends a summary and rebuilds future model context from the prompt checkpoint, summary
and retained messages; raw earlier entries remain in session history. During **summary generation
only**, tool-result text is cut to **2,000 JS code units plus a marker**. That is neither the
ordinary live tool-result limit nor a guarantee of preserving every read detail. Repeated bounded
reads can still grow the whole context and eventually be summarized.[^compaction]

## 7. Runtime inventory by subsystem

Tables use **E/I reason evidence** as defined in section 9. Exact-value rationale is unestablished
unless the row names a derivation or recorded reason.

### 7.1. Delivery, peer relay and HTTP envelopes

| Bound / scope | Actual value and enforcement | Reason evidence |
| --- | --- | --- |
| Session subscriber queue, per subscriber | 256 messages and 8 MiB serialized JSON pending. Defaults in [BoundedDelivery:9–42](../../server/BoundedDelivery.ts#L9-L42), allocated for each subscriber in [SessionPublication:154](../../server/SessionPublication.ts#L154). Overflow ends that delivery, not silently trimming a snapshot. | E: overflow errors distinguish oversize view from missed live notices; reconnect for a snapshot. |
| Socket egress, per socket | Queue 256 messages / 8 MiB; in-flight acknowledgement window 32 frames / 8 MiB; single encoded frame 8 MiB; acknowledgement 10 s. [Definition and enforcement](../../server/BoundedDelivery.ts#L57-L107); used by [WsClient:34](../../server/WsClient.ts#L34). Queue measures values before envelope encoding; frame/window use final encoded bytes. | E: close with oversize/reconnect or acknowledgement-timeout reason. Queue default duplicates `socketLimits.queue` in the same module. |
| Remote conversation client frame / buffered send | 1 MiB, `PEER_FRAME_BYTES`; local browser uses section 4's `MAX_MESSAGE_BYTES` instead. [machine:20–22](../../shared/machine.ts#L20-L22), [gateway:17–26](../../server/PeerGateway.ts#L17-L26), [gateway send:144](../../server/PeerGateway.ts#L144), [browser send:185–193](../../web/src/lib/ws.ts#L185-L193). | E **documented policy and purpose**: [ADR 0004 raster images](../adr/0004-same-owner-piano-peer.md#raster-images-separate-preparation-unchanged-conversation-ownership) keeps Stop, dialogs and heartbeats from queueing behind base64 uploads on slow links. |
| Remote conversation server frames/window | Imports 8 MiB frame and 32-frame/8 MiB window from `socketLimits`, not copied values. Initial frames are checked against window at [PeerGateway:128](../../server/PeerGateway.ts#L128); subsequent frames at [175–180](../../server/PeerGateway.ts#L175-L180). WS receive high-water mark 64 KiB at [119](../../server/PeerGateway.ts#L119) is a buffering threshold, not a payload maximum. | E: [ADR 0004](../adr/0004-same-owner-piano-peer.md#boundary-and-consequences) requires a bounded authenticated pipe, without frame rewriting. |
| Peer connection and liveness | Connect/registry handshake 5 s; request default 10 s; peer acknowledgement watchdog 10 s + 5 s = 15 s, checked every 1 s; close-failure grace 1 s. [Definitions](../../server/PeerGateway.ts#L17-L26), [handshake/request](../../server/PeerGateway.ts#L108-L157), [watchdog](../../server/PeerGateway.ts#L210-L227). | I: bound stalled upstreams while allowing relay margin. `ackMs` derivation is explicit; choice of +5 s is not explained. |
| Peer JSON HTTP defaults | Request body 16 KiB; answer/error body 1 MiB; 10 s request signal. [Defaults](../../server/PeerGateway.ts#L17-L26), [response reader and fetch](../../server/PeerGateway.ts#L235-L320), [body validation](../../server/PeerGateway.ts#L365-L385). Actual bytes checked, not only Content-Length. | E: ADR requires whole validated responses, never partial replies, and no retries. Incoming `request.text` is checked after decoding; unlike upload streaming, this is not a pre-buffer byte limiter. |
| Peer Changes HTTP | Answer 4 MiB + 64 KiB = 4,259,840 bytes; deadline 30 s + 5 s = 35 s. [shared/http:566–617](../../shared/http.ts#L566-L617), enforced by gateway reader/signal above. | E: [test: any Changes answer within owner budget](../../test/PeerGateway.test.ts#L350) protects envelope headroom. Derivation explicit; chosen 64 KiB margin not explained. |
| Peer written-file HTTP | Request body override 1 MiB, deadline 35 s; [shared/http:618](../../shared/http.ts#L618). | I: larger path-list envelope than ordinary peer requests. This byte cap can be reached before the count/character schema maxima below. |
| Peer file preview/download | 34 MiB response = largest preview (32 MiB) + 2 MiB envelope allowance; 60 s; **2 in-flight file transfers per peer**, no queue. [shared/http:571–572,625–634](../../shared/http.ts#L571-L634), [gateway:388–407](../../server/PeerGateway.ts#L388-L407). | E: [ADR session surfaces](../adr/0004-same-owner-piano-peer.md#session-surfaces-changes-files-and-the-session-rail); [test: any allowed preview](../../test/PeerGateway.test.ts#L342). Explicit derived envelope; exact margin not explained. |
| Peer command/PR/share HTTP deadlines | Slash commands 45 s + 5 s = 50 s; PR lookup/change 45 s + 5 s = 50 s; session share 60 s + 5 s = 65 s. [RemoteRequests](../../shared/http.ts#L584-L624). | I: let owning operation report its own timeout before relay abort. Already derived from owner contracts. |
| Explicit upload route ingestion | 30 s actual-stream read deadline; per-route `Upload.bytes` and `Upload.concurrent`, refuses excess size/compression/timeout; [Router:56–81](../../server/Router.ts#L56-L81), [slots:153,204–209](../../server/Router.ts#L153-L209). Currently voice sets these caps. | E: errors distinguish unreadable, too large, timed out and busy; no universal claim that every local JSON route uses this gate. |
| Server lifecycle/compression | HTTP graceful shutdown 3 s. WS compression starts at 1,024 bytes with level 3, no context takeover both ways. [main:54–65](../../server/main.ts#L54-L65). | I: shutdown wait and compression work/memory policy. Compression threshold is not an input/output size cap. |
| Browser socket lifecycle | Connect deadline 10 s; ping every 5 s; pong deadline 8 s; reconnect delay 2 s. [ws:77–80](../../web/src/lib/ws.ts#L77-L80), [110–157](../../web/src/lib/ws.ts#L110-L157). Reconnect loop has no total attempt maximum. | E: connection recovery; [ADR](../adr/0004-same-owner-piano-peer.md#boundary-and-consequences) makes browser sole reconnect owner and forbids prompt replay. Not the same deadlines as peer dialing. |
| Browser mutation receipt | 75 s per correlated request before uncertain/no-receipt outcome. [correlatedRequest:4,48–79](../../web/src/lib/correlatedRequest.ts#L4-L79). | E: retains uncertainty instead of asserting an unsent mutation. Not a cancellation deadline for server work. |

### 7.2. Image preparation, transfer and caches

Attachment admission is covered in section 4: `MAX_ATTACHMENTS=10`,
`MAX_IMAGE_BYTES=10 MiB`, `MAX_ATTACHMENT_BYTES=50 MiB`, and base64/message-envelope derivation
in [shared/attachments](../../shared/attachments.ts#L1-L7). The following are **different** limits.

| Bound / scope | Actual value and enforcement | Reason evidence |
| --- | --- | --- |
| Remote binary batch envelope | 16 KiB manifest; body 50 MiB + 16 KiB + 4-byte length prefix = 52,445,188 bytes. [remoteImageLimits:11–20](../../shared/remoteImages.ts#L11-L20); [PreparedImages read:81–121](../../server/PreparedImages.ts#L81-L121); browser manifest [remoteImages:21–29](../../web/src/lib/remoteImages.ts#L21-L29). | E: length-prefixed manifest then original bytes, per ADR image lane. **Derived** body allowance; repeated manifest literal could derive from the same field. |
| Prepared batches, per backend service | 2 total slots, counting reads + retained entries; consumed entries keep slot until release. Unconsumed TTL 10 min, sweep every 30 s and on prepare/claim. [PreparedImages:48–75](../../server/PreparedImages.ts#L48-L75), [130,147–180](../../server/PreparedImages.ts#L130-L180). | E **explicit budget relationship**: [ADR](../adr/0004-same-owner-piano-peer.md#raster-images-separate-preparation-unchanged-conversation-ownership) says two slots reserve up to 100 MiB original bytes; temporary memory avoids another durable store. TTL value has no separate sizing rationale. |
| Image HTTP concurrency | 2 per peer **per lane** (upload/cancel/preview) at gateway; 2 preview reads at owning backend. [PeerImageGateway:27–40](../../server/PeerImageGateway.ts#L27-L40), [PeerImages:31–49](../../server/PeerImages.ts#L31-L49). | E: independent HTTP lanes, busy refusals, no widening of conversation frame cap (ADR). |
| Image transfer byte/time gates | Preview 64 MiB; control response/cancel body 1,024 bytes; 30 s idle + 180 s total stream deadlines. [remoteImageLimits](../../shared/remoteImages.ts#L11-L20), [ImageTransfer:16–96,121–136](../../server/ImageTransfer.ts#L16-L136), [gateway fetch:49](../../server/PeerImageGateway.ts#L49). | E: count actual bytes, abort stalled/oversize streams; reject compressed bodies/redirects. Preview payload max already imports `IMAGE_PREVIEW_BYTES`. |
| Browser image upload/cancel waits | Upload 180 s + 5 s = 185 s; response streamed to 1,024-byte cap. Cancel request 5 s. [remoteImages:59–80,113–119](../../web/src/lib/remoteImages.ts#L59-L119). | I: outer deadline leaves relay margin; best-effort cancellation. Not another upload-size policy. |
| Session image-preview cache, process-global | 64 MiB total original bytes **and per image**; 4,096 image entries; 4,096 image/session memberships. Base64 precheck `4*ceil(64 MiB/3)`. Evicts oldest image/access order or membership. [shared/imagePreviews:2](../../shared/imagePreviews.ts#L2); [ImagePreviews:24–70](../../server/ImagePreviews.ts#L24-L70), [read refresh:104–110](../../server/ImagePreviews.ts#L104-L110). | E: [ADR](../adr/0004-same-owner-piano-peer.md#raster-images-separate-preparation-unchanged-conversation-ownership) calls bytes disposable; reopening can restore an evicted image. I: count caps protect metadata when images are small. Exact 4,096 choices unexplained. |
| Stream/read chunk sizes, not object limits | Peer preview emits 64 KiB chunks [PeerImages:53–60](../../server/PeerImages.ts#L53-L60). Browser image signature reads 12 bytes [messageDraft:45,247](../../web/src/lib/messageDraft.ts#L45-L247); filename cut to 255 code units [256](../../web/src/lib/messageDraft.ts#L256). | I: chunked delivery and minimal signature validation. 255 must agree with both attachment-name schemas; see centralization. |

### 7.3. Voice input

Owner contract: [shared/voiceInput.ts](../../shared/voiceInput.ts#L1-L65). The
[ADR voice section](../adr/0004-same-owner-piano-peer.md#voice-input-main-origin-assistance-machine-owned-drafts)
explicitly calls these resource limits, **not** browser-heap guarantees or provider entitlements.
No external provider documentation was used to assert why 25,000,000 bytes is the correct number.

| Bound / scope | Actual value and enforcement | Reason evidence |
| --- | --- | --- |
| Recording/upload | 25,000,000 decoded audio bytes (decimal, not 25 MiB); 33,333,336 base64 code units; JSON ingress 33,366,104 bytes = base64 allowance + 32 KiB. [shared:5–7,57](../../shared/voiceInput.ts#L5-L57); [VoiceInput:163–170](../../server/VoiceInput.ts#L163-L170); [HTTP upload:499–509](../../shared/http.ts#L499-L509); [dictation:198–205](../../web/src/lib/dictation.ts#L198-L205), [Blob precheck](../../web/src/lib/browserDictation.ts#L8-L12). | E: too-long recording refusal; **derived** base64 and JSON envelope. Actual chunks count, not just claimed size. |
| Recording duration/device | 10 min timer stops/commits; one live recording/permission acquisition per page, while prior transcriptions can continue. Recorder requests chunks every 1 s (not a guaranteed event deadline). [dictation:173–223](../../web/src/lib/dictation.ts#L173-L223), [browserDictation:52](../../web/src/lib/browserDictation.ts#L52), [shared:12](../../shared/voiceInput.ts#L12). | E: ADR's one-microphone ownership; delayed mobile chunks can still exceed expected heap. |
| Server concurrent uploads/transcriptions | 2 permits per transcription route, held around route processing; excess returns busy/429. [shared:10](../../shared/voiceInput.ts#L10), [http:502–503](../../shared/http.ts#L502-L503), [Router:153,204–209](../../server/Router.ts#L153-L209). | E: bounded concurrent work (ADR); not a global bound on browser transcription entries. |
| Provider response and text | 1 MiB response bytes before JSON decode; returned `text` ≤65,536 code units; provider operation default 120 s. [shared:8–9,64](../../shared/voiceInput.ts#L8-L64), [VoiceInput:28–30,90–116,180–204](../../server/VoiceInput.ts#L28-L204). No automatic retry. | E: refuse overlong/invalid transcript and timeouts; ADR says no automatic retries. Separate byte and text contracts. |
| Hints and MIME field | Each project/folder/branch/session hint, and `mimeType`, ≤512 code units; browser trims/cuts hints. [shared:26–28,49–59](../../shared/voiceInput.ts#L26-L59), [web voiceInput:1–4](../../web/src/lib/voiceInput.ts#L1-L4). | I: bounded spelling context and metadata. These are not model context-window limits. |

### 7.4. Workspace files and browser document preparation

[File preview policy](../file-previews.md) names the owners. These limits do not make file access a
filesystem sandbox; Piano may read any supported regular file its server user can read.

| Bound / scope | Actual value and enforcement | Reason evidence |
| --- | --- | --- |
| Per-file preview **and download** | Text/Markdown/HTML/SVG 1 MiB; raster image 10 MiB; audio 20 MiB; video 32 MiB; PDF 20 MiB. [shared/files:3–11](../../shared/files.ts#L3-L11). [WorkspaceFiles:153–199](../../server/WorkspaceFiles.ts#L153-L199) sniffs 8,192 bytes, checks `stat.size`, reads size+1 to detect growth, checks actual read bytes; [download uses same read](../../server/WorkspaceFiles.ts#L250-L266). | E: error recommends opening larger files locally. Byte limits are single shared policy, not duplicated UI caps. Header allocation is a sniffing budget, not a second file maximum. |
| HTML source/CSS strings, per prepared document | HTML ≤1,048,576 code units; each stylesheet/inline CSS ≤262,144; total supplied CSS ≤1,048,576 code units. [html-preview:14–20,68,148](../../web/src/lib/html-preview.ts#L14-L148). | E: fail/omit oversize input in sanitized static document; [policy](../file-previews.md#static-html). Despite names, these checks are not byte measurements. |
| HTML fetched resources | ≤32 unique attempted reads; ≤20 MiB accepted aggregate UTF-8 text/binary resource bytes; preparation abort timer 10 s. Resource read that crosses bytes has already completed but is not retained. [html-preview:83–119](../../web/src/lib/html-preview.ts#L83-L119). | I: cap fan-out, retained resources and stalled file reads. Timer is cooperative, cannot preempt synchronous parsing. |
| HTML output growth | 33,554,432 code units for accumulated embedded data URLs, generated CSS intermediates and final serialized body. [html-preview:18,135,182,362](../../web/src/lib/html-preview.ts#L18-L362). | I: bound embedding/serialization expansion. `embeddedBytes` is a string-length counter, not UTF-8 bytes. |
| HTML/CSS structural work | HTML append ≤20,000 visited nodes, depth ≤64. CSS AST ≤30,000 nodes, depth ≤64 per parse; CSS renderer nesting ≤32; reject further `@import` when ancestor set size ≥8. [html-preview:159–201](../../web/src/lib/html-preview.ts#L159-L201), [append:245–253](../../web/src/lib/html-preview.ts#L245-L253). | I: bounded traversal and import recursion. Parser allocation occurs before AST checks; not a hard parser-memory guarantee. |
| HTML/link metadata | Each accepted HTML attribute, link href and stylesheet media string ≤4,096 code units. [html-preview:285–309](../../web/src/lib/html-preview.ts#L285-L309). File-link reference precheck also 4,096 code units [file-link:37](../../web/src/lib/file-link.ts#L37). | I: restrict oversized link/attribute data. Equal numbers do not alone establish one contract with server filesystem paths. |
| HTML base64 conversion chunk | 8,192 bytes per `String.fromCharCode(...chunk)` call [html-preview:54–58](../../web/src/lib/html-preview.ts#L54-L58). | I: keep spread-argument work bounded; not resource admission or total size. |
| Markdown pre-parse work | Source ≤262,144 code units; blockquote depth ≤32; heuristic work `source.length + Σ(depth*line.length)` ≤4,194,304; backtick/pipe count ≤20,000. [markdown:7–19](../../web/src/lib/markdown.ts#L7-L19); [component fallback](../../web/src/components/Markdown.tsx#L257). | I: avoid costly structured Markdown rendering; too-large source falls back to plain text, not transcript loss. These are workload heuristics, not bytes or tokens. |
| Markdown AST walks | Each walk ≤10,000 nodes, depth ≤32 [markdown:23–26](../../web/src/lib/markdown.ts#L23-L26); parse checks and image extraction [91–113](../../web/src/lib/markdown.ts#L91-L113). | E: explicit “Markdown budget exceeded”; I: limits recursive work after parsing. |
| Markdown image loader, per loader lifetime | 8 unique admitted paths; 20 MiB accepted image bytes; sequential reads (one pump). Failed/non-image reads still consume path admission; crossing-byte image is fetched but not displayed. [markdownImageLoader:4–5,20–57](../../web/src/lib/markdownImageLoader.ts#L4-L57). | I: cap browser image resource retention and fetch fan-out. Independent of attachment/upload policy and HTML embedding budget. |
| Mermaid diagrams | `maxTextSize=50,000`, `maxEdges=500`; one render at a time via module-global promise queue. [mermaid:5–18,34](../../web/src/lib/mermaid.ts#L5-L34). | I: diagram complexity and non-overlapping renderer initialization. Authored code configures library limits; pending queue length/deadline is not capped here. |
| PDF decoded/rendered resources | `maxImageSize=16,000,000` pixels; canvas allowance 32 MiB; displayed page width ≤1,600 px, height-derived bound 8,192 px, area ≤4,000,000 px at DPR 1; reject aspect ratio outside [0.01,100]. [FilePdf:19–20,57,131–149](../../web/src/components/FilePdf.tsx#L19-L149). | I: bound raster work/degenerate page dimensions. Included because resource gates, unlike ordinary CSS geometry. Single current page mounted; zoom UI [0.5,2] is excluded visual control. |
| PDF load wait | 15 s before “taking too long” error unmounts document; [FilePdf:43–50](../../web/src/components/FilePdf.tsx#L43-L50). | E: offer smaller/re-exported PDF. Browser component failure deadline, not a server file-read timeout. |
| Download URL lifetime | Browser revokes download Blob URL after 10 s [WorkspaceFile:111](../../web/src/components/WorkspaceFile.tsx#L111). | I: release browser object resource after download initiation; not file retention/expiry. |

### 7.5. Git, Changes, directories and GitHub

| Bound / scope | Actual value and enforcement | Reason evidence |
| --- | --- | --- |
| Generic subprocess output/termination | Default stdout 8 MiB; stderr **16,384 code units**, despite `STDERR` value using KiB arithmetic; optional timeout supplied by caller; SIGTERM→SIGKILL grace 250 ms, then 250 ms bounded kill wait. [Subprocess:56–67,125–158](../../server/Subprocess.ts#L56-L158). Truncate mode drains output but retains only allowance; otherwise overflow stops child. | E: explicit limit/timeout failure reasons. I: prevent runaway output and shutdown hangs. Not every caller has a default time deadline. |
| Git observations/worktree commands | `gitText` default 20 s / 8 MiB [GitCheckout:71–77](../../server/GitCheckout.ts#L71-L77); home resolution same defaults [180–194](../../server/GitCheckout.ts#L180-L194); Worktrunk runner same 20 s / 8 MiB [Worktrees:24–35](../../server/Worktrees.ts#L24-L35). Branch home observations concurrency 4 [GitCheckout:217–227](../../server/GitCheckout.ts#L217-L227). | I: bound external commands. Repeated 8 MiB follows existing subprocess default, but equality alone does not prove these operations must share future policy. |
| Worktree creation and folder hint | Creation timeout 60 s from [wire:703](../../shared/wire.ts#L703), passed [Worktrees:270–281](../../server/Worktrees.ts#L270-L281); directory root/last-subject hint calls 2 s each, subject cut to 120 code units [Worktrees:69–77](../../server/Worktrees.ts#L69-L77). | E: creation uncertainty warns to inspect before retrying; I: keep folder hint inexpensive. |
| Changes observation concurrency/deadline | 4 global service slots for Changes/summary/written reads; 30 s `CHECKOUT_TIMEOUT_MS`, timer starts **after** slot acquisition. [WorkspaceChanges:247–279](../../server/WorkspaceChanges.ts#L247-L279), [GitCheckout:464–491](../../server/GitCheckout.ts#L464-L491), [wire:415](../../shared/wire.ts#L415). | I: bound active Git work, not queue length/wait. |
| Git metadata/written-file queries | Changes metadata subprocess output 16 MiB; written-file output 1 MiB. [WorkspaceChanges:253–257,275](../../server/WorkspaceChanges.ts#L253-L275). | E: no partial file list on metadata overflow. These are not patch-text limits. |
| Patch excerpts / full response | Initial patch 120,000 bytes; requested file patch 1 MiB; serialized preview answer 4 MiB. [wire:412–414](../../shared/wire.ts#L412-L414), [WorkspaceChanges:154–184](../../server/WorkspaceChanges.ts#L154-L184). Excerpts end at a complete newline via [GitCheckout:397–401](../../server/GitCheckout.ts#L397-L401). `summary` does not call that 4 MiB answer wrapper. | E: initial excerpt/per-file expansion and explicit truncation; response refuses partial file list. Exact thresholds unexplained. |
| Written path request schema and batching | Up to 1,000 paths, each ≤4,096 code units; [http:38–43](../../shared/http.ts#L38-L43). Browser batches at same 1,000 [api:199–205](../../web/src/lib/api.ts#L199-L205). | I: bound work per request while handling longer lists in batches. Already shared; remote 1 MiB body may impose a tighter aggregate bound. |
| Directory listing work | Stat checks concurrency 8, then Git hint collection concurrency 8 per list call; [Directories:41–66](../../server/Directories.ts#L41-L66). No server entry-count cap there. | I: bounded parallel filesystem/process work. Browser's 500 visible results below is not a server listing bound. |
| Sidebar/reference scans | Sidebar discovery and absence checks: 4 each, in parallel (2 branches); [SidebarView:81–94](../../server/SidebarView.ts#L81-L94). Session-reference availability: 4 distinct checkouts concurrently [SessionReferences:150–167](../../server/SessionReferences.ts#L150-L167). | I: per-scan concurrency, not machine-global maximum process count. |
| GitHub CLI lookup | Each `gh` command 15 s / 4 MiB stdout; list open PRs `--limit 100`; one retry without status-check fields only when checks permission was refused. [GitHubPullRequests:268–283,307–322](../../server/GitHubPullRequests.ts#L268-L322). | E: error says “within 15 seconds”; specific compatibility retry, not a network retry policy. |
| PR operation deadline | 45 s `PULL_REQUEST_TIMEOUT_MS` through injectable `PullRequestTimeoutMs` [wire:416](../../shared/wire.ts#L416), [SessionPullRequests:21–35](../../server/SessionPullRequests.ts#L21-L35). | I: bounds compound lookup/change journey (distinct from each `gh` call). Remote wrapper is derived above. |
| Status read auxiliary work | Shared Changes budget 10 s; per linked PR read 5 s; snapshot + Changes in parallel (2), project members concurrency 4. [dispatch:95–97](../../shared/dispatch.ts#L95-L97), [SessionStatus:17–20,78–110,133–156](../../server/SessionStatus.ts#L17-L156). Status extension outer deadline 30 s. | E: best-effort auxiliary facts; missing facts can be null. Project members share the initial Changes deadline; not 10 s each. |

### 7.6. Dispatch, sign-in, sharing and lifecycle

| Bound / scope | Actual value and enforcement | Reason evidence |
| --- | --- | --- |
| Dispatch wait API | 1–32 handles per tool call; optional wait timeout integer 1,000–60,000 ms. Runtime clamps finite input to that range; omitted/non-finite means no total completion deadline. [tool schema:88–94](../../extensions/piano-dispatch/index.ts#L88-L94), [SessionDispatch:71–85](../../extensions/piano-dispatch/SessionDispatch.ts#L71-L85), [parallel observers:870–907](../../extensions/piano-dispatch/SessionDispatch.ts#L870-L907). CLI/runtime function itself does not impose 32 handles. | E: tool description says optional bounded observation, timeout is not child failure. Schema and runtime repeat the same min/max constants. |
| Dispatch creation/read/follow-up | Start 30 s + optional worktree 60 s = 90 s; unreadable/recovery read 30 s; follow-up 30 s; status 30 s shared `STATUS_DEADLINE_MS`; 1 s failure grace before uncertain follow-up result. [SessionDispatch:73–78,225,717–726,918–929,1013,1054](../../extensions/piano-dispatch/SessionDispatch.ts#L73-L1054). | E: uncertain results require inspection, no resend. These govern different phases despite equal defaults. |
| Dispatch rechecks/recovery | At most 3 quiescence rechecks separated by 250 ms; select attempt threshold 3, recovery delay 500 ms (counter reset on recovered read; initial connected selection increments it). [definitions](../../extensions/piano-dispatch/SessionDispatch.ts#L74-L77), [control flow:728–805](../../extensions/piano-dispatch/SessionDispatch.ts#L728-L805). | E: bounded lost-read/quiescence recovery; do not summarize as “3 mutation retries.” |
| Dispatch retained view / answer | Snapshot at most 5,000 messages and 4,000,000 JSON-string code units; else unknown, read in Piano. [SessionDispatch:79–92,755–765](../../extensions/piano-dispatch/SessionDispatch.ts#L79-L92). Status-tool/webhook last answer defaults to 2,000 code units via shared `LAST_ANSWER_CHARS`; [sessionStatus:79–83](../../shared/sessionStatus.ts#L79-L83). **Wait attribution returns full `last.text`**, not that 2,000-character cut, within the snapshot gate: [SessionDispatch:588–595](../../extensions/piano-dispatch/SessionDispatch.ts#L588-L595). | E: “larger than the dispatch tool will hold”; bounded reporting, not Pi context admission. The model-context path is covered separately in sections 5–6. |
| Provider/MCP sign-in attempt | One active attempt or exclusive operation per `SignInAttempts` manager; default expiry 15 min; [SignInAttempts:69–109,145–148,205–227](../../server/SignInAttempts.ts#L69-L227). Provider and MCP construct separate managers [ProviderLogin:86](../../server/ProviderLogin.ts#L86), [McpSetup:212](../../server/McpSetup.ts#L212). | E: busy/expired outcomes; not a global one-sign-in-across-all-subsystems constraint. |
| MCP reach probe | HTTP connection close timer 20 s, subprocess startup close timer 60 s; [McpSetup:63–64](../../server/McpSetup.ts#L63-L64), [257–270](../../server/McpSetup.ts#L257-L270). | I: bound initial reachability check. This requests SDK close, not an independent guaranteed race deadline; authored layer has no additional reply-byte cap here. Pi owns transport internals. |
| Radius package install/uninstall | Abort after 120 s; [RadiusSetup:198–226](../../server/RadiusSetup.ts#L198-L226); one installation operation state [176–198](../../server/RadiusSetup.ts#L176-L198). | E: cannot complete/install-in-progress outcomes. Package manager cancellation may not prove every external side effect stopped. |
| Library shadowing probe / model refresh | Probe request defaults to 10 s [PiLoads:126–143](../../server/PiLoads.ts#L126-L143); Pi CLI `ModelRuntime.create` sets model refresh 15 s [PiRpcCli:7](../../server/PiRpcCli.ts#L7). | I: bound helper/model discovery. Separate from user-session prompt transport deadlines in sections 4–6. |
| Slash commands | Owner reads 45 s `SLASH_COMMANDS_TIMEOUT_MS`: directory probe [DirectoryFacts:130–144](../../server/DirectoryFacts.ts#L130-L144), live host [SessionHosts:503–510](../../server/SessionHosts.ts#L503-L510). | E: user receives retryable command-list failure. Already one shared source used by peer deadline. |
| Raw session sharing | One share in progress per backend, refuses concurrent shares; 60 s whole operation. Saved file 10 MiB is history contract in section 3, not artifact tool's 128 KiB publication cap. [share:4–5](../../shared/share.ts#L4-L5), [SessionSharing:64–75,132–141](../../server/SessionSharing.ts#L64-L141). Browser deadline 60 s + 15 s = 75 s [ShareSessionDialog:74](../../web/src/components/ShareSessionDialog.tsx#L74). | E: [session-sharing contract](../session-sharing.md), explicit busy/unknown states. Radius client transport limits belong to section 3. |
| Idle Pi host expiry | Default 30 min `PIANO_IDLE_MINUTES`; positive values sweep at `min(15 s,idleMs)`; ≤0 disables idle sweeper. [main:31](../../server/main.ts#L31), [SessionHosts:575–589](../../server/SessionHosts.ts#L575-L589), [host idle eligibility](../../server/SessionHost.ts#L145-L155). | E: closes eligible idle hosts, not a hard run-duration cap. Pi host expiry is distinct from operation deadlines. |
| Session event publication | 50 ms coalescing timer [SessionPublication:89–98](../../server/SessionPublication.ts#L89-L98). | I: batch updates before bounded subscriber delivery; not timeout or retention TTL. |

### 7.7. Webhook delivery

| Bound / scope | Actual value and enforcement | Reason evidence |
| --- | --- | --- |
| Configuration | 32 hooks maximum; new additions refused when full. [Webhooks:59,343–344](../../server/Webhooks.ts#L343-L344). URL ≤4,096 code units [shared/webhooks:12](../../shared/webhooks.ts#L12). | E: explicit configuration refusal; no recorded numeric sizing rationale. |
| Pending delivery lanes | 32 pending **per hook per kind** (automatic event vs explicit Test), not 32 combined; Test inserted before queued automatic work. One active send per hook; different hooks may send concurrently. [Webhooks:60,176–219](../../server/Webhooks.ts#L176-L219). Thus with 32 configured hooks, admission can retain up to 2,048 pending jobs plus active sends, subject to other lifecycle state. | E: overflow logs/drops, Test priority; [test stalled receiver](../../test/Webhooks.test.ts#L565). Formula derived, not another declared global cap. |
| Send operation | Default 10 s via `WebhookTimeoutMs`; no automatic retry. Response body cancelled/not read; [Webhooks:39–41,119–160](../../server/Webhooks.ts#L119-L160). Native receiver destroys HTTP response [WebhookReceiver:55–70](../../server/WebhookReceiver.ts#L55-L70). | E: public HTTPS only, receiver responses never displayed because they may echo credentials ([docs](../webhooks.md)). No body cap needed for a body deliberately not consumed. |
| Answer/token bounds | Last answer ≤2,000 code units via shared `LAST_ANSWER_CHARS`; answerTruncated reports loss [Webhooks:267–288](../../server/Webhooks.ts#L267-L288). Literal token max 8,192 ASCII chars; nonempty token min `KNOWN_SECRET_MIN=8` [Webhooks:325–330](../../server/Webhooks.ts#L325-L330), [literalSecret](../../shared/literalSecret.ts#L1-L21), [DisplayProjection:72](../../server/DisplayProjection.ts#L72). | I: using the known-secret minimum makes saved hook tokens eligible for known-secret redaction; section 4 covers that policy. Max comes from shared literal-secret validator, not a webhook-only number. |

### 7.8. Managed preview operation and helper protocol

These govern the **actual app** supervisor/observations, not static file preview. See
[live previews](../live-previews.md) and [ownership ADR](../adr/0003-pi-owned-preview-lifetime.md).

| Bound / scope | Actual value and enforcement | Reason evidence |
| --- | --- | --- |
| App ownership | 1 managed app per canonical workspace; no automatic app restart. [extension contract](../../extensions/piano-preview/index.ts#L52), [adapter existing-intent admission](../../scripts/PreviewAdapter.ts#L1085-L1157), systemd `Restart=no` [533](../../scripts/PreviewAdapter.ts#L533). | E: Pi generation owns lifetime; no transfer/adoption/relaunch. Not a global machine app-count cap. |
| Start/readiness | Default 30 s, accepted 1–90 s start observation; 1 s poll interval; each HTTP GET deadline up to 5 s; background warming window 600 s. [PreviewReadiness:1–4](../../scripts/PreviewReadiness.ts#L1-L4), [schema](../../scripts/PreviewRequest.ts#L10-L11), [adapter validation:1160–1170](../../scripts/PreviewAdapter.ts#L1160-L1170), [poll loop:1221–1247](../../scripts/PreviewAdapter.ts#L1221-L1247), [owner warming:173–187](../../scripts/PreviewOwner.ts#L173-L187). | E: timed-out observation leaves warming app running; window expiry is not process termination. Readiness destroys response after status, so no body buffering. `max(1000,remaining)` means observation is not a strict 90 s wall-clock upper bound including all work. |
| Lock/submission/client wait | Shared preview-state exclusive lock wait 65 s with 100 ms retry; observation socket inactivity timeout 185 s = 65 s + 90 s + 30 s steps allowance. Unconfirmed submission grace 120 s. [PreviewReadiness:5–7](../../scripts/PreviewReadiness.ts#L5-L7), [lock loop](../../scripts/PreviewAdapter.ts#L211-L225), [submission grace:131,1050](../../scripts/PreviewAdapter.ts#L1050), [PreviewClient:12](../../scripts/PreviewClient.ts#L12). | E: busy/retain-identity rather than duplicate launch; derived observation allowance. Socket timeout is inactivity, not an absolute whole-request timer. |
| Host-command subprocesses | Default 5 s; retain last 16,000 stdout bytes and 2,000 stderr bytes; errors cut to last 2,000 code units. [PreviewAdapter:144–169](../../scripts/PreviewAdapter.ts#L144-L169). | I: bound supervisor observations. Unlike generic `Subprocess`, tails rather than head and different failure protocol; don't merge merely because both spawn. |
| Stop/death checks | `systemctl stop` / `launchctl bootout` 15 s; systemd stop grace 5 s; macOS process-group disappearance wait 10 s with 100 ms poll; owner-gone connection probe 1 s. [adapter:267,535,625,784–796](../../scripts/PreviewAdapter.ts#L784-L796). | E: stop must be confirmed before replacement; separate mechanism-specific deadlines. |
| Owner/runner handshake | Owner socket pre-request inactivity 5 s, disabled after newline; runner lease inactivity 5 s, disabled after exact `owned\n`; incomplete runner reply fails at ≥100 code units. [PreviewOwner:86–97](../../scripts/PreviewOwner.ts#L86-L97), [runner:36–52](../../scripts/preview-runner.ts#L36-L52). | I: bound malformed/stalled local helper handshake; persistent lease intentionally has no idle timeout. |
| Preview request/reply envelopes | JSON stdin CLI and owner request each ≤65,536 UTF-8 bytes; client reply ≤32,768 UTF-8 bytes. [preview:11–16](../../scripts/preview.ts#L11-L16), [PreviewOwner:89–95](../../scripts/PreviewOwner.ts#L89-L95), [PreviewClient:16–20](../../scripts/PreviewClient.ts#L16-L20). Checks occur after appending the latest chunk. | E: explicit “exceeds 64 KiB”/“exceeded 32 KiB” errors. Duplicated **same request contract** across helper peers. |
| Startup log/readback caps | Linux journal last 30 records; macOS last 65,536 bytes then last 31 split lines; final redacted logs/details last 6,000 code units; CLI error same 6,000 tail. [adapter journal:637–648](../../scripts/PreviewAdapter.ts#L637-L648), [mac tail:821–825](../../scripts/PreviewAdapter.ts#L821-L825), [redact:870–875](../../scripts/PreviewAdapter.ts#L870-L875), [CLI:30](../../scripts/preview.ts#L30). | E: tool promises bounded startup logs. Tail retained, not full log. Different layers/units; 31 accounts for split representation but source does not document that numeric rationale. |
| Linux log rate gate | systemd 100-message burst / 10 s interval [adapter:539–540](../../scripts/PreviewAdapter.ts#L539-L540). | I: suppress high-rate app logging. This does not impose app memory/CPU/disk limits; macOS log file is not rotated/capped by this code. |
| Preview port domain | Default pool 3,000–9,999 (7,000 ports); allowed local configured range 1,024–65,535, exe.dev 3,000–9,999; reserves 5,173, 7,070, 8,000, 8,001 plus configured/recorded ports. [choosePort:297–309](../../scripts/PreviewAdapter.ts#L297-L309). | E: supported origin range; never stop another listener to free a port. Domain gate, not process concurrency. |

### 7.9. Settings/schema/storage bounds

| Bound / scope | Actual value and enforcement | Reason evidence |
| --- | --- | --- |
| Skill/prompt library drafts | Trimmed name ≤64, description ≤1,024, instructions ≤20,000 code units; raw HTTP schema each field ≤40,000 (`2*TEXT_MAX`). [drafts:3–19,42–79](../../shared/drafts.ts#L3-L79), [Library:50–55](../../server/Library.ts#L50-L55), [UI](../../web/src/components/DraftDialogs.tsx#L81-L104). Extension imports values for descriptions, **does not set schema `maxLength`** [piano-library:14–24](../../extensions/piano-library/index.ts#L14-L24); runtime `checkDraft` is authority. | E: explicit field refusal text. I: larger request envelope allows validation of overlong draft/whitespace; exact factor not documented. Already shared cross runtime. |
| Projects and session titles | Trimmed project name ≤80; project instructions ≤20,000; session title ≤200 code units. [wire:507–516](../../shared/wire.ts#L507-L516), title filter reuse [wire:693](../../shared/wire.ts#L693) and [813](../../shared/wire.ts#L813), [UI project check](../../web/src/lib/projectCommands.ts#L165-L174), [title check](../../web/src/lib/commandForms.ts#L59-L66). Registry generated prompt title ≤80 (`PROMPT_TITLE_MAX`), normal title default 200 [Registry:37,413–416,680](../../server/Registry.ts#L413-L416). | E: explicit schema contract; I: readable generated title vs user-set title. Do not couple project instructions to library body merely because both are 20,000. |
| Literal secrets | Trimmed visible ASCII max 8,192 characters for keys/tokens; [literalSecret:1–21](../../shared/literalSecret.ts#L1-L21); browser maxLength shared in [ApiKeyDialog:74](../../web/src/components/ApiKeyDialog.tsx#L74), [WebhookSettings:304](../../web/src/components/WebhookSettings.tsx#L304); server provider/voice/webhook readers reuse parser. | E: literal-only, no whitespace/command interpretation; size refusal. Source does not cite provider-specific key lengths. |
| Sign-in answer field | ≤16,384 code units in common provider/MCP login answer endpoint [http:145–155](../../shared/http.ts#L145-L155). | I: bound pasted code/URL input separately from literal API secrets. |
| Peer configuration | Config/token file reads each ≤16 KiB; read buffer +1 detects growth; at most 32 peers; display name 1–80 code units; machine ID 1–64 with slug pattern. [PeerConfig:24–44,56–86](../../server/PeerConfig.ts#L24-L86), [machine:4–9](../../shared/machine.ts#L4-L9). | E: [ADR](../adr/0004-same-owner-piano-peer.md#boundary-and-consequences) bounded configured list, unique identity, fail startup on invalid entry. File cap applies to token file too, not shared literal-secret max. |
| URL IDs / image names / paths | Routed ID regex 1–200 ASCII chars [urlId:1](../../shared/urlId.ts#L1), enforced [gateway:372](../../server/PeerGateway.ts#L372), [remote image schema:32–53](../../shared/remoteImages.ts#L32-L53). Attachment names ≤255 code units in both [wire:14](../../shared/wire.ts#L14) and [remoteImages:49](../../shared/remoteImages.ts#L49). Workspace preview/download paths ≤4,096 [http:254,264](../../shared/http.ts#L254-L264); remote image `cwd` same max [remoteImages:37,41](../../shared/remoteImages.ts#L37-L41). | I: bounded identifiers/path metadata. Fixed image hash length is format, not resource limit. Path code-unit limits do not guarantee POSIX byte-length validity. |
| Session-share metadata | Confirmed share URL ≤2,048 code units [share:13](../../shared/share.ts#L13); Radius artifact reply ID ≤256 code units [SessionSharing:49](../../server/SessionSharing.ts#L49). | I: bound externally returned identity metadata. Artifact schema fields are listed below. |
| Registry SQLite lock | `busy_timeout=5000` ms [RegistryDatabase:279](../../server/RegistryDatabase.ts#L279). | I: bound lock contention wait; explicit single-backend database ownership error at [439](../../server/RegistryDatabase.ts#L439). Not a database size/row-count cap. |
| Static cache lifetime | Hashed built assets `max-age=31,536,000` s + immutable; other assets no-cache. [StaticAssets:31–35,168,208](../../server/StaticAssets.ts#L31-L35). | I: one-year browser caching of content-addressed assets. Time policy, not memory cache capacity. |
| Browser storage | Fixed preference keys and machine-scoped keys; unconfigured-machine cleanup, tab/session vs persistent storage rules. [machineMemory:1–123](../../web/src/lib/machineMemory.ts#L1-L123), [storage policy](../browser-storage.md). **No authored byte/count quota or TTL** on catalogs, drafts, open groups/tabs found in these owners. | E: explicit ownership/lifecycle, not a numeric bound; browser quota is external. |

#### Existing single-flight, serialization and latest-only channels

These are concurrency bounds, not “capacity” defaults to move into a giant constants module.
Most one-permit values express mutual exclusion; the invariant itself supplies the numeric reason.

- One registry mutation [Registry:376–379](../../server/Registry.ts#L376-L379), one library-file
  write [LibraryFile:10–13](../../server/LibraryFile.ts#L10-L13), one Pi-settings save
  [PiSettings:33–43](../../server/PiSettings.ts#L33-L43), one voice-settings save
  [VoiceInput:127–145](../../server/VoiceInput.ts#L127-L145), one webhook settings mutation
  [Webhooks:75,331](../../server/Webhooks.ts#L331), one client navigation
  [ClientSessions:97–98](../../server/ClientSessions.ts#L97-L98).
- One host lifecycle operation **per key** [SessionHosts:139–167](../../server/SessionHosts.ts#L139-L167),
  one directory model probe **per key** [DirectoryFacts:48–64](../../server/DirectoryFacts.ts#L48-L64),
  one publication operation [SessionPublication:53–54](../../server/SessionPublication.ts#L53-L54),
  one sidebar publish [SidebarView:66–67,199](../../server/SidebarView.ts#L66-L67). Semaphores bound
  active holders, not queued waiters or number of keys.
- Latest-only capacity-1 channels: [DirectoryFacts changes](../../server/DirectoryFacts.ts#L50),
  [SidebarView](../../server/SidebarView.ts#L66), [SessionHosts changed/lifecycle](../../server/SessionHosts.ts#L141-L142),
  [Webhooks wake](../../server/Webhooks.ts#L77). The transport inventory above covers Pi input queues. Here overwriting stale wake/state is intentional, unlike delivery loss.
- Coalesced readers permit one active read and merge newer requests, but their completion-waiter
  array has no fixed count cap [CoalescedReader:18–49](../../server/CoalescedReader.ts#L18-L49).
  Browser observation keeps one current operation/controller, aborting superseded work, not a
  physical-concurrency guarantee for code that ignores abort [observation:60–64,106–141](../../web/src/lib/observation.ts#L60-L141).
  Default-model save also refuses a second in-progress save [modelCatalogs:146–161](../../web/src/lib/modelCatalogs.ts#L146-L161).
- Ask-user and library-save tools request sequential execution
  [ask-user:26](../../extensions/piano-ask-user/index.ts#L26),
  [library:82](../../extensions/piano-library/index.ts#L82). This is execution scheduling, not a
  shared count quota. Radius create/update also use sequential execution.

### 7.10. Browser work/result caps and refresh load gates

Transcript message/tool clipping is covered in section 5; source locations
include [MessageList:768–772,919–943,1005](../../web/src/components/MessageList.tsx#L768-L1005)
(parameters 8,000, answer/output 20,000, details/nested output 4,000 code units), and
[message error summary:52](../../web/src/lib/messageError.ts#L52) (240/237 + ellipsis).
Do not confuse these with file/network caps above.

| Bound / scope | Actual value and enforcement | Reason evidence |
| --- | --- | --- |
| Suggestion/result visibility | Slash completion 50 results [slashCompletion:4,50](../../web/src/lib/slashCompletion.ts#L4-L50); command palette 50 rows/page [paletteSearch:9,56–63](../../web/src/lib/paletteSearch.ts#L9-L63); recent sessions 8 [commandPalette:68–75](../../web/src/lib/commandPalette.ts#L68-L75); folder matches 500 visible [folderPath:5,25](../../web/src/lib/folderPath.ts#L5-L25). | I: bound rendered result work; palette pagination still exposes all pages. 50s are different result contracts, not automatic consolidation candidates. |
| Changes auto-expansion gate | Large if diff line count >800 [changesView:71,164](../../web/src/lib/changesView.ts#L71-L164); affects collapsed/explicit expansion, not transmitted patch bytes. | I: bound initial rendered diff work. |
| Virtualized row work | Transcript overscan 3 rows [useVirtualTranscript:38](../../web/src/lib/useVirtualTranscript.ts#L38); sidebar buffer 5 rows each side [useSidebarWindow:5,55–58](../../web/src/lib/useSidebarWindow.ts#L5-L58). | I: bound mounted rows relative to viewport; not data retention maxima. Pixel estimates excluded. |
| Checkout refresh | 5 s poll; 250 ms debounce [checkoutRefresh:37–38,56,93–96](../../web/src/lib/checkoutRefresh.ts#L37-L96); written-files observed refresh debounce 600 ms [useSessionFiles:43](../../web/src/lib/useSessionFiles.ts#L43). | I: freshness/work-rate tradeoff, not server request deadlines. |
| Account/installation/status polling | Provider accounts 30 s [providerAccounts:32–41](../../web/src/lib/providerAccounts.ts#L32-L41); sign-in 750 ms [signInAttempt:31,78–81](../../web/src/lib/signInAttempt.ts#L31-L81); Radius installation 1.5 s while running [radiusSetup:66,101](../../web/src/lib/radiusSetup.ts#L66-L101); webhooks settings 3 s [WebhookSettings:92](../../web/src/components/WebhookSettings.tsx#L92); PR refresh 60 s [sessionPullRequest:64,109,281](../../web/src/lib/sessionPullRequest.ts#L64-L281). | I: rate gates for independent owning journeys; equal numbers elsewhere are not shared contracts. |
| Preview focus refresh | At most one focus-triggered refresh per 10 s; one pending status request [previewObservation:75,151–170](../../web/src/lib/previewObservation.ts#L75-L170). | I: prevent repeated focus/network work. Manual refresh has its own pending guard. |
| Search/context debounce | Palette input commit 80 ms [CommandPalette:250](../../web/src/components/CommandPalette.tsx#L250); slash-context request 150 ms [SlashTextarea:137](../../web/src/components/SlashTextarea.tsx#L137). | I: reduce work while typing; these are load gates, not animation timing. |
| Default-model confirmation | Default 5 s timer [modelCatalogs:67,161](../../web/src/lib/modelCatalogs.ts#L67-L161). | I: bounded follow-up confirmation of saved model defaults, not provider-model timeout. |
| Display-derived snippets outside transcript | Prompt fallback description first 60 code units + ellipsis [Prompts:40–43](../../server/Prompts.ts#L40-L43); folder Git subject 120 above. | I: small metadata snippets, distinct from persisted body caps. |

### 7.11. Tooling-only bounds (not product policy)

- [verification-evidence:17](../../scripts/verification-evidence.mjs#L17): Git `maxBuffer=32 MiB`;
  version command `timeout=5,000 ms` [127](../../scripts/verification-evidence.mjs#L127).
- [verify:56–60](../../scripts/verify.mjs#L56-L60): 5 s before escalating interrupted verification
  child to SIGKILL. These govern the verification harness, not user runtime operations.
- [bench/start-session:78–79](../../scripts/bench/start-session.mjs#L78-L79): fake model context
  200,000 / maxTokens 1,024 are fixture declarations, not Piano product limits. Benchmark samples,
  waits and statistics excluded. No benchmark was run.


### 7.12. History, Pi lifetime and protocol-sized metadata

| Bound / scope | Actual value and enforcement | Reason evidence |
| --- | --- | --- |
| Saved-history work queue | **64 distinct jobs**, one active job/worker; duplicate operation/path/session/version shares a promise. Active-job deadline **60 s**, excluding time waiting behind earlier jobs. Failure resolves all pending jobs as failed and terminates worker. [PiHistoryJobs:22–82](../../server/PiHistoryJobs.ts#L22-L82). | E: explicit admission/failure behavior; I: bound retained jobs and isolate parsing from server thread. No recorded rationale for 64 or 60 s. This is not a file-byte cap. |
| History headers/discovery | LRU-like header cache **4,096 entries**; cache only version-stable files whose ctime is more than **1 s** old; per-directory header reads concurrency **16**. [PiHistory:68–175](../../server/PiHistory.ts#L68-L175). Header stream chunk/high-water mark **4,096 bytes** at [39](../../server/PiHistory.ts#L39) is not a header/line maximum. | I: cache freshness/size and bounded filesystem parallelism. Exact sizing rationale unrecorded; the pending decoded header line itself has no byte cap here. |
| Pi stdout allocation reuse | Allocate at least **65,536 bytes** when a partial buffer grows, double as needed but never above RPC record cap. Buffers larger than **1 MiB** may be released after **1 s** once no partial record remains. [PiTransport:38–41,241–277](../../server/PiTransport.ts#L241-L277). | I: avoid retaining large transient allocations while allowing short-term reuse. Neither number is another allowed-record maximum. |
| Pi stderr/exit diagnostic | Retain last **8,192 JS code units**; exit message includes at most last **500** trimmed code units. [PiTransport:195–200,325–331](../../server/PiTransport.ts#L195-L200). | I: bound diagnostics, not model-facing tool output. No exact-size rationale recorded. |
| Pi process closure | **1 s** exit/drain/error coordination waits; finalizer waits **3 s**, then kill with **1 s** force-kill grace. [PiTransport:300–395](../../server/PiTransport.ts#L300-L395). | E: drain final stdout before declaring closure; bound broken-process cleanup. Mechanism-specific waits, not one generic timeout. |
| Dialog recovery | Injected default **10 min** host recovery. Ordinary dialog uses Pi timeout when no later than recovery; tool-owned questions have **no answer deadline** and settle at tool end. [PiSessions:209–211](../../server/PiSessions.ts#L209-L211), [SessionDialogs:241–275](../../server/SessionDialogs.ts#L241-L275). | E: Pi-owned dialog versus tool-owned question lifetime, not a blanket 10-minute user response limit. |
| Nested-call history record | Pi 1.5.2 records at most **256 calls**, **8 KiB UTF-8 argument JSON per call / 32 KiB total**, and **500 error code units**; excess details are omitted and marked incomplete. Source: `node_modules/@earendil-works/pi-coding-agent/dist/core/nested-tool-calls.js:16–20,35–63`. Piano's **256** in [PiRecords:88–117](../../server/PiRecords.ts#L88-L117) interprets that incompleteness; it does **not** independently cap execution or trim the received array. | E: explicit upstream record contract. Keep compatibility with locked Pi rather than folding it into unrelated 256-message queues. |
| Artifact names/identity fields | Tool operation key **128 Unicode codepoints**, title **256 codepoints** via Pi schema; stored receipt title **256 JS code units** via zod. Radius adapter identifier **256 JS code units**. Offset max **Number.MAX_SAFE_INTEGER** is representability, not an allowed file size. [artifact tool:34–85](../../extensions/radius-artifacts/index.ts#L34-L85), [receipt:15–30](../../shared/radiusArtifacts.ts#L15-L30), [RadiusClient:13–27](../../extensions/radius-artifacts/RadiusClient.ts#L13-L27). | I: bounded identity metadata; exact values not established Radius limits. Title schema/receipt are a related contract with **different current units**; establish intended semantics before consolidating. |

## 8. Known gaps: observations, not a request for more guards

These observations avoid inventing caps where the code has none; they are not demonstrated exploits
or requests to modify behavior.

- **Not all data has a product cap.** Registry row counts, number of live host keys, model-catalog
  cache keys, arbitrary local library-file reads, directory listing length, browser stored catalog
  sizes, and Mermaid pending renders have no explicit hard count/byte quota in their authored
  owners. Examples: [DirectoryFacts maps](../../server/DirectoryFacts.ts#L48-L64),
  [library read](../../server/LibraryFile.ts#L24-L35), [directory `readdir`](../../server/Directories.ts#L37-L40),
  [Mermaid queue](../../web/src/lib/mermaid.ts#L5-L7). Lifetime/coalescing and browser/OS limits are
  not numeric capacity guarantees.
- **Deadline is not always end-to-end.** Generic subprocess timeout is optional; waiting for a
  Changes semaphore precedes its 30 s timer; MCP reach asks SDK close; preview socket timeouts
  are inactivity; HTML timer cannot preempt synchronous parser work. Browser generic
  [API fetch](../../web/src/lib/api.ts#L79-L98) has caller signal but no universal deadline/response
  byte limiter. Do not claim “all requests time out at 30 s.”
- **Local JSON routes differ from streaming uploads.** [Router:180–185](../../server/Router.ts#L180-L185)
  uses ordinary `request.json` when a route has no `Upload`; constraints may validate only after
  body allocation. Peer default body checks likewise follow `request.text`. Third-party HTTP
  framework defaults were not audited; no external/default cap is claimed.
- **Library extension readback is not bounded here.** It uses `fetch`/`response.json` with caller
  cancellation, without an authored response-byte/deadline wrapper
  [extension request](../../extensions/piano-library/index.ts#L61-L65),
  [LibrarySave reads](../../extensions/piano-library/LibrarySave.ts#L43-L70).
  The backend library draft maxima do not cap existing hand-edited file/list responses.
- **Retry policies differ.** Peer mutations, voice transcription and preview apps are not
  automatically retried; dispatch retries observation only; `gh` has one checks-permission
  fallback. [SessionHost observer `Effect.retry({})`](../../server/SessionHost.ts#L216) has no
  authored finite attempt bound. Browser WS reconnect is indefinite. These are not one retry
  policy suitable for centralization.
- **Memory caps are layered, not total process budgets.** Count-by-byte validation can follow a
  large received chunk, decoded string or completed resource read; bounded retained output does
  not prove bounded peak heap. Concurrent per-request limits multiply, and no machine-global heap
  quota was found. Managed preview apps are trusted developer processes with no authored CPU/RAM
  sandbox limits; macOS log file retention is unbounded even though log **readback** is bounded.
- **Scope is authored Piano plus relevant Pi context contracts**, not every dependency, OS quota or
  provider setting. The source scan is broad but not a formal proof that every possible resource
  has a cap. Numeric optimality requires workload/service evidence not gathered here.
## 9. Scope and verification

The authored-code audit scanned all **384 TypeScript/TSX/MJS files** under `server/`, `shared/`,
`extensions/`, `web/src/` (excluding vendored `components/ui/`) and `scripts/`. Initial named-bound
scan: **324 matches / 75 files**; expanded work/queue/cache/slice/schema/I/O scans: **1,226 matches /
208 files**, plus supplemental numeric and structural scans. These overlap and are not counts of
independent limits. Definitions were traced to actual enforcement and owning docs/tests; integration
review also checked history-worker/cache/lifetime and nested-call behavior.

The inventory covers data size, text/count/depth/work gates, queue/cache/storage/concurrency,
deadlines/retries, schema maxima and polling load gates. It excludes ordinary CSS dimensions,
animation/gesture/toast feedback timings, status codes, format magic/hash lengths, test wait
budgets and benchmark fixture sizes; renderer pixel/work caps and tooling-only limits are labeled.
Pi package internals are inspected for the context/tool paths relevant to Piano, not an exhaustive
audit of every dependency's internals.

**Reason evidence:** E = explicit owning doc/error/contract/implementation purpose;
I = purpose inferred from control flow. Unless a row identifies a documented numeric rationale or
formula, **the reason for the exact number was not established**. General byte/deadline safeguards
in AGENTS require bounds but do not validate these particular values. KiB/MiB are binary units;
JS length is UTF-16 code units; Pi JSON-Schema string length counts Unicode codepoints; UTF-8 bytes
and model tokens are separate measures. Caps on retained output do not imply equal peak heap caps.

Source inspection, source/relative-link/line-range review and doc-only diff review are the checks
for this research. No behavior, tests, tooling directives or runtime constants changed; runtime
tests/app launches were not needed or run. Existing module tests were consulted as evidence of
contracts, not represented as newly executed. Public Radius docs/OpenAPI/MCP schemas were read;
no account-quota read, upload, permission/expiry/viewer test or contact with Radius was performed.

This records checked source and locked dependencies, not the code/settings loaded by a current
live Pi generation. `PIANO_PI_CLI`/`PIANO_PI_ARGS`, extension hooks and provider settings may alter
behavior. Keep the exact source revision above with this snapshot; it is not a second configuration
source that overrides code.

## 10. Installed-source references

All `node_modules` citations refer to the **locked 1.5.2 packages in this worktree**, not a mutable
upstream `main`. They are reproducible after lockfile installation, but are not tracked-file links.
Relevant installed docs were read in full: `configuration.md`, `settings.md`, `models.md`,
`models-configuration.md`, `rpc.md`, `rpc-commands.md`, `session-format.md`, `compaction.md`,
`codemode.md`, `extensions.md`, `mcp.md`, `skills.md`, `prompt-templates.md`.

[^versions]: [`package.json:30`](../../package.json#L30), [`package-lock.json:1400–1497,1514–1533`](../../package-lock.json#L1400-L1497). The manifest range is `^1.5.2`; the lockfile and installed versions, not that range alone, establish the version researched.
[^input]: [`shared/attachments.ts:1–7,29–36`](../../shared/attachments.ts#L1-L7); [`shared/wire.ts:12–32,356–367`](../../shared/wire.ts#L12-L32); [`server/PiRecords.ts:152–154,581–611`](../../server/PiRecords.ts#L581-L611).
[^pi-input]: `node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/jsonl.js:18–46`, `dist/modes/rpc/rpc-mode.js:314–335,671–696`, `dist/core/agent-session.js:1695–1777` (all subsequent `dist/` paths in this footnote are in that same package).
[^pi-read]: `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/truncate.js:10–11,44–115`; `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/read.js:11–15,30–49,64–170,237–283,297–301`.
[^schema]: `node_modules/@earendil-works/pi-schema/dist/compiler.js:219–228`; `node_modules/@earendil-works/pi-schema/dist/checks.js:209–247`.
[^pi-images]: `node_modules/@earendil-works/pi-coding-agent/dist/utils/image-resize-core.js:9–21,37–54,89–105`; `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/read.js:172–174,212–235`; `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:420–424`; `node_modules/@earendil-works/pi-coding-agent/dist/utils/tool-result-images.js:16–33`; `node_modules/@earendil-works/pi-coding-agent/docs/settings.md:113–114`.
[^pi-bash]: `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.js:13–14,190–192,207–214,260–277,315–324`; `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/output-accumulator.js:33–36,63–80,110–139`.
[^pi-mcp]: `node_modules/@earendil-works/pi-mcp/dist/output-limit.js:6–57`; `node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/tools.js:159–174`.
[^pi-codemode]: `node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/execute.js:21–27,248–250,389–425,519,540–578`; `node_modules/@earendil-works/pi-codemode/dist/source.js:34–72`; `node_modules/@earendil-works/pi-codemode/dist/runtime/prelude-source.js:34–43,290–318,336–353`. The emitted-output accounting explicitly uses `data.length`; the token-looking text budget explicitly uses `combined.length`.
[^display]: [`web/src/components/MessageList.tsx:768–772,915–947,1001–1007`](../../web/src/components/MessageList.tsx#L915-L947); [`web/src/lib/format.ts:17–20`](../../web/src/lib/format.ts#L17-L20); [`shared/cutText.ts:1–5`](../../shared/cutText.ts#L1-L5); [`server/PiRecords.ts:180–252`](../../server/PiRecords.ts#L180-L252).
[^custom-tools]: `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/tool-definition-wrapper.js:1–14`; `node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js:573–678`; `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:402–437`; `node_modules/@earendil-works/pi-coding-agent/dist/utils/tool-result-images.js:12–24`; `node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js:111–116`; `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:2451–2507` (Output Truncation).
[^instructions]: `node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js:129–149,179–209`; `node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js:25–30,98–105`; `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:1811–1825`; `node_modules/@earendil-works/pi-coding-agent/docs/skills.md:41–51`.
[^models]: `node_modules/@earendil-works/pi-coding-agent/dist/core/model-config.js:29–44,58`; `node_modules/@earendil-works/pi-coding-agent/docs/models.md:80–103`; `node_modules/@earendil-works/pi-ai/dist/providers/model-schema.js:60–66`. Window use is in `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:472–486`.
[^compaction]: `node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js:53–67,109–176,181–248,555–642`; `node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js:644–683`; `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:472–486,589–619,1545–1573,2487–2606`; `node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/utils.js:82–141`; `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:201–231,257–286,892–910`; `node_modules/@earendil-works/pi-coding-agent/docs/session-format.md:126–151,227–255`.
