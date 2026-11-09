import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Fiber } from "effect";
import { boundedImageStream } from "../server/ImageTransfer.ts";
import { PreparedImages, PreparedImagesLive } from "../server/PreparedImages.ts";
import type { RegistryData } from "../server/Registry.ts";
import { MAX_IMAGE_BYTES } from "../shared/attachments.ts";
import { remoteImageLimits } from "../shared/remoteImages.ts";
import { imageUploadBody } from "../web/src/lib/remoteImages.ts";

const cwd = "/registered";
const target = { cwd, sessionId: "session" };
const data: RegistryData = {
  version: 2,
  projects: [],
  folders: [cwd],
  worktrees: [],
  workspaces: [{ id: "workspace", path: cwd, folder: cwd }],
  sessions: [
    {
      cwd,
      sessionId: "session",
      archived: false,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
  ],
};
const png = {
  kind: "image" as const,
  name: "image.png",
  mimeType: "image/png" as const,
  data: "iVBORw0KGgo=",
};
const body = (images = [png], destination = target) =>
  imageUploadBody(destination, images).stream();
const run = <A, E>(effect: Effect.Effect<A, E, PreparedImages>) =>
  Effect.runPromise(effect.pipe(Effect.provide(PreparedImagesLive)));

// Contract risk: a prepared capability could be replayed, cross-targeted, or release its budget
// while the actual Pi input is still in flight. Exercise the real store, not helper choreography.
test("preparations bind target and runtime, consume once, and hold their capacity until settlement", async () => {
  let prior = { id: "" };
  await run(
    Effect.gen(function* () {
      const images = yield* PreparedImages;
      const first = yield* images.prepare(data, body());
      prior = first;
      const second = yield* images.prepare(data, body());
      assert.equal((yield* images.prepare(data, body()).pipe(Effect.result))._tag, "Failure");
      assert.equal(
        (yield* images.claim(data, first, { cwd, sessionId: "other" }).pipe(Effect.result))._tag,
        "Failure",
      );
      const lease = yield* images.claim(data, first, target);
      assert.deepEqual(lease.attachments, [png]);
      assert.equal((yield* images.claim(data, first, target).pipe(Effect.result))._tag, "Failure");
      images.cancel(first);
      assert.equal(
        (yield* images.prepare(data, body()).pipe(Effect.result))._tag,
        "Failure",
        "cancel cannot free consumed input",
      );
      lease.release();
      images.cancel(second);
      const third = yield* images.prepare(data, body());
      const removed = { ...data, sessions: [] };
      assert.equal(
        (yield* images.claim(removed, third, target).pipe(Effect.result))._tag,
        "Failure",
      );
      images.cancel(third);
      assert.equal((yield* images.claim(data, third, target).pipe(Effect.result))._tag, "Failure");
    }),
  );
  await run(
    Effect.gen(function* () {
      assert.equal(
        (yield* (yield* PreparedImages).claim(data, prior, target).pipe(Effect.result))._tag,
        "Failure",
        "restart forgets all capabilities",
      );
    }),
  );
});

test("new-session preparations require their draft nonce; abandoned preparations expire", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
  await run(
    Effect.gen(function* () {
      const images = yield* PreparedImages;
      const destination = { cwd, draftId: "draft-1" };
      const first = yield* images.prepare(data, imageUploadBody(destination, [png]).stream());
      assert.equal(
        (yield* images.claim(data, first, { cwd, draftId: "draft-2" }).pipe(Effect.result))._tag,
        "Failure",
      );
      assert.equal(
        (yield* images.claim(data, { id: first.id }, destination).pipe(Effect.result))._tag,
        "Failure",
      );
      t.mock.timers.setTime(1_000 + remoteImageLimits.ttlMs);
      assert.equal(
        (yield* images.claim(data, first, destination).pipe(Effect.result))._tag,
        "Failure",
      );
      const second = yield* images.prepare(data, imageUploadBody(destination, [png]).stream());
      (yield* images.claim(data, second, destination)).release();
    }),
  );
});

test("binary preparation enforces exact image policy and framing before returning a capability", async () => {
  await run(
    Effect.gen(function* () {
      const images = yield* PreparedImages;
      const invalid = [
        body([{ ...png, data: "YQ==" }]),
        body([{ ...png, mimeType: "image/jpeg" as typeof png.mimeType }]),
        body(Array.from({ length: 11 }, () => png)),
        body([], target),
        body([png], { cwd: "/unregistered", sessionId: "session" }),
        new Blob([new Uint8Array([0xff, 0xff, 0xff, 0xff])]).stream(),
        new Blob([imageUploadBody(target, [png]), "extra"]).stream(),
        imageUploadBody(target, [png]).slice(0, -1).stream(),
      ];
      for (const stream of invalid)
        assert.equal((yield* images.prepare(data, stream).pipe(Effect.result))._tag, "Failure");
      for (const [mimeType, head] of [
        ["image/png", [137, 80, 78, 71, 13, 10, 26, 10]],
        ["image/jpeg", [255, 216, 255]],
        ["image/gif", [71, 73, 70, 56, 57, 97]],
        ["image/webp", [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]],
      ] as const) {
        const image = { ...png, mimeType, data: Buffer.from(head).toString("base64") };
        const prepared = yield* images.prepare(data, imageUploadBody(target, [image]).stream());
        const lease = yield* images.claim(data, prepared, target);
        assert.equal(lease.attachments[0].data, image.data);
        lease.release();
      }
      const bytes = Buffer.alloc(MAX_IMAGE_BYTES);
      bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
      const maximum = { ...png, data: bytes.toString("base64") };
      for (const batch of [
        Array.from({ length: 10 }, () => png),
        Array.from({ length: 5 }, () => maximum),
      ]) {
        const reference = yield* images.prepare(data, body(batch));
        const lease = yield* images.claim(data, reference, target);
        assert.equal(lease.attachments.length, batch.length);
        lease.release();
      }
      assert.equal(
        (yield* images
          .prepare(
            data,
            body([
              { ...maximum, data: Buffer.concat([bytes, Buffer.from([0])]).toString("base64") },
            ]),
          )
          .pipe(Effect.result))._tag,
        "Failure",
      );
      assert.equal(
        (yield* images
          .prepare(data, body([...Array.from({ length: 5 }, () => maximum), png]))
          .pipe(Effect.result))._tag,
        "Failure",
      );
      assert.equal(
        (yield* images.prepare(data, body(), 1).pipe(Effect.result))._tag,
        "Failure",
        "actual byte count must match declared length",
      );
    }),
  );
});

test("interrupting a partial preparation releases the slot and leaves no handle", async () => {
  await run(
    Effect.gen(function* () {
      const images = yield* PreparedImages;
      let began!: () => void;
      const reading = new Promise<void>((resolve) => {
        began = resolve;
      });
      let cancelled = false;
      const source = new ReadableStream<Uint8Array>(
        {
          pull() {
            began();
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      );
      const pending = yield* images.prepare(data, source).pipe(Effect.forkChild);
      yield* Effect.promise(() => reading);
      yield* Fiber.interrupt(pending);
      assert.equal(cancelled, true);
      const first = yield* images.prepare(data, body());
      const second = yield* images.prepare(data, body());
      images.cancel(first);
      images.cancel(second);
    }),
  );
});

test("stream bounds cancel overflow, stalled bodies, and caller cancellation without buffering", async () => {
  let cancelled = 0;
  const endless = () =>
    new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new Uint8Array(8));
      },
      cancel() {
        cancelled++;
      },
    });
  await assert.rejects(new Response(boundedImageStream(endless(), 10)).arrayBuffer());
  assert.equal(cancelled, 1);
  const stall = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled++;
    },
  });
  await assert.rejects(
    new Response(boundedImageStream(stall, 10, { idleMs: 10, totalMs: 100 })).arrayBuffer(),
  );
  assert.equal(cancelled, 2);
  const controller = new AbortController();
  const pending = new Response(
    boundedImageStream(new ReadableStream(), 10, { signal: controller.signal }),
  ).arrayBuffer();
  controller.abort();
  await assert.rejects(pending);
});
