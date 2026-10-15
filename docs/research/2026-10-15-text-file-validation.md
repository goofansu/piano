# Text-file checking: composer and workspace previews

Status: **research and proposed alignment**, 2026-10-15. Audited Piano `afcaf6a`.
This note does not enable composer text uploads or change existing image checks.

## Recommendation

Use one content-based text rule for future composer attachments and workspace previews:
**at most 1 MiB of original bytes, valid UTF-8 throughout, with no NUL bytes**. Do not maintain
an allowlist of text extensions or require `text/*` MIME. `.md`, `.txt`, `.json`, source files,
configuration files, dotfiles and extensionless files can all qualify. A filename selects
presentation, not proof of text. This is Piano policy, not a universal definition of text or a
provider limit.

Retain the preview's binary-name exception: names with an extension in its supported binary
format list must qualify as a supported binary format, not fall back to text. Actual bytes
choose the binary type; the current rule does not require that type to match the extension.
Keep this exception list in one shared policy if implementing composer support, rather than
copying it. Previewable audio/video/PDF files do not thereby become valid composer attachments.

## What exists today

| Surface | Current checks | Source |
| --- | --- | --- |
| Composer | PNG/JPEG/GIF/WebP signature; browser MIME, when supplied, must agree; nonempty; 10 MiB each, four images, 20 MiB total | [messageDraft.ts](../../web/src/lib/messageDraft.ts), [shared policy](../../shared/attachments.ts), [wire schema](../../shared/wire.ts) |
| Workspace preview/download | Supported binary classification, otherwise NUL-free strict UTF-8; text up to 1 MiB; workspace containment and regular-file checks | [WorkspaceFiles.ts](../../server/WorkspaceFiles.ts) |

Preview first examines 8 KiB. NUL-free UTF-8 under a non-binary name takes priority over short
magic signatures, avoiding false rejections of prose starting `BM25`, `MZ`, `ID3` or `%PDF`.
A multibyte character cut by that sample boundary is permitted provisionally; the **whole file**
must subsequently decode successfully. Empty text files are accepted. Supported binary names
include PNG/JPEG/GIF/WebP, the listed audio/video extensions, and PDF—not every binary extension
in existence. Unknown text names remain eligible. These details come from the implementation
above and its [observable contract tests](../../test/WorkspaceFiles.test.ts).

This is not a universal binary detector: some binary formats can consist of valid UTF-8 bytes.
Eligibility means safe treatment as inert source, not certification of the file's intended format.

## Source findings

1. **Strict decoding is necessary.** The [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/#interface-textdecoder)
   specifies fatal decoding errors, streaming decode and BOM handling. Use
   `new TextDecoder("utf-8", { fatal: true })`; ordinary replacement decoding can hide malformed
   input. A streaming decoder needs a final non-streaming flush. A leading UTF-8 BOM is accepted
   and omitted from decoded text by default; byte size still includes it. NUL rejection is our
   additional policy, not a UTF-8 requirement.
2. **Browser MIME is not content detection.** [MDN's Blob.type documentation](https://developer.mozilla.org/en-US/docs/Web/API/Blob/type)
   says browsers generally infer it from the extension, can return an empty string, and can
   vary with local configuration. Therefore missing MIME, `application/json`, or
   `application/octet-stream` must not disqualify otherwise valid text. Conversely, `text/plain`
   must not authorize invalid bytes. Do not broaden the image MIME allowlist to accommodate text.
3. **Validation is layered.** [OWASP's File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
   warns that supplied Content-Type and signatures are insufficient by themselves; recommends
   business-appropriate allowed formats, size limits, filename safety and restricted storage.
   It generally recommends extension allowlisting. Our proposed exception is deliberate: a
   coding assistant needs arbitrary source filenames, but treats accepted text as inert content,
   never as an executable upload or public resource. UTF-8 validity is not malware detection,
   HTML sanitization, secret detection or protection against instructions embedded in documents.

## Aligned checking rules

| Concern | Proposed rule |
| --- | --- |
| Size | Check original byte count before a full read and actual count after reading; accept exactly 1,048,576 bytes, reject one byte more. No silent truncation. |
| Encoding | Validate the entire buffer with fatal UTF-8 decoding; reject NUL anywhere, including after the 8 KiB sample. No guessed encoding or automatic UTF-16/legacy conversion. |
| BOM / whitespace | Accept UTF-8 BOM, empty files, whitespace, CRLF, tabs and Unicode; preserve decoded content without trimming or newline normalization. |
| Names / MIME | No text-extension allowlist or text-MIME requirement. Retain the binary-name exception described above. Names are labels, not filesystem destinations. |
| Syntax | Do not parse JSON/YAML or require well-formed Markdown: broken source is legitimate debugging input. |
| Active formats | HTML, SVG and scripts may qualify as source text, never executed or injected into the DOM. Markdown rendering retains existing safe-rendering restrictions. |
| Browser / server | Share the byte-level text predicate and size constant; browser checks provide quick feedback, server checks remain authoritative. A future upload contract must preserve enough information to validate original bytes, not just already-lossily-decoded strings. |
| Acquisition | Keep workspace containment, regular-file checks and bounded filesystem reads in WorkspaceFiles; local browser selection has a different acquisition boundary. |
| Errors | Distinguish too large, invalid UTF-8/NUL, unsupported binary and read failure. Refusal must preserve the existing draft. |

Alignment means sharing the text contract, not conflating preview and upload capabilities. Do not
change raster MIME/signature policy as a side effect of adding text support.

## Decisions needed for composer implementation

The 1 MiB preview ceiling is a **per-file resource bound**, not a suitable guarantee of model
context fit. Before shipping text uploads, choose an aggregate text budget and count limit, and
how text files enter the prompt/history and restore from queued messages. Empty files can be
valid attachments without making an empty prompt sendable by themselves.

Keep filename metadata untrusted and content clearly attributed; delimiters alone cannot prevent
prompt injection. Do not silently save user-selected files into a workspace or Piano's database.
Account for JSON escaping as well as images' base64 expansion within the existing
[32 MiB transport bounds](../runtime-input-limits.md). Do not simply apply the 20 MiB image batch
allowance to text: byte size and context tokens are different constraints. No provider-capacity
claim or new aggregate limit is established by this research.

## Verification for implementation

Retain the existing preview contract tests; add only uncovered cases at the shared/public boundary:

- Same content accepted as `.md`, `.txt`, `.json`, unknown suffix, dotfile and no suffix, with
  missing/misleading browser MIME; invalid JSON still accepted as source.
- Exact byte boundary and one-byte overflow; count Unicode bytes rather than JS string length.
- UTF-8 BOM, empty text, CRLF and multibyte characters spanning the sample boundary.
- Invalid UTF-8, truncated final code point and NUL after an otherwise valid 8 KiB prefix refused.
- Short signature prose accepted; fake `.png` refused; actual binary bytes never authorized by
  a `.txt` name alone. Unsupported composer binary kinds remain refused.
- Browser upload, paste/drop, removal, mixed-batch failure, send, queue and reload behavior once
  text transport is chosen; directly submitted invalid uploads refused by the server.

Research verification: inspected the cited local implementation/tests and external documentation
on exe.dev; no runtime changes, application run, deployment or paid model calls. This note records
recommended checks, not results from executing them.
