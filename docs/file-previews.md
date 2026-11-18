# Local file previews

## Formats and limits

Formats and size limits live in `shared/files.ts`. SVG previews use a Blob URL in an `<img>`,
never inline SVG, an object or an iframe, so scripts, event handlers and external resources stay
disabled by browser image mode.

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
CSS `url()` images and HTML `img` sources become embedded PNG, JPEG, GIF, WebP or image-mode SVG:
an image is whatever its file tab shows as one, by the same rule as Markdown images. A reference
whose name claims another format (`demo.mp4`, `spec.pdf`) is neither read nor counted against the
read and byte budgets below; a name without a known extension is read and embedded if its bytes are
an image.
Absolute paths, schemes (including user-supplied data/blob URLs), protocol-relative references,
remote resources and `srcset` are not automatic reads. A reference names the same file it would as
a Markdown or HTML link (`web/src/lib/file-link.ts`): `%XX` escapes decode, any other `%` is part
of the name; a decoded reference that is absolute, holds a `\` or starts with a scheme is refused.
Relative `..` references are supported; existing file resolution can follow symlinks and leave
the workspace, as it does for Markdown.
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

## Ownership and privacy

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

## Dependencies and verification

Vite self-hosts the worker, CMaps, standard fonts and WASM from the locked PDF.js package. The
renderer loads only for PDFs. Source text and Changes diffs share one renderer, `@pierre/diffs`
(`web/src/components/Code.tsx`), loaded only when code shows; its Shiki worker pool uses ES
modules so languages/themes remain separate lazy chunks, and one Wrap preference serves both. Generated `web/public/pdfjs/` assets are ignored, copied for development and
included in builds. When upgrading React-PDF, verify `npm ls react-pdf pdfjs-dist`, the emitted
worker and asset versions, and a scratch-browser PDF render.
