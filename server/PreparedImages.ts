/** Ephemeral peer-owned preparations. No files, database rows or second image history.
 * Two slots reserve the full 50 MiB policy each, from ingestion through operation settlement.
 * Abandoned preparations expire; consuming removes replay authority before any Pi work starts.
 */
import { randomUUID } from "node:crypto";
import { Context, Effect, Layer, Schema } from "effect";
import { imageType, MAX_ATTACHMENT_BYTES } from "../shared/attachments.ts";
import {
  ImageManifest,
  type ImageTarget,
  type PreparedImages as ImageReference,
  remoteImageLimits,
} from "../shared/remoteImages.ts";
import type { Attachment } from "../shared/wire.ts";
import { boundedImageStream, imageFailure, ImageTransferError } from "./ImageTransfer.ts";
import { openDirectory, registered } from "./PeerScope.ts";
import type { RegistryData } from "./Registry.ts";

const allowed = (data: RegistryData, target: ImageTarget) =>
  "sessionId" in target
    ? registered(data, target.cwd) &&
      data.sessions.some((s) => s.cwd === target.cwd && s.sessionId === target.sessionId)
    : openDirectory(data, target.cwd);
const sameTarget = (a: ImageTarget, b: ImageTarget) =>
  a.cwd === b.cwd &&
  ("sessionId" in a ? "sessionId" in b && a.sessionId === b.sessionId : !("sessionId" in b));
interface Lease {
  readonly attachments: readonly Attachment[];
  readonly release: () => void;
}
interface Prepared {
  target: ImageTarget;
  images: { name: string; mimeType: Attachment["mimeType"]; bytes: Buffer }[];
  expires: number;
  consumed: boolean;
}

export class PreparedImages extends Context.Service<
  PreparedImages,
  {
    prepare: (
      data: RegistryData,
      body: ReadableStream<Uint8Array>,
      length?: number,
    ) => Effect.Effect<ImageReference, ImageTransferError>;
    claim: (
      data: RegistryData,
      reference: ImageReference,
      target: ImageTarget,
    ) => Effect.Effect<Lease, ImageTransferError>;
    cancel: (reference: ImageReference) => void;
  }
>()("piano/PreparedImages") {}

export const PreparedImagesLive = Layer.effect(
  PreparedImages,
  Effect.gen(function* () {
    const entries = new Map<string, Prepared>();
    let reading = 0;
    const sweep = () => {
      const now = Date.now();
      for (const [id, entry] of entries)
        if (!entry.consumed && entry.expires <= now) entries.delete(id);
    };
    const timer = setInterval(sweep, 30_000);
    timer.unref();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        clearInterval(timer);
        entries.clear();
      }),
    );
    const prepare = Effect.fn("PreparedImages.prepare")(function* (
      data: RegistryData,
      source: ReadableStream<Uint8Array>,
      length?: number,
    ) {
      sweep();
      if (reading + entries.size >= remoteImageLimits.batches) {
        yield* Effect.promise(() => source.cancel().catch(() => {}));
        return yield* Effect.fail(
          imageFailure("Image preparation is busy. Try again after the pending send.", 429),
        );
      }
      reading++;
      return yield* Effect.tryPromise({
        try: async (signal) => {
          const reader = boundedImageStream(source, remoteImageLimits.bodyBytes, {
            signal,
            length,
          }).getReader();
          let chunk: Uint8Array = new Uint8Array(0);
          let offset = 0;
          const take = async (size: number) => {
            const result = Buffer.allocUnsafe(size);
            let filled = 0;
            while (filled < size) {
              if (offset === chunk.length) {
                const part = await reader.read();
                if (part.done) throw imageFailure("Incomplete image upload.");
                chunk = part.value;
                offset = 0;
              }
              const count = Math.min(size - filled, chunk.length - offset);
              result.set(chunk.subarray(offset, offset + count), filled);
              offset += count;
              filled += count;
            }
            return result;
          };
          try {
            const manifestSize = (await take(4)).readUInt32BE();
            if (!manifestSize || manifestSize > remoteImageLimits.manifestBytes)
              throw imageFailure();
            const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(ImageManifest))(
              (await take(manifestSize)).toString("utf8"),
              { onExcessProperty: "error" },
            );
            if (!allowed(data, manifest.target))
              throw imageFailure("Image target is not listed on this machine.", 404);
            if (manifest.images.reduce((n, i) => n + i.size, 0) > MAX_ATTACHMENT_BYTES)
              throw imageFailure();
            const images: Prepared["images"] = [];
            for (const image of manifest.images) {
              const bytes = await take(image.size);
              if (imageType(bytes) !== image.mimeType)
                throw imageFailure("Image type does not match its contents.");
              images.push({ name: image.name, mimeType: image.mimeType, bytes });
            }
            if (offset !== chunk.length || !(await reader.read()).done)
              throw imageFailure("Unexpected image upload bytes.");
            signal.throwIfAborted();
            const id = randomUUID();
            entries.set(id, {
              target: manifest.target,
              images,
              expires: Date.now() + remoteImageLimits.ttlMs,
              consumed: false,
            });
            return { id };
          } finally {
            await reader.cancel().catch(() => {});
          }
        },
        catch: (e) => (e instanceof ImageTransferError ? e : imageFailure()),
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            reading--;
          }),
        ),
      );
    });
    const claim = Effect.fn("PreparedImages.claim")(function* (
      data: RegistryData,
      reference: ImageReference,
      target: ImageTarget,
    ) {
      sweep();
      const entry = entries.get(reference.id);
      if (!entry || entry.consumed || !allowed(data, target) || !sameTarget(entry.target, target))
        return yield* Effect.fail(
          imageFailure(
            "Images expired, were already used, or belong to another draft. Attach and send again.",
          ),
        );
      entry.consumed = true;
      const attachments: Attachment[] = entry.images.map((i) => ({
        kind: "image",
        name: i.name,
        mimeType: i.mimeType,
        data: i.bytes.toString("base64"),
      }));
      // The slot stays reserved, but raw bytes need not coexist with the Pi input.
      entry.images = [];
      return {
        attachments,
        release: () => {
          entries.delete(reference.id);
        },
      };
    });
    return PreparedImages.of({
      prepare,
      claim,
      cancel: (reference) => {
        const entry = entries.get(reference.id);
        if (entry && !entry.consumed) entries.delete(reference.id);
      },
    });
  }),
);
