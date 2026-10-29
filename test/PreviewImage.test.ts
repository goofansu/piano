import assert from "node:assert/strict";
import { test } from "node:test";
import { mayPreviewAsImage, previewImage } from "../web/src/lib/previewImage.ts";

const identity = { workspaceId: "w", path: "p" };

test("a file tab and Markdown images agree that raster and SVG previews are images", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  const vector = previewImage({ ...identity, kind: "svg", language: "xml", content: svg });
  assert.equal(vector?.type, "image/svg+xml");
  assert.equal(await vector?.text(), svg);
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const raster = previewImage({ ...identity, kind: "image", mime: "image/png", bytes });
  assert.equal(raster?.type, "image/png");
  assert.deepEqual(new Uint8Array((await raster?.arrayBuffer()) ?? []), bytes);
  for (const preview of [
    { ...identity, kind: "audio", mime: "audio/flac", bytes },
    { ...identity, kind: "video", mime: "video/mp4", bytes },
    { ...identity, kind: "pdf", mime: "application/pdf", bytes },
    { ...identity, kind: "markdown", language: "markdown", content: "# x" },
    { ...identity, kind: "text", language: "", content: svg },
  ] as const)
    assert.equal(previewImage(preview), undefined, preview.kind);
});

test("Markdown images skip names that claim another format before reading them", () => {
  for (const path of ["arch.svg", "shot.PNG", "docs/a.jpeg", "screenshot", "build/output"])
    assert.ok(mayPreviewAsImage(path), path);
  for (const path of ["demo.mp4", "spec.pdf", "voice.flac", "notes.md"])
    assert.ok(!mayPreviewAsImage(path), path);
});
