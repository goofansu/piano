export const IMAGE_PREVIEW_HASH = /^[a-f0-9]{64}$/;
export const IMAGE_PREVIEW_BYTES = 64 * 1024 * 1024;
export const IMAGE_PREVIEW_HEADERS = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

const prefix = "/api/image-previews/";
export const IMAGE_PREVIEW_ROUTE = `${prefix}:id`;

export const imagePreviewAddress = (hash: string) => `${prefix}${hash}`;

export function imagePreviewHash(address: string) {
  const hash = address.startsWith(prefix) ? address.slice(prefix.length) : "";
  return IMAGE_PREVIEW_HASH.test(hash) ? hash : undefined;
}
