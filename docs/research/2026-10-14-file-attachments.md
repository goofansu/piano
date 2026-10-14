# Practical file attachments: text, PDF and MP4

Research date: 2026-10-14. **Proposal, not implemented or accepted upload policy.**
Source baseline: Piano `bf0116bc8c2800e229d22c16170f88ce006f5703`; installed
`@earendil-works/pi-coding-agent` and `pi-ai` both 1.2.0. Scope: files attached to
session messages, not a general file manager or shared project context.

## Recommendation

Ship **text files first, PDFs second, short MP4 screen recordings third**. Separate
accepting a file, previewing it, and supplying useful model context. A browser playing
an MP4 does not mean the model received video.

Keep Pi responsible for model calls and conversation history. Initially convert accepted
files into Pi's existing text/image inputs, rather than adding provider calls inside
Piano. Native PDF/video should be an upstream Pi capability or an explicitly configured
Pi tool, not a hidden second provider integration.

| Input | Practical first support | Important limitation |
| --- | --- | --- |
| TXT, Markdown, logs, JSON, CSV, source files | Validated UTF-8 text, filename and content supplied in the user message | Context budget; CSV is text, not spreadsheet computation |
| PDF | Page-labelled text extraction; selected page images for scans and diagrams | Extraction is not OCR; text alone loses layout and graphics |
| MP4 | Selected timestamped frames plus optional user-supplied transcript | Sampled images omit audio and can miss motion or brief events |

These are recommendations derived from the transport constraint below, not claims of
current Piano support.

## What exists today

- Piano's [attachment policy](../image-attachments.md) allows PNG/JPEG/GIF/WebP,
  four images, 10 MiB each and 20 MiB combined. These are original-upload limits,
  not provider limits. [Validation](../../shared/attachments.ts) recognizes raster
  signatures; [wire types](../../shared/wire.ts) admit only image attachments.
- [PiRecords](../../server/PiRecords.ts) validates attachments and converts them to
  RPC `images`; history projection also recognizes image blocks. Changing only the
  file picker's `accept` attribute would not implement other formats.
- Pi 1.2.0 RPC `prompt`, `steer` and `follow_up` accept a message string and optional
  `ImageContent[]`. Its `UserMessage` and tool-result content use text/image blocks,
  not PDF, generic file or video blocks. RPC mode explicitly rejects CLI `@file`
  arguments. Sources: installed `docs/rpc.md`, `docs/rpc-commands.md`,
  `docs/message-types.md`, `dist/modes/rpc/rpc-types.d.ts` and Pi AI
  `dist/types.d.ts`; corresponding [versioned RPC docs][pi-rpc],
  [commands][pi-commands] and [message types][pi-messages].
- Pi's installed `dist/core/tools/read.js` supports text and raster images. It does
  not implement PDF extraction or MP4 decoding. Merely placing either binary on disk
  and asking the ordinary read tool to read it is not adequate support.
- RPC `clear_queue` returns text only. At the research baseline,
  [PiSessions](../../server/PiSessions.ts) rejected image-bearing submissions while Pi
  was working. Piano now allows queued images with explicitly text-only restoration
  (see [attachment policy](../image-attachments.md)); this does not add PDF/video support.
  Text converted entirely into the message can use text queue semantics, but restoring
  a file chip would need separate, durable attachment identity. [Source][pi-commands].

## Provider support is not Pi support

| Primary source | Documented capability | Consequence for Piano |
| --- | --- | --- |
| [OpenAI file inputs][openai] | Responses accepts several document/text formats; PDF processing includes extracted text and page images on vision models. Chat Completions file inputs are PDF-only. The guide lists each file under 50 MB and 50 MB combined per request. | These API-specific capabilities/limits do not expand Pi's RPC or Piano's upload policy. |
| [Anthropic Files API][anthropic] and [citations][citations] | PDF uses a `document` block; document citations support PDF/plain text/custom content. Scans without extractable text do not yield text citations. | A PDF is not an `image` block with a different MIME type. Native document/citation semantics require adapter work. |
| [Gemini video understanding][gemini] | Supports `video/mp4`, audio and visual understanding, uploaded-file processing and configurable video processing. | Native video is feasible upstream, but not through Pi 1.2.0's text/image message contract. |

Provider documentation is mutable and endpoint/model-specific. Do not silently change
providers, assume a user's coding subscription includes these APIs, or upload files to
another service. Any optional analysis tool needs explicit configuration, costs and
retention disclosure. No provider calls were made for this research.

## Proposed delivery slices

### 1. Text: smallest useful implementation

Accept a deliberate text/code allowlist, not every `text/*` or arbitrary extension.
Check bytes server-side: strict UTF-8 decoding (optionally removing a UTF-8 BOM), reject
binary/NUL content, and explain unsupported encoding. Preserve line breaks and filename;
escape filenames in UI and treat the entire body as untrusted reference material.

Send bounded content in a clearly labelled user-message section, with the user's actual
request distinct from file contents. Never interpret attachment text as a slash command
or skill invocation; Pi expands such commands in prompt text [source][pi-commands].
Delimiters improve clarity but are not a security boundary against prompt injection.

For the first slice, prefer a small inline-only limit and an actionable rejection over
silent truncation or a new file-storage subsystem. **Suggested starting policy for
validation, not a measured optimum:** four files and 64 KiB of decoded UTF-8 text combined
per message. Byte size is not a token estimate; check the assembled prompt against the
existing input-limit handling and available context, including the user's text.

A later large-file mode can store originals and pass an explicit server-local path for
Pi tools to read in chunks. A browser-local filename is not a usable server path. That
mode needs retention, session/fork references and missing-file behavior before release.

### 2. PDF: preserve provenance and expose loss

Prototype PDF.js as the first extraction candidate. Its [documented API][pdfjs] exposes
page text items (`getTextContent`); these are positioned text items rather than a promise
of correct paragraphs, tables or reading order. Evaluate multi-column text, tables and
Unicode with real fixtures before choosing it.

- Keep page numbers in extracted text and let the user choose a bounded page range.
- Offer selected page images when layout matters or a scan has no usable text. Do not
  label an empty extraction as a successful document read. OCR is a separate later
  capability; vision over a rendered page is also not guaranteed accurate transcription.
- Fit derived images within the existing image count/byte policy, counting user images
  and derived images together. Initially permit at most the remaining four image slots;
  don't flatten an entire book into tiny contact sheets to evade the limit.
- Distinguish original-file limits from extracted-text, rendered-pixel, output-image,
  page-count and processing-time limits. Define all before shipping. Handle password-
  protected, corrupt and oversized PDFs with actionable errors.
- Run server extraction/rendering in a bounded worker/process so it cannot block the
  request loop. Browser-only conversion avoids server parser installation but makes
  mobile resource usage and post-reload reproducibility harder; prototype before choosing.

Suggested experiment: text-only PDF, scanned page, diagram and two-column document.
Compare extracted text and selected rendered pages with the source manually; this is
cheaper and more deterministic than starting with model-based quality claims.

### 3. MP4: explicit screen-recording support, not full video understanding

Evaluate FFmpeg/ffprobe for probing and frame extraction. Their [official reference][ffmpeg]
documents media probing and the `fps` filter. Server decoding is a candidate, not an
installed or verified Piano dependency.

Start with a user-selected short interval and up to the remaining image slots of frames.
Record actual sample timestamps alongside images, and allow users to choose frames
around a UI failure. Show **“Sampled frames; audio not included”** before sending and
in the submitted context. Ordinary speech transcription, continuous motion reasoning
and full-video analysis are not covered by this slice.

MP4 upload-byte limits alone cannot bound decoding: cap duration, dimensions, output
pixels/bytes, process runtime and concurrency; validate streams/codecs rather than
trusting `video/mp4`. Use argv-based process spawning, no filename interpolation in a
shell, and prevent network protocol access. Decide OS packaging and dependency-update
ownership before adopting native binaries. If full audiovisual understanding is the
actual requirement, prefer a separately configured Pi video-analysis tool or upstream
native video rather than presenting sampling as equivalent.

## Storage, lifecycle and security decisions

The inline-text slice can avoid retaining originals. PDF/video previews or later large
files need a defined attachment store outside Git and outside database transcript JSON:

- Opaque IDs, generated storage names, content digests and display filenames. Never let
  client filenames choose filesystem destinations or overwrite checkout files.
- Bind upload handles to their intended workspace/session or pre-session draft; resolve
  the binding when starting a session. Use IDs in HTTP URLs, not filesystem paths.
- Separate upload/conversion completion from prompt acceptance. Stage all selected
  conversions before send; a failed file must not silently disappear from a message.
- Preserve prepared content on rejected delivery. For ambiguous delivery, reconcile
  with Pi rather than automatically resend. Disconnect must not duplicate work.
- Keep submitted text/images authoritative in Pi history. Store original/derived blobs
  and technical metadata separately; do not create a second transcript. Reopening must
  not depend solely on browser draft state.
- Define abandoned-upload expiry, submitted-file retention, fork/clone sharing and
  explicit deletion. Report missing originals honestly; do not erase sent history.
- No remote URL ingestion initially (avoids a new SSRF surface). Do not render uploaded
  HTML as application-origin markup. Treat PDF/video parsers as attack surfaces; use
  patched dependencies, resource limits and process isolation. A subprocess alone is
  not a sandbox. Retain private authenticated access around Piano.

Affected [invariants](../development-invariants.md): **INV-01** history ownership;
**INV-02/03/05** lifecycle, delivery and reconnect; **INV-07** workspace identity;
**INV-11** untrusted content and private access; **INV-12** real Pi compatibility.
This proposal preserves the RPC architecture in [ADR 0001](../adr/0001-pi-rpc-workspace-workbench.md).

## Implementation acceptance checks

Before behavior changes, narrow each slice to an observable claim:

1. Text: accepted bytes reach Pi once with filename/line breaks intact; malformed or
   over-budget input never reaches Pi. Cover mixed files, file-only sends and text
   that begins with a slash command. Confirm queued restoration is lossless.
2. PDF: fixture text keeps page provenance; scan/diagram mode yields the chosen pages;
   partial extraction, unsupported encryption and budget exhaustion are visible failures.
3. MP4: actual chosen timestamps and frames reach Pi; audio omission is visible;
   unsupported media, timeout and cancellation release temporary files/processes.
4. Lifecycle: start/open/continue/reload preserves sent content, model switching cannot
   silently discard image derivatives, and reconnect never resubmits. For stored files,
   test wrong-workspace handles and fork/cleanup reference retention.

Use the existing fake-Pi boundary for transport contracts and scratch-browser journeys
for composer behavior. An eventual real-Pi compatibility smoke check is distinct from
provider documentation review; keep model prompts minimal and read replies back.

## Research evidence and limitations

Inspected local source/declarations and installed Pi documentation on an exe.dev Linux
VM at the baseline above; searched first-party provider/conversion documentation.
No background-agent runner was available, so research was performed directly. No
converters were installed, fixtures decoded, model calls made or runtime behavior
changed. Conversion quality, performance, packaging and numeric PDF/video limits remain
unverified. Documentation-only verification is source/relative-link review and
`git diff --check`; application tests/browser checks are intentionally not claimed.

[pi-rpc]: https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/rpc.md
[pi-commands]: https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/rpc-commands.md
[pi-messages]: https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/message-types.md
[openai]: https://platform.openai.com/docs/guides/pdf-files
[anthropic]: https://platform.claude.com/docs/en/build-with-claude/files
[citations]: https://platform.claude.com/docs/en/build-with-claude/citations
[gemini]: https://ai.google.dev/gemini-api/docs/video-understanding
[pdfjs]: https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html
[ffmpeg]: https://ffmpeg.org/ffprobe-all.html
