export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const MAX_ATTACHMENTS = 10;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const MESSAGE_TEXT_ALLOWANCE_BYTES = 16 * 1024 * 1024;
export const MAX_MESSAGE_BYTES =
  4 * Math.ceil(MAX_ATTACHMENT_BYTES / 3) + MESSAGE_TEXT_ALLOWANCE_BYTES;
export type ImageType = (typeof IMAGE_TYPES)[number];

const IMAGE_TYPE_NAME: Record<ImageType, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/gif": "GIF",
  "image/webp": "WebP",
};
export const IMAGE_TYPE_NAMES = IMAGE_TYPES.map((t) => IMAGE_TYPE_NAME[t]);
export const IMAGE_TYPE_LIST = `${IMAGE_TYPE_NAMES.slice(0, -1).join(", ")} or ${IMAGE_TYPE_NAMES.at(-1)}`;
const tenths = (n: number) => `${Number(n.toFixed(1))}`;
export const mebibytes = (bytes: number) => `${tenths(bytes / 2 ** 20)} MiB`;
const byteSize = (bytes: number) =>
  bytes >= 2 ** 20
    ? mebibytes(bytes)
    : bytes >= 2 ** 10
      ? `${tenths(bytes / 2 ** 10)} KiB`
      : `${bytes} B`;
export const imageLabel = (type: ImageType, bytes: number) =>
  `${IMAGE_TYPE_NAME[type]} · ${byteSize(bytes)}`;

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
