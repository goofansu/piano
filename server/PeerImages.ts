/** The owning peer's image HTTP boundary. Global Host/Origin policy runs before these routes. */
import { Effect, Schema, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import {
  IMAGE_CANCEL_PATH,
  IMAGE_PREVIEW_PATH,
  IMAGE_UPLOAD_PATH,
  IMAGE_UPLOAD_TYPE,
  PreparedImages as ImageReference,
  previewQuery,
  remoteImageLimits,
} from "../shared/remoteImages.ts";
import { sessionImagePreview } from "./ImagePreviews.ts";
import {
  boundedImageStream,
  imageContentLength,
  imageFailure,
  ImageTransferError,
} from "./ImageTransfer.ts";
import { AllowedOrigins } from "./OriginPolicy.ts";
import { PreparedImages } from "./PreparedImages.ts";
import { Registry } from "./Registry.ts";

export const imageJson = (body: unknown, status = 200) =>
  HttpServerResponse.text(JSON.stringify(body), {
    status,
    contentType: "application/json",
    headers: { "cache-control": "no-store" },
  });
export const imageHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

export const addPeerImageRoutes = Effect.fn("PeerImages.routes")(function* (
  router: HttpRouter.HttpRouter,
) {
  const prepared = yield* PreparedImages;
  const registry = yield* Registry;
  const origins = yield* AllowedOrigins;
  let previewReads = 0;
  const handler = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, "http://localhost");
    if (
      (request.headers["sec-fetch-site"] !== undefined &&
        request.headers["sec-fetch-site"] !== "same-origin") ||
      (request.headers.origin !== undefined && !origins.has(request.headers.origin))
    )
      return imageJson({ error: "Images must be requested from this Piano's own page." }, 403);
    if (request.headers.upgrade || request.headers["content-encoding"])
      return imageJson({ error: "Unsupported image request." }, 400);
    if (url.pathname === IMAGE_PREVIEW_PATH) {
      if (request.method !== "GET") return imageJson({ error: "Unsupported image method." }, 405);
      const query = previewQuery(url.searchParams);
      if (!query) return imageJson({ error: "Invalid image address." }, 400);
      const { session } = yield* registry.sessionIn(query.workspaceId, query.sessionId);
      const image = sessionImagePreview(session.cwd, session.sessionId, query.hash);
      if (!image) return HttpServerResponse.empty({ status: 404 });
      if (previewReads >= 2) return imageJson({ error: "Image reads are busy. Try again." }, 429);
      previewReads++;
      let offset = 0;
      const source = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (offset >= image.bytes.length) {
              controller.close();
              return;
            }
            controller.enqueue(image.bytes.subarray(offset, offset + 64 * 1024));
            offset += 64 * 1024;
          },
        },
        { highWaterMark: 0 },
      );
      const stream = boundedImageStream(source, remoteImageLimits.previewBytes, {
        done: () => {
          previewReads--;
        },
      });
      return HttpServerResponse.stream(
        Stream.fromReadableStream({
          evaluate: () => stream,
          onError: () => imageFailure("Image read interrupted.", 408),
        }),
        { contentType: image.mimeType, headers: imageHeaders },
      );
    }
    if (request.method !== "POST") return imageJson({ error: "Unsupported image method." }, 405);
    if (url.search) return imageJson({ error: "Invalid image request." }, 400);
    const upload = url.pathname === IMAGE_UPLOAD_PATH;
    if (request.headers["content-type"] !== (upload ? IMAGE_UPLOAD_TYPE : "application/json"))
      return imageJson({ error: "Unsupported image body." }, 415);
    const length = yield* Effect.try({
      try: () =>
        imageContentLength(
          request.headers,
          upload ? remoteImageLimits.bodyBytes : remoteImageLimits.responseBytes,
        ),
      catch: (error) => (error instanceof ImageTransferError ? error : imageFailure()),
    });
    const source = Stream.toReadableStream(request.stream, { strategy: { highWaterMark: 0 } });
    if (upload) {
      const result = yield* prepared.prepare(yield* registry.get, source, length);
      return imageJson(result);
    }
    const reference = yield* Effect.tryPromise({
      try: async (signal) =>
        Schema.decodeUnknownSync(Schema.fromJsonString(ImageReference))(
          await new Response(
            boundedImageStream(source, remoteImageLimits.responseBytes, { signal, length }),
          ).text(),
          { onExcessProperty: "error" },
        ),
      catch: () => imageFailure(),
    });
    prepared.cancel(reference);
    return imageJson({ ok: true });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        imageJson(
          {
            error:
              error instanceof ImageTransferError
                ? error.detail
                : "Image target is not listed on this machine.",
          },
          error instanceof ImageTransferError ? error.status : 404,
        ),
      ),
    ),
  );
  for (const path of [IMAGE_UPLOAD_PATH, IMAGE_CANCEL_PATH, IMAGE_PREVIEW_PATH] as const)
    yield* router.add("*", path, handler);
});
