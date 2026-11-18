# Local file previews

## Formats and limits

Formats and size limits live in `shared/files.ts`. SVG previews use a Blob URL in an `<img>`,
never inline SVG, an object or an iframe, so scripts, event handlers and external resources stay
disabled by browser image mode.

### Static HTML

HTML opens as a document, not an app:

- The sanitized document sits in an opaque-origin `srcdoc` iframe with a restrictive CSP and
  `sandbox="allow-scripts"` **only**; the one executable script is Piano's fixed click bridge,
  authorized by its exact SHA-256 CSP hash. Document-authored code never runs.
- Every `href` is removed, including fragments: `srcdoc` inherits the parent's base URL, so
  allowing even `#section` would not reliably stay in the document.
- The parent accepts only trusted message events from the exact current iframe WindowProxy; an
  opaque origin alone is not identity. Destinations and workspace IDs never come from messages.
- Stylesheets and images are read through the workspace-file seam, never by unrestricted browser
  fetching. CSS is parsed, not rewritten with URL regular expressions, and fails closed.
- Changes to the bridge's source, CSP, sanitation or message/lifecycle checks require renewed
  browser security observations.

Budgets are constants in `web/src/lib/html-preview.ts`.

## Ownership and privacy

File access is not restricted to a repository or to files a session created: any supported regular
file readable by Piano's server process can be opened, including sensitive files outside the
checkout. The workspace ID supplies the session context, not a filesystem sandbox. Piano must
remain behind private authenticated access (INV-11). Git's Changes and written-file tracking
remain scoped to the workspace; opening an external file does not add it to those lists.

**Arbitrary image, audio, video and PDF bytes are not secret-redacted.** Existing text redaction
is heuristic, not containment.

When upgrading React-PDF, verify `npm ls react-pdf pdfjs-dist`, the emitted worker and asset
versions, and a scratch-browser PDF render.
