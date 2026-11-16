const scheme = /^[a-z][a-z\d+.-]*:/i;

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
    path = path.replace(/(?:%[\da-f]{2})+/gi, (escapes) => decodeURIComponent(escapes));
    // oxlint-disable-next-line no-control-regex -- reject path control characters.
    return path && !/[\u0000-\u001f\u007f]/.test(path) ? path : undefined;
  } catch {
    return;
  }
}

export const relativeToDocument = (document: string, path: string) =>
  path.startsWith("/")
    ? path
    : `${document.slice(0, document.lastIndexOf("/") + 1)}${path}`
        .split("/")
        .filter((part) => part !== ".")
        .join("/");

export function documentReference(document: string, reference: string): string | undefined {
  const path = localFilePath(reference);
  return path === undefined ? undefined : relativeToDocument(document, path);
}

export function automaticReference(document: string, reference: string): string | undefined {
  if (reference.length > 4096) return;
  const path = localFilePath(reference);
  if (path === undefined || path.startsWith("/") || path.includes("\\") || scheme.test(path))
    return;
  return relativeToDocument(document, path);
}
