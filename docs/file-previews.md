# Local file previews

Click a local Markdown link such as `[guide](docs/guide.md)` in a session to open it read-only in
the Surface area beside the conversation, where Changes opens too. Side by side the area is
resizable from its left edge and remembers its width; where the areas take turns, the file gets
Each file opens in a tab of its own, added at the end; a file already open is read again in its
tab. After a successful read, tabs adopt the server-resolved path and merge duplicate spellings,
keeping the first tab's position and the latest explicit open's acquisition and return area,
regardless of completion order. Adopting the path retains the successful read, not another request.
The browser does not collapse `..` before reading: a directory symlink can change its destination.
Failed reads keep the requested path.
Closing a tab shows its neighbour; one area at a time, closing a file opened from the
conversation returns there. Links in the conversation use the session's working directory;
links and images in a Markdown or HTML preview use that document's directory. Paths may leave the
workspace: `../sibling-worktree/evidence.md` and absolute paths such as `/tmp/abc.md` open the
specified file, including through symlinks. Piano does not search other worktrees for a missing
file. There is no directory browser or path entry.
Click the original link again to reread; **Preview / Source** only changes presentation.

## Formats and limits

| Format | Preview | Maximum file size |
| --- | --- | --- |
| UTF-8 Markdown (`.md`, `.markdown`) | Rendered Markdown, with Source toggle | 1 MiB |
| UTF-8 HTML (`.html`, `.htm`) | Isolated static document, with the same Preview switch as Markdown | 1 MiB |
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
available even when the image cannot decode. HTML scripts and MDX are not executed.

### Static HTML

HTML opens as a document, not an app: no server, managed preview, or public file URL. The browser
parses it with a non-browser HTML parser, rebuilds allowed HTML and CSS in a detached, inert template,
and places the result in an opaque-origin `srcdoc` iframe with a restrictive CSP and
`sandbox="allow-scripts"` **only**. The one executable script is Piano's fixed click bridge,
authorized by its exact SHA-256 CSP hash; document-authored code never runs. Scripts, event
attributes, embedded frames/objects, forms and form controls, inline SVG/MathML, refreshes and
base URLs are removed. Native `details` and `summary` remain interactive. CSP otherwise permits
only inline styles and bundled data images; network, fonts, media, workers, script attributes,
eval and form actions are denied. There is no same-origin, popup, download, form or top-navigation
allowance, and no authored frame-navigation surface.

#### User-clicked links and the trust boundary

Every `href` is still removed, including fragments: `srcdoc` inherits the parent's base URL, so
allowing even `#section` would not reliably stay in the document. Supported anchors instead become
keyboard-focusable links without a browser destination. A real primary click (including a modified
primary click) or Enter activates them; no context-menu destination or middle-click behavior is
provided. Local paths follow Markdown's file-link policy (including absolute paths and local
`file:` URLs) and open a Surface tab through the existing workspace-file navigation. HTTP(S) links
follow explicit Markdown links' policy: a new browser tab, no opener and no referrer. Other schemes,
protocol-relative links and invalid URLs remain text. Local link query strings and cross-file
fragments are discarded, as in Markdown; a destination file opens at its normal initial position.

A same-document `#id` link decodes the fragment and scrolls/focuses that ID inside the frame;
`#` scrolls to the top. Neither changes the frame URL, browser history or Piano route. Missing IDs
have no effect; legacy named anchors and fragment-driven CSS `:target` are not supported.

The bridge contains no interpolated document text, eval, network calls or inbound message handler.
Sanitization strips all authored bridge attributes; preparation alone assigns link indices. The
bridge captures that table before interaction and accepts only trusted browser click/Enter events,
not scripted dispatch or `.click()`. For local/web links it sends exactly a type, per-preparation
random token and integer index. The parent accepts only trusted message events from the **exact
current iframe WindowProxy**, with opaque `"null"` origin, matching token, exact message shape
and an in-range index. An opaque origin alone is not identity. Destinations and workspace IDs never
come from messages: the parent looks up an already validated destination in its own table. The
frame cannot access Piano's DOM, storage or API. CSS/resource bundling never gains a network grant.

Each document generation gets a new iframe and token. Listener disposal is synchronous at React
commit on owner/content change or close; hidden tabs, the session rail/Agent view and Source mode
also disable message admission. Preparation aborts on disposal and late results are discarded.
Returning to a retained tab or toggling Preview back on reuses its prepared bytes, not new reads.
The sandbox's script allowance is solely for this bridge, not permission to run HTML applications;
changes to its source, CSP, sanitation or message/lifecycle checks require renewed browser security
observations.

Relative local stylesheets and images are read through the same workspace-file seam, never by
unrestricted browser fetching. CSS imports resolve relative to their stylesheet, with cycles stopped;
CSS `url()` images and HTML `img` sources become embedded PNG, JPEG, GIF, WebP or image-mode SVG.
Absolute paths, schemes (including user-supplied data/blob URLs), protocol-relative references,
remote resources and `srcset` are not automatic reads. Relative `..` references are supported;
existing file resolution can follow symlinks and leave the workspace, as it does for Markdown.
CSS is parsed, not rewritten with URL regular expressions. Unsupported loading functions (including
`image-set`), font faces, unsupported at-rules and parser-recovered CSS fail closed. Simple and
media-qualified imports are supported; imports with `layer()` or `supports()` qualifiers are not.

Preparation permits at most 32 distinct resource reads, 20 MiB of acquired resource bytes,
eight stylesheet import levels, 256 KiB of characters per CSS input and 1 MiB of CSS characters
in total. HTML is bounded to 20,000 visited nodes / 64 levels, CSS structure is bounded, embedded
output to 32 MiB of characters, and asynchronous preparation to ten seconds. The normal per-file
limits also apply. Missing, refused or over-budget resources are omitted; whole-document limits
leave Source available. These are resource bounds, not protection against every expensive browser
layout or image decoder. A view toggle does not reread resources; clicking the original file link
does. The Preview switch works as it does for Markdown: on shows the document, off shows source.
Closing the file or changing its owner aborts preparation and discards its document.

### Text, Markdown and PDF

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
surface, sequentially, retaining at most 20 MiB of image bytes. Each is read once while its prose
stays open: a streaming reply loads only the images it adds. An image is whatever its file tab
shows as one, PNG, JPEG, GIF, WebP or SVG; a reference whose name claims another format
(`demo.mp4`, `spec.pdf`) is neither read nor counted, while a name without a known extension is
read and shown if its bytes are an image. Images appear in place as thumbnails
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

Navigation owns the file tab's acquisition, cancellation, errors and server-resolved identity as
one disposable lifetime. The viewer consumes that acquisition and owns presentation resources such
as Blob URLs; format renderers only consume acquired content. Only tab locations survive a browser
reload, never acquired content. Repeat clicks reread, background workspace snapshots do not. Closing
or changing session, workspace or file invalidates old reads; media stops, workers are released and Blob URLs are revoked
when their consumers are removed (INV-07). Renderer controls do not register new global shortcuts.

## Dependencies and verification

Vite self-hosts the worker, CMaps, standard fonts and WASM from the locked PDF.js package. The
renderer loads only for PDFs; the highlighting worker uses ES modules so languages/themes remain
separate lazy chunks. Generated `web/public/pdfjs/` assets are ignored, copied for development and
included in builds. When upgrading React-PDF, verify `npm ls react-pdf pdfjs-dist`, the emitted
worker and asset versions, and a scratch-browser PDF render.

Module checks cover file classification/limits/path resolution, text redaction, binary transport,
safe Markdown placeholders and HTML sanitization, resource resolution/budgets and cancellation.
HTML's actual sandbox, trusted user-click handling, fragments, native disclosures, no-network
behavior, forged-message rejection and stale disposal also require scratch-browser observations;
a DOM test alone does not prove browser isolation. Browser evidence for PIN-32 covers
the four format groups, nested links/images, toggle without reread, repeat clicks, late completion, an actual background workspace
refresh, session/workspace changes, media disposal/codec failure, PDF errors and mobile/keyboard use.
See [testing policy](testing.md) for evidence scope (INV-09).
