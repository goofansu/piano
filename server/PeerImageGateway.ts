/** Fixed binary image routes. The main streams uploads; only the owning peer retains them. */
import { Effect, Schema, Stream } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { IMAGE_TYPES } from "../shared/attachments.ts";
import {
  IMAGE_CANCEL_PATH,
  IMAGE_PREVIEW_PATH,
  IMAGE_UPLOAD_PATH,
  IMAGE_UPLOAD_TYPE,
  PreparedImages,
  previewQuery,
  remoteImageLimits,
} from "../shared/remoteImages.ts";
import {
  boundedImageStream,
  imageContentLength,
  imageFailure,
  ImageTransferError,
  readImageResponse,
} from "./ImageTransfer.ts";
import type { PeerConfig } from "./PeerConfig.ts";
import { imageHeaders, imageJson } from "./PeerImages.ts";

export const peerImagePaths = new Set([IMAGE_UPLOAD_PATH, IMAGE_CANCEL_PATH, IMAGE_PREVIEW_PATH]);

/** Per-gateway-instance, per-peer caps, independent of conversation/control traffic. */
export function makePeerImageRelay() {
  const active = new Map<string, number>();
  return Effect.fn("PeerImageGateway.relay")(function* (
    peer: PeerConfig,
    path: string,
    request: HttpServerRequest.HttpServerRequest,
    headers: Record<string, string>,
  ) {
    const preview = path === IMAGE_PREVIEW_PATH;
    if (request.method !== (preview ? "GET" : "POST"))
      return imageJson({ error: "Unsupported image method." }, 405);
    const browserUrl = new URL(request.url, "http://localhost");
    if (
      request.headers.upgrade ||
      request.headers["content-encoding"] ||
      (preview ? !previewQuery(browserUrl.searchParams) : !!browserUrl.search)
    )
      return imageJson({ error: "Invalid image request." }, 400);
    if (
      !preview &&
      request.headers["content-type"] !==
        (path === IMAGE_UPLOAD_PATH ? IMAGE_UPLOAD_TYPE : "application/json")
    )
      return imageJson({ error: "Unsupported image body." }, 415);
    const lane = `${peer.id}:${preview ? "read" : "upload"}`;
    // Cancellation has a tiny independent lane, so saturated uploads can still be discarded.
    const key = path === IMAGE_CANCEL_PATH ? `${peer.id}:cancel` : lane;
    if ((active.get(key) ?? 0) >= 2)
      return imageJson({ error: "Image transfer is busy. Try again after the pending send." }, 429);
    active.set(key, (active.get(key) ?? 0) + 1);
    const controller = new AbortController();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      controller.abort();
      active.set(key, (active.get(key) ?? 1) - 1);
    };
    return yield* Effect.tryPromise({
      try: async (signal) => {
        const combined = AbortSignal.any([
          signal,
          controller.signal,
          AbortSignal.timeout(remoteImageLimits.totalMs),
        ]);
        const url = new URL(path, peer.endpoint);
        if (preview) url.search = browserUrl.search;
        const maximum =
          path === IMAGE_UPLOAD_PATH
            ? remoteImageLimits.bodyBytes
            : remoteImageLimits.responseBytes;
        const length = preview ? undefined : imageContentLength(request.headers, maximum);
        const body = preview
          ? undefined
          : boundedImageStream(Stream.toReadableStream(request.stream), maximum, {
              signal: combined,
              length,
            });
        const response = await fetch(url, {
          method: request.method,
          headers: {
            ...headers,
            ...(preview
              ? {}
              : {
                  "content-type":
                    path === IMAGE_UPLOAD_PATH ? IMAGE_UPLOAD_TYPE : "application/json",
                  ...(length === undefined ? {} : { "content-length": String(length) }),
                }),
          },
          body,
          duplex: "half",
          redirect: "manual",
          signal: combined,
        } as RequestInit);
        if (response.status !== 200) {
          await response.body?.cancel();
          throw imageFailure(
            "Could not transfer images: remote unavailable, busy, or image request refused.",
            [400, 404, 408, 413, 415, 429].includes(response.status) ? response.status : 502,
          );
        }
        if (preview) {
          const mimeType = response.headers.get("content-type") ?? "";
          if (
            !(IMAGE_TYPES as readonly string[]).includes(mimeType) ||
            !response.body ||
            response.headers.has("content-encoding")
          ) {
            await response.body?.cancel();
            throw imageFailure("Remote image is unavailable.", 502);
          }
          let responseLength: number | undefined;
          try {
            responseLength = imageContentLength(
              Object.fromEntries(response.headers),
              remoteImageLimits.previewBytes,
            );
          } catch {
            await response.body.cancel();
            throw imageFailure("Remote image exceeds its byte limit.", 502);
          }
          const stream = boundedImageStream(response.body, remoteImageLimits.previewBytes, {
            signal: combined,
            length: responseLength,
            done: release,
          });
          return HttpServerResponse.stream(
            Stream.fromReadableStream({
              evaluate: () => stream,
              onError: () => imageFailure("Remote image interrupted.", 502),
            }),
            { contentType: mimeType, headers: imageHeaders },
          );
        }
        const text = await readImageResponse(response, combined).catch(() => {
          throw imageFailure("Invalid image preparation response.", 502);
        });
        const value =
          path === IMAGE_UPLOAD_PATH
            ? Schema.decodeUnknownSync(Schema.fromJsonString(PreparedImages))(text, {
                onExcessProperty: "error",
              })
            : Schema.decodeUnknownSync(
                Schema.fromJsonString(Schema.Struct({ ok: Schema.Literal(true) })),
              )(text);
        release();
        return imageJson(value);
      },
      catch: (e) => {
        release();
        return e instanceof ImageTransferError
          ? e
          : imageFailure(
              "Could not transfer images: remote unavailable or transfer interrupted.",
              502,
            );
      },
    }).pipe(
      Effect.onInterrupt(() => Effect.sync(release)),
      Effect.catch((e) => Effect.succeed(imageJson({ error: e.detail }, e.status))),
    );
  });
}
