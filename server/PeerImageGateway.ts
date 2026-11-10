/** Fixed binary image routes. The main streams uploads; only the owning peer retains them. */
import { Effect, Option, Schema, Stream } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { IMAGE_TYPES } from "../shared/attachments.ts";
import { IMAGE_PREVIEW_HEADERS } from "../shared/imagePreviews.ts";
import { PreparedImages, remoteImageLimits } from "../shared/remoteImages.ts";
import {
  boundedImageStream,
  imageContentLength,
  imageFailure,
  imageRoute,
  ImageTransferError,
  readImageResponse,
} from "./ImageTransfer.ts";
import type { PeerConfig } from "./PeerConfig.ts";
import { imageJson } from "./PeerImages.ts";

const Refusal = Schema.Struct({ error: Schema.NonEmptyString });

/** Per-gateway-instance, per-peer caps, independent of conversation/control traffic. */
export function makePeerImageRelay() {
  const active = new Map<string, number>();
  return Effect.fn("PeerImageGateway.relay")(function* (
    peer: PeerConfig,
    path: string,
    request: HttpServerRequest.HttpServerRequest,
    headers: Record<string, string>,
  ) {
    const browserUrl = new URL(request.url, "http://localhost");
    const route = imageRoute(path, request.method, request.headers, browserUrl.search);
    if (route instanceof ImageTransferError)
      return imageJson({ error: route.detail }, route.status);
    const preview = route.kind === "preview";
    // Cancellation has a tiny independent lane, so saturated uploads can still be discarded.
    const key = `${peer.id}:${preview ? "read" : route.kind}`;
    if ((active.get(key) ?? 0) >= remoteImageLimits.laneTransfers)
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
        const body =
          route.kind === "preview"
            ? undefined
            : boundedImageStream(Stream.toReadableStream(request.stream), route.maximum, {
                signal: combined,
                length: route.length,
              });
        const response = await fetch(url, {
          method: request.method,
          headers: {
            ...headers,
            ...(route.kind === "preview"
              ? {}
              : {
                  "content-type": route.contentType,
                  ...(route.length === undefined ? {} : { "content-length": String(route.length) }),
                }),
          },
          body,
          duplex: "half",
          redirect: "manual",
          signal: combined,
        } as RequestInit);
        if (response.status !== 200) {
          const unavailable = imageFailure(
            "Could not transfer images: remote unavailable, busy, or image request refused.",
            502,
          );
          if (![400, 404, 408, 413, 415, 429].includes(response.status)) {
            await response.body?.cancel();
            throw unavailable;
          }
          // The owning peer knows why it refused; its bounded sentence is the user's to read.
          const text = await readImageResponse(response, combined).catch(() => "");
          const refusal = Schema.decodeUnknownOption(Schema.fromJsonString(Refusal))(text);
          throw imageFailure(
            Option.match(refusal, { onNone: () => unavailable.detail, onSome: (r) => r.error }),
            response.status,
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
              route.maximum,
            );
          } catch {
            await response.body.cancel();
            throw imageFailure("Remote image exceeds its byte limit.", 502);
          }
          const stream = boundedImageStream(response.body, route.maximum, {
            signal: combined,
            length: responseLength,
            done: release,
          });
          return HttpServerResponse.stream(
            Stream.fromReadableStream({
              evaluate: () => stream,
              onError: () => imageFailure("Remote image interrupted.", 502),
            }),
            { contentType: mimeType, headers: IMAGE_PREVIEW_HEADERS },
          );
        }
        const text = await readImageResponse(response, combined).catch(() => {
          throw imageFailure("Invalid image preparation response.", 502);
        });
        const value =
          route.kind === "upload"
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
