import { Schema } from "effect";
import { base64Bytes } from "../../../shared/attachments.ts";
import {
  IMAGE_CANCEL_PATH,
  IMAGE_PREVIEW_PATH,
  IMAGE_UPLOAD_PATH,
  IMAGE_UPLOAD_TYPE,
  type ImageManifest,
  type ImageTarget,
  PreparedImages,
  remoteImageLimits,
} from "../../../shared/remoteImages.ts";
import type { Attachment } from "../../../shared/wire.ts";
import { peerApiPath } from "./machine.ts";

/** Blob framing keeps base64 off the socket; the browser supplies its exact Content-Length. */
export function imageUploadBody(target: ImageTarget, images: readonly Attachment[]) {
  const manifest: ImageManifest = {
    target,
    images: images.map((i) => ({ name: i.name, mimeType: i.mimeType, size: base64Bytes(i.data) })),
  };
  const metadata = new TextEncoder().encode(JSON.stringify(manifest));
  if (metadata.length > remoteImageLimits.manifestBytes)
    throw new Error("Image metadata is too large.");
  const prefix = new Uint8Array(4);
  new DataView(prefix.buffer).setUint32(0, metadata.length);
  return new Blob(
    [
      prefix,
      metadata,
      ...images.map((i) => {
        const decoded = atob(i.data);
        const bytes = new Uint8Array(decoded.length);
        for (let j = 0; j < decoded.length; j++) bytes[j] = decoded.charCodeAt(j);
        return bytes;
      }),
    ],
    { type: IMAGE_UPLOAD_TYPE },
  );
}

export async function prepareImages(
  machineId: string,
  target: ImageTarget,
  images: readonly Attachment[],
  signal: AbortSignal,
) {
  const response = await fetch(peerApiPath(machineId, IMAGE_UPLOAD_PATH), {
    method: "POST",
    body: imageUploadBody(target, images),
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(remoteImageLimits.totalMs + 5000)]),
  });
  if (!response.body) throw new Error("Could not upload images. Try again.");
  const reader = response.body.getReader();
  let text = "",
    bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > remoteImageLimits.responseBytes)
        throw new Error("Invalid image upload response.");
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel();
  }
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "Image upload is busy. Try again after the pending send."
        : "Could not upload images. Your draft is kept; try again.",
    );
  return Schema.decodeUnknownSync(Schema.fromJsonString(PreparedImages))(text, {
    onExcessProperty: "error",
  });
}

/** Best effort disposal, never a retry of upload or input. A lost result expires on the peer. */
export function discardImages(machineId: string, reference: PreparedImages) {
  void fetch(peerApiPath(machineId, IMAGE_CANCEL_PATH), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(reference),
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  })
    .then((response) => response.body?.cancel())
    .catch(() => {});
}

/** Only source-owned projected image addresses. Never resolve an absolute/unknown URL or fall back. */
export function remoteImageUrl(
  machineId: string,
  url: string,
  target?: { workspaceId: string; sessionId: string },
) {
  if (machineId === "local") return url;
  const match = /^\/api\/image-previews\/([a-f0-9]{64})$/.exec(url);
  if (
    !match ||
    !target ||
    !/^[a-zA-Z0-9_-]{1,200}$/.test(target.workspaceId) ||
    !/^[a-zA-Z0-9_-]{1,200}$/.test(target.sessionId)
  )
    return "";
  return `${peerApiPath(machineId, IMAGE_PREVIEW_PATH)}?${new URLSearchParams({ ...target, hash: match[1] })}`;
}
