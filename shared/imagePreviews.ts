/** An image preview's address and rules, for every side of the wire (docs/image-attachments.md).
 * The server projects `/api/image-previews/<sha256>`, its router serves the bytes there, and a
 * browser showing a remote session reads the hash back to ask that peer for the same preview.
 * One rule, so a projected address is never one a peer or browser refuses (a blank image).
 */

/** A preview is named by the lowercase hex SHA-256 of its bytes, never by a path. */
export const IMAGE_PREVIEW_HASH = /^[a-f0-9]{64}$/;
/** The disposable preview cache's size, and so the largest preview a peer may stream back. */
export const IMAGE_PREVIEW_BYTES = 64 * 1024 * 1024;
/** Preview bytes are private to the page and never sniffed as another type. */
export const IMAGE_PREVIEW_HEADERS = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

const prefix = "/api/image-previews/";
export const IMAGE_PREVIEW_ROUTE = `${prefix}:id`;

export const imagePreviewAddress = (hash: string) => `${prefix}${hash}`;

/** The hash an exact preview address names; undefined for anything else. */
export function imagePreviewHash(address: string) {
  const hash = address.startsWith(prefix) ? address.slice(prefix.length) : "";
  return IMAGE_PREVIEW_HASH.test(hash) ? hash : undefined;
}
