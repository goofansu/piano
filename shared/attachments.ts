/** Upload policy shared by the browser and server. Add future file kinds explicitly. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const MAX_ATTACHMENTS = 10;
// Original upload bytes, not Pi's resized/base64 model input. See docs/image-attachments.md.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** How the UI names each accepted type in prose, in `IMAGE_TYPES` order. */
const IMAGE_TYPE_NAME: Record<ImageType, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/gif": "GIF",
  "image/webp": "WebP",
};
export const IMAGE_TYPE_NAMES = IMAGE_TYPES.map((t) => IMAGE_TYPE_NAME[t]);
/** The accepted types as a sentence names them: "PNG, JPEG, GIF or WebP". */
export const IMAGE_TYPE_LIST = `${IMAGE_TYPE_NAMES.slice(0, -1).join(", ")} or ${IMAGE_TYPE_NAMES.at(-1)}`;
/** A byte limit in the UI's unit, e.g. "10 MiB". */
export const mebibytes = (bytes: number) => `${bytes / 2 ** 20} MiB`;

/**
 * Why `count` images totalling `bytes` original bytes cannot be one message, or "" when they can.
 * Per-image limits are separate: each image is checked on its own.
 */
export const attachmentsRefusal = (count: number, bytes: number) =>
  count > MAX_ATTACHMENTS
    ? `Attach up to ${MAX_ATTACHMENTS} images per message.`
    : bytes > MAX_ATTACHMENT_BYTES
      ? `Images must total ${mebibytes(MAX_ATTACHMENT_BYTES)} or less.`
      : "";
export const base64Bytes = (data: string) =>
  (data.length * 3) / 4 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);

export function imageType(bytes: Uint8Array): ImageType | undefined {
  const starts = (...prefix: number[]) => prefix.every((b, i) => bytes[i] === b);
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return "image/png";
  if (starts(255, 216, 255)) return "image/jpeg";
  if (starts(71, 73, 70, 56) && [55, 57].includes(bytes[4]) && bytes[5] === 97) return "image/gif";
  if (
    starts(82, 73, 70, 70) &&
    bytes[8] === 87 &&
    bytes[9] === 69 &&
    bytes[10] === 66 &&
    bytes[11] === 80
  )
    return "image/webp";
}
