import { createHash } from "node:crypto";
import { imageType } from "../../contracts/attachments.ts";
import {
  IMAGE_PREVIEW_BYTES as limit,
  imagePreviewAddress,
} from "../../contracts/attachments/imagePreviews.ts";

export interface ImagePreview {
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}
interface CachedImage {
  bytes: Buffer;
  mimeType: string;
}
const previews = new Map<string, CachedImage>();
const entryLimit = 4096;
let size = 0;
export function imagePreview(data: string, mimeType: string): string | undefined {
  if (data.length > 4 * Math.ceil(limit / 3)) return undefined;
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > limit || imageType(bytes) !== mimeType) return undefined;
  const id = createHash("sha256").update(bytes).digest("hex");
  retainImagePreview({ id, bytes, mimeType });
  return imagePreviewAddress(id);
}

export function retainImagePreview({ id, bytes, mimeType }: ImagePreview) {
  if (!bytes.length || bytes.length > limit) return;
  if (!previews.has(id)) {
    while (size + bytes.length > limit || previews.size >= entryLimit) {
      const oldest = previews.keys().next().value!;
      const image = previews.get(oldest)!;
      size -= image.bytes.length;
      previews.delete(oldest);
    }
    previews.set(id, {
      bytes: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      mimeType,
    });
    size += bytes.length;
  }
}
export function getImagePreview(id: string) {
  const image = previews.get(id);
  if (image) {
    previews.delete(id);
    previews.set(id, image);
  }
  return image ? { bytes: image.bytes, mimeType: image.mimeType } : undefined;
}
