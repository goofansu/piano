import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  bindImagePreviews,
  bindSessionEvent,
  getImagePreview,
  imagePreview,
  sessionImagePreview,
} from "../server/ImagePreviews.ts";
import { previewQuery } from "../shared/remoteImages.ts";
import { remoteImageUrl } from "../web/src/lib/remoteImages.ts";

// A byte-only cache cap cannot bound provenance for many small images and sessions.
test("disposable preview bytes and provenance are globally bounded and can be reprojected", () => {
  const url = imagePreview(Buffer.from([255, 216, 255, 0]).toString("base64"), "image/jpeg")!;
  const id = url.split("/").at(-1)!;
  const messages = [
    {
      id: "message",
      role: "user" as const,
      text: "",
      attachments: [{ kind: "image" as const, url }],
    },
  ];
  for (let i = 0; i < 4097; i++) bindImagePreviews("/same", `session-${i}`, messages);
  assert.equal(
    sessionImagePreview("/same", "session-0", id),
    undefined,
    "old provenance is unavailable, never guessed",
  );
  assert.ok(sessionImagePreview("/same", "session-4096", id));
  bindImagePreviews("/same", "session-0", messages);
  assert.ok(sessionImagePreview("/same", "session-0", id), "reprojection restores membership");
  for (let i = 1; i <= 4096; i++) {
    const bytes = Buffer.alloc(7);
    bytes.set([255, 216, 255]);
    bytes.writeUInt32BE(i, 3);
    imagePreview(bytes.toString("base64"), "image/jpeg");
  }
  assert.equal(
    getImagePreview(id),
    undefined,
    "tiny images cannot accumulate unbounded cache objects",
  );
  imagePreview(Buffer.from([255, 216, 255, 0]).toString("base64"), "image/jpeg");
  assert.equal(
    sessionImagePreview("/same", "session-0", id),
    undefined,
    "byte eviction removed old provenance too",
  );
  bindImagePreviews("/same", "session-0", messages);
  assert.ok(sessionImagePreview("/same", "session-0", id));
});

// A context readback reprojects the whole transcript after every settle; an image it re-caches
// after eviction must stay that session's, or the peer answers its preview with 404.
test("a context event binds the images it reprojects to its session", () => {
  const data = Buffer.from([255, 216, 255, 2]).toString("base64");
  const url = imagePreview(data, "image/jpeg")!;
  const id = url.split("/").at(-1)!;
  const message = {
    id: "message",
    role: "user" as const,
    text: "",
    attachments: [{ kind: "image" as const, url }],
  };
  bindSessionEvent("/ctx", "session", { _tag: "message_end", message });
  assert.ok(sessionImagePreview("/ctx", "session", id));
  for (let i = 1; i <= 4096; i++) {
    const bytes = Buffer.alloc(8);
    bytes.set([255, 216, 255, 3]);
    bytes.writeUInt32BE(i, 4);
    imagePreview(bytes.toString("base64"), "image/jpeg");
  }
  assert.equal(getImagePreview(id), undefined, "evicted");
  imagePreview(data, "image/jpeg");
  assert.equal(
    sessionImagePreview("/ctx", "session", id),
    undefined,
    "re-cached without provenance",
  );
  bindSessionEvent("/ctx", "session", { _tag: "context", messages: [message] });
  assert.ok(sessionImagePreview("/ctx", "session", id), "the readback restores provenance");
});

// Cross-machine: the address one Piano projects is the one a browser and the peer accept, or a
// remote session's image renders blank.
test("a projected preview address reaches the owning peer as the same hash", () => {
  const bytes = Buffer.from([255, 216, 255, 1]);
  const url = imagePreview(bytes.toString("base64"), "image/jpeg")!;
  const target = { workspaceId: "workspace-1", sessionId: "session-1" };
  const remote = new URL(remoteImageUrl("eng-1", url, target), "http://localhost");
  assert.deepEqual(previewQuery(remote.searchParams), {
    ...target,
    hash: createHash("sha256").update(bytes).digest("hex"),
  });
});
