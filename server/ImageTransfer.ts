/** Pull-based HTTP bounds shared by the two image hops. Never trust Content-Length alone. */
import { Data } from "effect";
import {
  IMAGE_ROUTES,
  IMAGE_UPLOAD_TYPE,
  previewQuery,
  remoteImageLimits,
} from "../shared/remoteImages.ts";

export class ImageTransferError extends Data.TaggedError("ImageTransferError")<{
  readonly detail: string;
  readonly status: number;
}> {}
export const imageFailure = (detail = "Could not prepare images. Try again.", status = 400) =>
  new ImageTransferError({ detail, status });

/** Includes the terminal read, so an endless/lying body cannot pass by filling the limit. */
export function boundedImageStream(
  source: ReadableStream<Uint8Array>,
  maximum: number,
  options: {
    signal?: AbortSignal;
    length?: number;
    idleMs?: number;
    totalMs?: number;
    done?: () => void;
  } = {},
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let bytes = 0;
  let ended = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let total: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void;
  const finish = () => {
    if (ended) return;
    ended = true;
    clearTimeout(idle);
    clearTimeout(total);
    options.signal?.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    options.done?.();
  };
  return new ReadableStream(
    {
      start(controller) {
        const fail = () => {
          if (ended) return;
          controller.error(imageFailure("Image transfer interrupted or timed out.", 408));
          finish();
        };
        abort = fail;
        options.signal?.addEventListener("abort", abort, { once: true });
        total = setTimeout(fail, options.totalMs ?? remoteImageLimits.totalMs);
        idle = setTimeout(fail, options.idleMs ?? remoteImageLimits.idleMs);
        if (options.signal?.aborted) fail();
      },
      async pull(controller) {
        try {
          const next = await reader.read();
          if (ended) return;
          clearTimeout(idle);
          if (next.done) {
            if (options.length !== undefined && bytes !== options.length) throw imageFailure();
            controller.close();
            finish();
            return;
          }
          bytes += next.value.byteLength;
          if (bytes > maximum) throw imageFailure("Image transfer exceeds its byte limit.", 413);
          controller.enqueue(next.value);
          idle = setTimeout(abort, options.idleMs ?? remoteImageLimits.idleMs);
        } catch (error) {
          if (!ended) controller.error(error);
          finish();
        }
      },
      cancel: finish,
    },
    { highWaterMark: 0 },
  );
}

export function imageContentLength(
  headers: Readonly<Record<string, string | undefined>>,
  maximum: number,
) {
  const value = headers["content-length"];
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum)
    throw imageFailure("Image transfer exceeds its byte limit.", 413);
  return Number(value);
}

export async function readImageResponse(response: Response, signal: AbortSignal) {
  if (!response.body) throw imageFailure();
  const stream = boundedImageStream(response.body, remoteImageLimits.responseBytes, { signal });
  return new Response(stream).text();
}

/** What an admitted image request is; a body route's length is its declared Content-Length. */
export type ImageRoute =
  | {
      readonly kind: "upload" | "cancel";
      readonly contentType: string;
      readonly maximum: number;
      readonly length: number | undefined;
    }
  | {
      readonly kind: "preview";
      readonly maximum: number;
      readonly query: NonNullable<ReturnType<typeof previewQuery>>;
    };

/** The one shape of each image route, for the relay on main and the owning peer alike, so a
 * request one hop forwards is never one the other refuses. Each hop's own origin and capacity
 * checks stay with it; this decides only method, transport headers, address and body. */
export function imageRoute(
  path: string,
  method: string,
  headers: Readonly<Record<string, string | undefined>>,
  /** The request URL's raw search, `?` included, as `URL.search` gives it. */
  search: string,
): ImageRoute | ImageTransferError {
  const kind = (Object.keys(IMAGE_ROUTES) as (keyof typeof IMAGE_ROUTES)[]).find(
    (key) => IMAGE_ROUTES[key] === path,
  );
  if (!kind) return imageFailure("Unknown image route.", 404);
  if (headers.upgrade || headers["content-encoding"])
    return imageFailure("Unsupported image request.");
  if (method !== (kind === "preview" ? "GET" : "POST"))
    return imageFailure("Unsupported image method.", 405);
  if (kind === "preview") {
    const query = previewQuery(new URLSearchParams(search));
    if (!query) return imageFailure("Invalid image address.");
    return { kind, maximum: remoteImageLimits.previewBytes, query };
  }
  if (search) return imageFailure("Invalid image request.");
  const contentType = kind === "upload" ? IMAGE_UPLOAD_TYPE : "application/json";
  if (headers["content-type"] !== contentType) return imageFailure("Unsupported image body.", 415);
  const maximum = kind === "upload" ? remoteImageLimits.bodyBytes : remoteImageLimits.responseBytes;
  try {
    return { kind, contentType, maximum, length: imageContentLength(headers, maximum) };
  } catch (error) {
    return error instanceof ImageTransferError ? error : imageFailure();
  }
}
