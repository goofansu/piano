# Pi image restrictions: upload policy versus image processing

## Scope and conclusion

Inspected Piano's pinned and installed `@earendil-works/pi-coding-agent` **1.0.2**, its shipped
source and documentation, on 2026-10-06. These are defaults and code-path findings, not a readout
of private user settings or a claim about every custom CLI/provider. No model calls were made.

**Piano's four-image / 5 MiB-per-file / 10 MiB-total limits are our upload policy, not Pi's.**
Pi normalizes incoming RPC images and normally resizes/re-encodes them before storing the user
message and sending it to a model. A larger source file can therefore be acceptable to Pi. [1–4]

## Pi's behavior

| Question | Finding | Source |
| --- | --- | --- |
| Formats | PNG, JPEG (also MIME alias `image/jpg`), GIF and WebP are recognized inline formats. Other MIME types trigger an attempted conversion to PNG through Photon, not a promise of arbitrary-format support. RPC takes MIME plus base64; it does not take a filename extension. | [1, 3] |
| Source file size | No fixed 5 MiB source-upload ceiling was found in the RPC prompt normalization path. Each image is decoded and processed; practical memory, decoder and provider constraints still apply. | [2–4] |
| Default dimensions | Fit within 2000×2000, preserving aspect ratio. This is a preprocessing target, not an upload rejection threshold. | [4, 5] |
| Default encoded size | Strictly below `4.5 * 1024 * 1024` bytes **of base64 text per image**. This corresponds to roughly 3.375 MiB of compressed binary image bytes, not 4.5 MiB of uploaded source file. | [4, 6] |
| Compression | Tries PNG and JPEG candidates, with JPEG quality steps, then progressively reduces dimensions if necessary. The initial JPEG quality is 80. PNG is tried first; the implementation returns the first candidate that fits, not necessarily the smallest candidate. | [4] |
| Model overrides | `inputLimits.images.resize` can override `maxWidth`, `maxHeight`, `maxBytes` and `jpegQuality`. `_limitsModel()` prefers the routed model when present. | [2, 6] |
| Count and aggregate size | The catalog can describe `images.maxPerMessage`, `images.maxPerRequest` and `inputLimits.maxRequestBytes`; Pi explicitly documents that it does **not yet rewrite or reject history based on these fields**. This is not a promise of unlimited provider acceptance. | [6] |
| Disable resizing | `images.autoResize: false` bypasses the normal size/dimension processing for recognized inline formats. Unsupported formats still undergo conversion. Defaults to `true`. | [3, 5] |
| Block images | `images.blockImages: true` replaces image blocks in model input with `Image reading is disabled.` Defaults to `false`. Terminal image visibility is a different setting. | [5, 7] |
| Failure | Failed conversion/resize produces an `Image omitted: …` hint. Prompt normalization skips that image and appends the hint to user text; processing failure need not reject the whole prompt. | [2, 3] |
| History | Normalized image blocks are stored in the user message. Changing models does not reprocess historical images. Pi is authoritative for **processed** images, not necessarily byte-identical uploaded originals. | [2, 6] |

GIF acceptance is not a guarantee of animation support. Resizing can convert it to PNG/JPEG;
provider restrictions still apply. For example, OpenAI's current first-party guide specifically
lists **non-animated GIF**, plus PNG, JPEG and WebP. [3, 4, 8]

## Small local experiment

Called the installed `processImage` directly with a deterministic 2400×1200 noise PNG. This
checks preprocessing, not full RPC delivery or acceptance by a paid provider:

| Mode | Result |
| --- | --- |
| Input | 8,643,903 binary bytes (~8.24 MiB), 11,525,204 base64 bytes. |
| Defaults | Accepted; JPEG, 2000×1000, 3,216,984 base64 bytes. |
| `autoResizeImages: false` | Accepted unchanged; PNG, 11,525,204 base64 bytes. |
| Model-style override (256×256, 524,288 encoded bytes) | Accepted; PNG, 256×128, 108,460 base64 bytes. |
| Invalid PNG bytes | Returned `ok: false` and the image-omitted resize message. |

Output retained at `/tmp/piano-image-restrictions-research/results.json`. The generated source
image was removed afterwards. No session, credential, registry or user-settings changes.

This demonstrates a source image larger than Piano's 5 MiB limit can be processed successfully
by Pi; it does not establish a safe unlimited upload policy.

## Provider boundary

Provider limits apply to the **whole model request**, including images retained from earlier
turns, and are distinct from Piano's new-message upload limits. They depend on provider, endpoint,
model, detail mode and context capacity. Pi's resize profile is not a universal acceptance guarantee.

The OpenAI guide retrieved on this date lists PNG/JPEG/WebP/non-animated GIF, up to 512 MB total
payload and 1,500 images per request, with additional model/detail-specific resizing, patch and
context limits. These are that guide's current API ceilings, **not Pi limits**, and should not be
assumed for a subscription/Codex endpoint, proxy, or every compatible provider. No live provider
request was made to verify them. [8]

Pi's resizer comment describes its conservative byte default as headroom below an Anthropic
limit. That comment is implementation rationale, not independent confirmation of current
Anthropic endpoint limits. [4]

## Implications for Piano

- Keep count/transport/memory caps explicit as Piano policy. Raising the raw-file limit is possible
  without raising Pi's model-input size target, but should be verified with large uploads and
  process/memory budgets first. Do not automatically adopt a provider's maximum request size.
- Let Pi own normalization and model-specific resize settings; avoid implementing a competing
  model-limit table in the browser (INV-01/12).
- Reflect Pi's normalized transcript and omission hints. A locally successful preview does not
  prove the model received the image (INV-03).
- Four images in the composer does not guarantee the eventual full-history request fits its
  provider's count, byte or token budgets.
- No behavior changes are made by this research. Existing Piano upload limits remain unchanged.

## Primary sources

Paths below refer to the installed, version-pinned package under
`node_modules/@earendil-works/pi-coding-agent/`; these were read locally, not inferred from a
possibly newer upstream branch.

1. `docs/rpc-commands.md`, Prompting; `docs/message-types.md`, ImageContent;
   `dist/modes/rpc/rpc-mode.js:300–324` (forwards RPC images into the session).
2. `dist/core/agent-session.js`, `_limitsModel` (~298), `_normalizePromptImages` (~1453),
   `prompt` (~1476–1573): processing occurs after pre-start hooks and before building the user message.
3. `dist/utils/image-process.js`: inline MIME normalization, conversion, resize and omission logic.
4. `dist/utils/image-resize-core.js`: default constants, base64 size calculation and encoding loop;
   `dist/utils/image-resize.js`: worker/fallback execution and dimension hints.
5. `docs/settings.md`, Terminal and display; `docs/configuration.md`, settings ownership;
   `dist/core/settings-manager.js`, `getImageAutoResize` and `getBlockImages`.
6. `docs/models.md`, **Describe model input and caching**: overrides, defaults, history and
   non-enforcement of hard request-limit metadata.
7. `dist/core/sdk.js:149–179`, `convertToLlmWithBlockImages`.
8. [OpenAI: Images and vision, Image input requirements](https://developers.openai.com/api/docs/guides/images-vision#image-input-requirements),
   retrieved through web search and full-page fetch. Fetched text retained at
   `/tmp/pi-web-fetch-cu6Toc/output.md`.
9. Piano `shared/attachments.ts` and `shared/wire.ts`: our upload count/type/size policy.

Documentation/source review plus the bounded preprocessing experiment suffice for this research;
no application suite or browser run was needed. **No restart needed**, no services affected, and
no build, deployment or browser reload required/performed.
