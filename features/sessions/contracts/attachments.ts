import {
  DWG_TYPE,
  type FileType,
  IMAGE_TYPES,
  PDF_TYPE,
  TEXT_TYPE,
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
const IMAGE_TYPE_NAMES = IMAGE_TYPES.map((t) => IMAGE_TYPE_NAME[t]);
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

const fileNames: Record<FileType, string> = {
  [DWG_TYPE]: "DWG",
  [PDF_TYPE]: "PDF",
  [TEXT_TYPE]: "Plain text",
};
export const ATTACHMENT_TYPE_LIST = `${IMAGE_TYPE_NAMES.join(", ")}, DWG, PDF, or UTF-8 plain text`;
export const fileLabel = (type: FileType, bytes: number) =>
  `${fileNames[type]} · ${byteSize(bytes)}`;

const utf8 = new TextDecoder("utf-8", { fatal: true });
const textOf = (bytes: Uint8Array) => {
  try {
    return utf8.decode(bytes);
  } catch {
    return undefined;
  }
};

export function attachmentType(name: string, bytes: Uint8Array): ImageType | FileType | undefined {
  if (/\.dwg$/i.test(name))
    return /^AC10[0-9]{2}$/.test(String.fromCharCode(...bytes.subarray(0, 6)))
      ? DWG_TYPE
      : undefined;
  if (/\.pdf$/i.test(name))
    return /^%PDF-[0-9]\.[0-9]$/.test(String.fromCharCode(...bytes.subarray(0, 8)))
      ? PDF_TYPE
      : undefined;
  const image = imageType(bytes);
  if (image) return image;
  const text = textOf(bytes);
  if (text !== undefined && !/[^\P{Cc}\t\n\r\f]/u.test(text)) return TEXT_TYPE;
}

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
