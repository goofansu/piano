/** What a reference written inside a document names, for every surface that reads one: Markdown
 * links and images, HTML links and HTML preview resources. Each surface adds only its own policy
 * on top of the answer (HTML automatic reads, for example, refuse absolute paths). */

const scheme = /^[a-z][a-z\d+.-]*:/i;

/** A Markdown destination is either a web URL or a local path, never an executable scheme.
 * Read from the raw Markdown URL: a `%XX` escape decodes, and any other `%` is part of the name,
 * so `100%.png` is the file `100%.png`. The server resolves relative paths against the
 * session's workspace. */
export function localFilePath(destination: string): string | undefined {
  let path = destination.trim();
  if (!path || path.startsWith("//") || path.startsWith("#") || path.startsWith("?")) return;
  try {
    if (/^file:/i.test(path)) {
      const url = new URL(path);
      if (url.hostname || url.username || url.password || url.port) return;
      path = url.pathname;
    } else {
      if (scheme.test(path)) return;
      path = path.split(/[?#]/, 1)[0];
    }
    // Escapes that are not UTF-8 throw: a name Piano cannot spell is not a local file.
    path = path.replace(/(?:%[\da-f]{2})+/gi, (escapes) => decodeURIComponent(escapes));
    // oxlint-disable-next-line no-control-regex -- reject path control characters.
    return path && !/[\u0000-\u001f\u007f]/.test(path) ? path : undefined;
  } catch {
    return;
  }
}

/** Replies resolve from the workspace root; files resolve from their own directory. An absolute
 * path stays as written. `.` segments drop; `..` stays, because the server follows symlinks
 * before resolving their parent. */
export const relativeToDocument = (document: string, path: string) =>
  path.startsWith("/")
    ? path
    : `${document.slice(0, document.lastIndexOf("/") + 1)}${path}`
        .split("/")
        .filter((part) => part !== ".")
        .join("/");

/** The path a reference inside `document` names, or undefined when it names no local file. */
export function documentReference(document: string, reference: string): string | undefined {
  const path = localFilePath(reference);
  return path === undefined ? undefined : relativeToDocument(document, path);
}

/** The path an automatic read in `document` (an HTML image, stylesheet or import) may request:
 * only a relative reference, and only one whose decoded spelling would still be relative and
 * scheme-free if written literally, so `%2fetc` and `https%3a%2f%2f…` stay refused. The file seam
 * still owns authorization. */
export function automaticReference(document: string, reference: string): string | undefined {
  if (reference.length > 4096) return;
  const path = localFilePath(reference);
  if (path === undefined || path.startsWith("/") || path.includes("\\") || scheme.test(path))
    return;
  return relativeToDocument(document, path);
}
