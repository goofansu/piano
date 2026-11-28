export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const DWG_TYPE = "image/vnd.dwg";
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_NAME_LENGTH = 255;
export const MAX_SINGLE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const MESSAGE_TEXT_ALLOWANCE_BYTES = 16 * 1024 * 1024;
export const MAX_MESSAGE_BYTES =
  4 * Math.ceil(MAX_ATTACHMENT_BYTES / 3) + MESSAGE_TEXT_ALLOWANCE_BYTES;
export const base64Bytes = (data: string) =>
  (data.length * 3) / 4 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
