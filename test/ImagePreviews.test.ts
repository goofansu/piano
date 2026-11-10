import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  bindImagePreviews,
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
