import {
  IMAGE_TYPES,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
} from "../../../shared/session/attachments.ts";

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

export const ATTACHMENT_TYPE_LIST = `${IMAGE_TYPE_NAMES.join(", ")}, or DWG`;
export const drawingLabel = (bytes: number) => `DWG · ${byteSize(bytes)}`;
export const hasDwgExtension = (name: string) => /\.dwg$/i.test(name);
export const isDwg = (name: string, bytes: Uint8Array) =>
  hasDwgExtension(name) && /^AC10[0-9]{2}$/.test(String.fromCharCode(...bytes.subarray(0, 6)));

export const attachmentsRefusal = (count: number, bytes: number) =>
  count > MAX_ATTACHMENTS
    ? `Attach up to ${MAX_ATTACHMENTS} files per message.`
    : bytes > MAX_ATTACHMENT_BYTES
      ? `Attachments must total ${mebibytes(MAX_ATTACHMENT_BYTES)} or less.`
      : "";
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
