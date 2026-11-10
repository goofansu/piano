/** Binary image preparation, separate from the conversation socket (ADR 0004).
 * Four big-endian bytes give the UTF-8 manifest length, then the manifest, then exactly
 * each image's bytes in order. No multipart filenames, headers, nesting or arbitrary files.
 */
import { Schema } from "effect";
import {
  IMAGE_TYPES,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_IMAGE_BYTES,
} from "./attachments.ts";
import { IMAGE_PREVIEW_BYTES, IMAGE_PREVIEW_HASH } from "./imagePreviews.ts";
import { URL_ID } from "./urlId.ts";

export const remoteImageLimits = {
  manifestBytes: 16 * 1024,
  bodyBytes: MAX_ATTACHMENT_BYTES + 16 * 1024 + 4,
  batches: 2,
  ttlMs: 10 * 60_000,
  idleMs: 30_000,
  totalMs: 180_000,
  previewBytes: IMAGE_PREVIEW_BYTES,
  responseBytes: 1024,
} as const;
export const IMAGE_UPLOAD_PATH = "/api/peer/images";
export const IMAGE_CANCEL_PATH = "/api/peer/images/cancel";
export const IMAGE_PREVIEW_PATH = "/api/peer/image-preview";
export const IMAGE_UPLOAD_TYPE = "application/vnd.piano.images";
const ID = Schema.String.check(Schema.isPattern(URL_ID));
export const PreparedImages = Schema.Struct({ id: ID, draftId: Schema.optional(ID) });
export type PreparedImages = typeof PreparedImages.Type;
export const ImageTarget = Schema.Union([
  Schema.Struct({
    cwd: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
    sessionId: ID,
  }),
  Schema.Struct({
    cwd: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
    draftId: ID,
  }),
]);
export type ImageTarget = typeof ImageTarget.Type;
export const ImageManifest = Schema.Struct({
  target: ImageTarget,
  images: Schema.Array(
    Schema.Struct({
      name: Schema.String.check(Schema.isMaxLength(255)),
      mimeType: Schema.Literals(IMAGE_TYPES),
      size: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(MAX_IMAGE_BYTES)),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(MAX_ATTACHMENTS)),
});
export type ImageManifest = typeof ImageManifest.Type;
export const previewQuery = (search: URLSearchParams) => {
  if ([...search.keys()].length !== 3) return undefined;
  const workspaceId = search.get("workspaceId") ?? "";
  const sessionId = search.get("sessionId") ?? "";
  const hash = search.get("hash") ?? "";
  return URL_ID.test(workspaceId) && URL_ID.test(sessionId) && IMAGE_PREVIEW_HASH.test(hash)
    ? { workspaceId, sessionId, hash }
    : undefined;
};
