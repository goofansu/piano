import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { getImagePreview, imagePreview } from "../server/ImagePreviews.ts";

test("disposable preview bytes are addressed by hash, globally bounded, and cached again on reprojection", () => {
  const bytes = Buffer.from([255, 216, 255, 0]);
  const url = imagePreview(bytes.toString("base64"), "image/jpeg")!;
  const id = url.split("/").at(-1)!;
  assert.equal(id, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(getImagePreview(id), { bytes, mimeType: "image/jpeg" });
  for (let i = 1; i <= 4096; i++) {
    const other = Buffer.alloc(7);
    other.set([255, 216, 255]);
    other.writeUInt32BE(i, 3);
    imagePreview(other.toString("base64"), "image/jpeg");
  }
  assert.equal(
    getImagePreview(id),
    undefined,
    "tiny images cannot accumulate unbounded cache objects",
  );
  assert.equal(imagePreview(bytes.toString("base64"), "image/jpeg"), url);
  assert.deepEqual(getImagePreview(id), { bytes, mimeType: "image/jpeg" });
});
