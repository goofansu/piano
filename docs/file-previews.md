# Local file previews

Click a local Markdown link such as `[guide](docs/guide.md)` in a session to open it read-only in
the Surface area beside the conversation, where Changes opens too. Side by side the area is
resizable from its left edge and remembers its width; where the areas take turns, the file gets
Each file opens in a tab of its own, added at the end; a file already open is read again in its
tab. Closing a tab shows its neighbour; one area at a time, closing a file opened from the
conversation returns there. Links in the conversation use the session's working directory;
links and images in a Markdown preview use that document's directory. Paths may leave the
workspace: `../sibling-worktree/evidence.md` and absolute paths such as `/tmp/abc.md` open the
specified file, including through symlinks. Piano does not search other worktrees for a missing
file. There is no directory browser or path entry.
Click the original link again to reread; **Preview / Source** only changes presentation.

## Formats and limits

| Format | Preview | Maximum file size |
| --- | --- | --- |
| UTF-8 Markdown (`.md`, `.markdown`) | Rendered Markdown, with Source toggle | 1 MiB |
| UTF-8 source, JSON, YAML, logs, unknown text | Shiki highlighting when recognized; otherwise plain text | 1 MiB |
| UTF-8 SVG (`.svg`) | Native image on a light background, with Source toggle | 1 MiB |
| PNG, JPEG, GIF, WebP | Native image | 10 MiB |
| MP3, WAV, Ogg audio (`.ogg`, `.oga`, `.opus`), FLAC, M4A | Native audio controls | 20 MiB |
| MP4, WebM | Native video controls | 32 MiB |
| PDF | React-PDF / PDF.js, selectable text, Previous/Next page and zoom | 20 MiB |

Container recognition does not guarantee codec support. Common browser choices are PCM WAV,
MP3, Opus/Vorbis Ogg, H.264/AAC MP4 and VP8/VP9 WebM; availability varies by browser and platform.
A decoder failure asks you to convert the original. Media never autoplays. SVG previews use a Blob
URL in an `<img>`, never inline SVG, an object or an iframe; scripts, event handlers and external
resources are disabled by browser image mode. Source stays
available even when the image cannot decode. HTML and MDX are not executed.

Highlighting uses a disposable worker, lazy grammars/themes, at most 65,536 characters and
2,000 characters per line, and a three-second work budget. Larger files stay readable as source,
rendered in blocks of 500 lines (one text and one line-number gutter each) that the browser lays
out and paints only near the view, so a file up to the 1 MiB limit opens without blocking the
page. An expanded diff in Changes renders its rows in the same blocks.
Markdown uses Streamdown in static mode, with CommonMark/GFM support including fenced code
inside lists, tables and reference links. Conversations use its streaming mode to format incomplete
responses; files do not repair unfinished Markdown. Piano retains its own links, code-copy controls
and resource policy. Input above 262,144 characters or the nesting/structure budgets falls back to
readable source. Link and image discovery use the same remark grammar as rendering.

Assistant replies and Markdown previews load at most eight distinct local images per prose
surface, sequentially, retaining at most 20 MiB of image bytes. Images appear in place as thumbnails
within the content width and a 192 × 192px maximum, without cropping or upscaling; clicking one
opens its full file-preview tab. Unavailable, undecodable and over-budget images remain clickable
local links; remote images never load.
Markdown diagrams remain escaped code in file previews.

PDF displays only one page at a time, with 50–200% zoom, a 1,600-pixel maximum canvas width,
an 8,192-pixel maximum canvas height, a four-million-pixel canvas budget and device pixel ratio 1.
Each page is measured before allocating its canvas; extreme/invalid page dimensions ask for a
standard-size re-export. Old pages are cleaned up. PDF.js
image decoding is limited to 16 million pixels, with a 32 MiB canvas conversion budget. Opening
has a 15-second timeout. These are resource bounds, not a sandbox against malicious documents.
Corrupt PDFs ask for a checked/re-exported original; password-protected PDFs require an unlocked
copy saved locally. Oversized files are refused before their bodies are read.

## Download

The viewer's **Download** control saves the open file as it is on disk, byte for byte: Markdown
comes down as its source, text without the display redaction, media and PDFs as the original.
`POST /api/workspace/file/download?workspaceId=…` takes the same body path, applies the same
path resolution, format and size rules as the preview, and answers with an uncached, unsniffed
attachment. A file that cannot be previewed cannot be downloaded.

## Ownership and privacy

`WorkspaceFiles` owns path resolution (including symlinks), regular-file checks,
content-signature classification, filename language inference and bounded reads. Unknown binary
and executable formats are refused; extensions alone never authorize binary rendering. Which
extensions claim which format is one list, `previewKindsByExtension` in `shared/files.ts`: the
server reads it to classify a file, and the browser to pick a tab's or output's icon before reading
it, so the two cannot disagree. Other names show the text icon until read. A file
whose first 8 KiB are NUL-free UTF-8 is text unless its extension names a binary format, so prose
that happens to start like a signature (`BM25…`, `ID3…`, `%PDF…`) previews as text. A file
that changes length during acquisition must be reread. The initial sample only selects a candidate
format: **all text bytes** must subsequently decode as strict UTF-8 with no NUL bytes. Empty text
and a leading UTF-8 BOM are accepted; text extensions and syntax validity are not allowlists.
See the [text-file checking research](research/2026-10-15-text-file-validation.md) for the proposed
alignment with future composer text uploads (not yet implemented).

`POST /api/workspace/file?workspaceId=…` carries the path in its JSON body, never its URL.
Text responses use JSON and the existing display-redaction policy. Binary responses use a bounded
multipart body containing metadata and original bytes, not base64 JSON or a public file URL.
Both use `Cache-Control: no-store`, registered workspace resolution and the normal origin checks.
There is no streaming/range interface or persistent file cache in Piano's database (INV-01).

File access is not restricted to a repository or to files a session created: any supported regular
file readable by Piano's server process can be opened, including sensitive files outside the
checkout. The workspace ID supplies the session context, not a filesystem sandbox. Piano must
remain behind private authenticated access (INV-11). Git's Changes and written-file tracking
remain scoped to the workspace; opening an external file does not add it to those lists.

**Arbitrary image, audio, video and PDF bytes are not secret-redacted.** Only open files appropriate
for your private browser session. Existing text redaction is heuristic, not containment. Rendered
Markdown does not execute raw HTML; remote embedded resources are not fetched. PDF annotations,
links, forms and XFA are disabled: document actions and scripts are not run. No document is uploaded
to a third-party viewer (INV-11).

The session supplies a stable workspace ID and explicit link-click request. The common preview
module owns acquisition, cancellation, errors and Blob URLs; format renderers only consume acquired
content. Repeat clicks reread, background workspace snapshots do not. Closing or changing session,
workspace or file invalidates old reads; media stops, workers are released and Blob URLs are revoked
when their consumers are removed (INV-07). Renderer controls do not register new global shortcuts.

## Dependencies and verification

Vite self-hosts the worker, CMaps, standard fonts and WASM from the locked PDF.js package. The
renderer loads only for PDFs; the highlighting worker uses ES modules so languages/themes remain
separate lazy chunks. Generated `web/public/pdfjs/` assets are ignored, copied for development and
included in builds. When upgrading React-PDF, verify `npm ls react-pdf pdfjs-dist`, the emitted
worker and asset versions, and a scratch-browser PDF render.

Module checks cover file classification/limits/path resolution, text redaction, binary transport and
safe Markdown placeholders. Browser evidence for PIN-32 covers the four format groups, nested
links/images, toggle without reread, repeat clicks, late completion, an actual background workspace
refresh, session/workspace changes, media disposal/codec failure, PDF errors and mobile/keyboard use.
See [testing policy](testing.md) for evidence scope (INV-09).
