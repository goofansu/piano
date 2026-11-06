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
      if (/^[a-z][a-z\d+.-]*:/i.test(path)) return;
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
