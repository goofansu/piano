/** The owning peer's image HTTP boundary. Global Host/Origin policy runs before these routes. */
import { Effect, Schema, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { IMAGE_PREVIEW_HEADERS } from "../shared/imagePreviews.ts";
import {
  IMAGE_PATHS,
  PreparedImages as ImageReference,
  remoteImageLimits,
} from "../shared/remoteImages.ts";
import { sessionImagePreview } from "./ImagePreviews.ts";
import {
  boundedImageStream,
  imageFailure,
  imageRoute,
  ImageTransferError,
} from "./ImageTransfer.ts";
import { AllowedOrigins, fromOwnPage } from "./OriginPolicy.ts";
import { PreparedImages } from "./PreparedImages.ts";
import { Registry } from "./Registry.ts";

export const imageJson = (body: unknown, status = 200) =>
  HttpServerResponse.text(JSON.stringify(body), {
    status,
    contentType: "application/json",
    headers: { "cache-control": "no-store" },
  });

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
    if (!fromOwnPage(request.headers, origins))
      return imageJson({ error: "Images must be requested from this Piano's own page." }, 403);
    const route = imageRoute(url.pathname, request.method, request.headers, url.search);
    if (route instanceof ImageTransferError)
      return imageJson({ error: route.detail }, route.status);
    if (route.kind === "preview") {
      const { query } = route;
      const { session } = yield* registry.sessionIn(query.workspaceId, query.sessionId);
      const image = sessionImagePreview(session.cwd, session.sessionId, query.hash);
      if (!image) return HttpServerResponse.empty({ status: 404 });
      if (previewReads >= remoteImageLimits.laneTransfers)
        return imageJson({ error: "Image reads are busy. Try again." }, 429);
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
      const stream = boundedImageStream(source, route.maximum, {
        done: () => {
          previewReads--;
        },
      });
      return HttpServerResponse.stream(
        Stream.fromReadableStream({
          evaluate: () => stream,
          onError: () => imageFailure("Image read interrupted.", 408),
        }),
        { contentType: image.mimeType, headers: IMAGE_PREVIEW_HEADERS },
      );
    }
    const source = Stream.toReadableStream(request.stream, { strategy: { highWaterMark: 0 } });
    if (route.kind === "upload") {
      const result = yield* prepared.prepare(yield* registry.get, source, route.length);
      return imageJson(result);
    }
    const reference = yield* Effect.tryPromise({
      try: async (signal) =>
        Schema.decodeUnknownSync(Schema.fromJsonString(ImageReference))(
          await new Response(
            boundedImageStream(source, route.maximum, { signal, length: route.length }),
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
  for (const path of IMAGE_PATHS) yield* router.add("*", path, handler);
});
