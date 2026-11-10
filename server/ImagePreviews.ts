import { createHash } from "node:crypto";
import { imageType } from "../shared/attachments.ts";
import {
  IMAGE_PREVIEW_BYTES as limit,
  imagePreviewAddress,
  imagePreviewHash,
} from "../shared/imagePreviews.ts";
import { type RenderMsg, sessionKey } from "../shared/wire.ts";

/** Bounded, disposable display cache. Pi remains the only durable image store.
 * Reprojecting history repopulates it; image bytes never inflate WS snapshots.
 */
export interface ImagePreview {
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}
interface CachedImage {
  bytes: Buffer;
  mimeType: string;
  sessions: Map<string, Membership>;
}
interface Membership {
  key: string;
  image: CachedImage;
}
const previews = new Map<string, CachedImage>();
const memberships = new Set<Membership>();
const entryLimit = 4096;
const membershipLimit = 4096;
let size = 0;
export function imagePreview(data: string, mimeType: string): string | undefined {
  if (data.length > 4 * Math.ceil(limit / 3)) return undefined;
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > limit || imageType(bytes) !== mimeType) return undefined;
  const id = createHash("sha256").update(bytes).digest("hex");
  retainImagePreview({ id, bytes, mimeType });
  return imagePreviewAddress(id);
}

/** Already validated/hashed by this process's projector, possibly in its history worker. */
export function retainImagePreview({ id, bytes, mimeType }: ImagePreview) {
  if (!bytes.length || bytes.length > limit) return;
  if (!previews.has(id)) {
    while (size + bytes.length > limit || previews.size >= entryLimit) {
      const oldest = previews.keys().next().value!;
      const image = previews.get(oldest)!;
      size -= image.bytes.length;
      for (const membership of image.sessions.values()) memberships.delete(membership);
      previews.delete(oldest);
    }
    previews.set(id, {
      bytes: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      mimeType,
      sessions: new Map(),
    });
    size += bytes.length;
  }
}
/** Bind only projected transcript images, never caller-provided hashes. Metadata evicts with bytes. */
export function bindImagePreviews(cwd: string, sessionId: string, messages: readonly RenderMsg[]) {
  const key = sessionKey(cwd, sessionId);
  for (const message of messages)
    for (const attachment of message.attachments ?? []) {
      const hash = imagePreviewHash(attachment.url);
      const image = hash && previews.get(hash);
      if (!image || image.sessions.has(key)) continue;
      // Bound metadata globally, not per hash: many tiny images must not multiply provenance.
      if (memberships.size >= membershipLimit) {
        const oldest = memberships.values().next().value!;
        oldest.image.sessions.delete(oldest.key);
        memberships.delete(oldest);
      }
      const membership = { key, image };
      image.sessions.set(key, membership);
      memberships.add(membership);
    }
}
export function sessionImagePreview(cwd: string, sessionId: string, id: string) {
  return previews.get(id)?.sessions.has(sessionKey(cwd, sessionId))
    ? getImagePreview(id)
    : undefined;
}
export function getImagePreview(id: string) {
  const image = previews.get(id);
  if (image) {
    previews.delete(id);
    previews.set(id, image);
  }
  return image ? { bytes: image.bytes, mimeType: image.mimeType } : undefined;
}
