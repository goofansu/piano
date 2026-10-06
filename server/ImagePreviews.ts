import { createHash } from "node:crypto";
import { imageType } from "../shared/attachments.ts";

/** Bounded, disposable display cache. Pi remains the only durable image store.
 * Reprojecting history repopulates it; image bytes never inflate WS snapshots.
 */
const limit = 64 * 1024 * 1024;
const previews = new Map<string, { bytes: Buffer; mimeType: string }>();
let size = 0;
export function imagePreview(data: string, mimeType: string): string | undefined {
  if (data.length > 4 * Math.ceil(limit / 3)) return undefined;
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > limit || imageType(bytes) !== mimeType) return undefined;
  const id = createHash("sha256").update(bytes).digest("hex");
  if (!previews.has(id)) {
    while (size + bytes.length > limit) {
      const oldest = previews.keys().next().value!;
      size -= previews.get(oldest)!.bytes.length;
      previews.delete(oldest);
    }
    previews.set(id, { bytes, mimeType });
    size += bytes.length;
  }
  return `/api/image-previews/${id}`;
}
export function getImagePreview(id: string) {
  const image = previews.get(id);
  if (image) { previews.delete(id); previews.set(id, image); }
  return image;
}
