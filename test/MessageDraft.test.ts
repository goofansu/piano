import assert from "node:assert/strict";
import { test } from "node:test";
import type { Attachment } from "../shared/wire.ts";
import {
  checkImages,
  hasContent,
  type ImageCandidate,
  imageDrafts,
  quoteDrafts,
  sendable,
  sessionDraftKey,
  withQuotes,
} from "../web/src/lib/messageDraft.ts";

// Limits and formats from docs/image-attachments.md, written out rather than imported.
const MiB = 1024 * 1024;
const SIGNATURES = {
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d],
  "image/jpeg": [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1],
  "image/gif": [...Buffer.from("GIF89a"), 1, 0, 1, 0, 0, 0],
  "image/webp": [...Buffer.from("RIFF"), 0x24, 0, 0, 0, ...Buffer.from("WEBP")],
} as const;
const png = (name: string, size: number, type = "image/png"): ImageCandidate => ({
  name,
  size,
  type,
  head: Uint8Array.from(SIGNATURES["image/png"]),
});
/** An accepted image already in the draft, `size` original bytes long. */
const held = (size: number): Attachment => ({
  kind: "image",
  name: "held.png",
  mimeType: "image/png",
  data: Buffer.alloc(size).toString("base64"),
});
const rejected = (check: ReturnType<typeof checkImages>) => (check.ok ? undefined : check.reason);

test("each image may be up to exactly 10 MiB of original bytes and must not be empty", () => {
  assert.deepEqual(checkImages([], [png("max.png", 10 * MiB)]), {
    ok: true,
    mimeTypes: ["image/png"],
  });
  assert.match(
    rejected(checkImages([], [png("big.png", 10 * MiB + 1)])) ?? "",
    /big\.png.*up to 10 MiB/,
  );
  assert.match(rejected(checkImages([], [png("empty.png", 0)])) ?? "", /empty\.png/);
});

test("a message holds four images totalling at most 20 MiB, counting those already in the draft", () => {
  assert.equal(checkImages([held(1), held(1)], [png("c.png", 1), png("d.png", 1)]).ok, true);
  assert.match(
    rejected(checkImages([held(1), held(1), held(1)], [png("d.png", 1), png("e.png", 1)])) ?? "",
    /up to 4 images/,
  );
  assert.match(
    rejected(
      checkImages(
        [],
        [1, 2, 3, 4, 5].map((i) => png(`${i}.png`, 1)),
      ),
    ) ?? "",
    /up to 4 images/,
  );
  assert.equal(
    checkImages([held(10 * MiB)], [png("b.png", 10 * MiB)]).ok,
    true,
    "two maximum-size images fit exactly",
  );
  assert.match(
    rejected(checkImages([held(10 * MiB)], [png("b.png", 10 * MiB - 2), png("c.png", 3)])) ?? "",
    /total 20 MiB/,
  );
});

test("PNG, JPEG, GIF and WebP are recognized by signature; the declared type must agree when given", () => {
  for (const [type, head] of Object.entries(SIGNATURES)) {
    assert.deepEqual(
      checkImages([], [{ name: "x", size: 100, type, head: Uint8Array.from(head) }]),
      { ok: true, mimeTypes: [type] },
    );
    assert.deepEqual(
      checkImages([], [{ name: "x", size: 100, type: "", head: Uint8Array.from(head) }]),
      { ok: true, mimeTypes: [type] },
      "an unknown browser type is fine",
    );
  }
  const unsupported = /use PNG, JPEG, GIF or WebP/;
  assert.match(
    rejected(checkImages([], [png("renamed.png", 100, "image/jpeg")])) ?? "",
    unsupported,
  );
  assert.match(
    rejected(
      checkImages(
        [],
        [
          {
            name: "logo.svg",
            size: 100,
            type: "image/svg+xml",
            head: Uint8Array.from(Buffer.from('<svg xmlns="')),
          },
        ],
      ),
    ) ?? "",
    unsupported,
  );
  assert.match(
    rejected(
      checkImages(
        [],
        [
          {
            name: "notes.txt",
            size: 12,
            type: "text/plain",
            head: Uint8Array.from(Buffer.from("Not an image")),
          },
        ],
      ),
    ) ?? "",
    unsupported,
  );
});

test("an addition the policy refuses leaves the draft's accepted images in place", async () => {
  const key = sessionDraftKey({ cwd: "/scratch", sessionId: "images" });
  const encode = async (file: File) => Buffer.from(await file.arrayBuffer()).toString("base64");
  const image = (name: string) =>
    new File([Uint8Array.from(SIGNATURES["image/png"])], name, { type: "image/png" });
  await imageDrafts.add(key, [image("a.png")], encode);
  assert.deepEqual(
    imageDrafts.get(key).items.map((a) => [a.name, a.mimeType, a.data]),
    [["a.png", "image/png", Buffer.from(SIGNATURES["image/png"]).toString("base64")]],
  );
  await imageDrafts.add(
    key,
    [new File(["Not an image"], "notes.txt", { type: "text/plain" })],
    encode,
  );
  assert.deepEqual(
    imageDrafts.get(key).items.map((a) => a.name),
    ["a.png"],
  );
  assert.match(imageDrafts.get(key).error, /notes\.txt/);
  assert.deepEqual(
    imageDrafts.get(sessionDraftKey({ cwd: "/scratch", sessionId: "other" })).items,
    [],
    "drafts are per session",
  );
  imageDrafts.clear(key);
  assert.deepEqual(imageDrafts.get(key), { items: [], busy: false, error: "" });
});

test("a draft is sendable with visible text or an image, and not while images are being read", () => {
  const none = { items: [], busy: false };
  assert.equal(sendable({ text: " \n", images: none }), false);
  assert.equal(sendable({ text: "hi", images: none }), true);
  assert.equal(
    sendable({ text: "", images: { items: [held(1)], busy: false } }),
    true,
    "image-only messages work",
  );
  assert.equal(sendable({ text: "hi", images: { items: [], busy: true } }), false);
  assert.equal(hasContent({ text: "", images: { items: [held(1)] } }), true);
});

test("quotes from the transcript go before the typed text, one blockquote each, line breaks kept", () => {
  const key = sessionDraftKey({ cwd: "/scratch", sessionId: "quotes" });
  quoteDrafts.add(key, "  the parser skips blank lines\r\n");
  quoteDrafts.add(key, "Alpha by Ann   \nBeta by Ben\n\n\n\nGamma by Cy");
  quoteDrafts.add(key, "the parser skips blank lines");
  quoteDrafts.add(key, " \n ");
  quoteDrafts.add(key, "the lexer is fine");
  assert.equal(
    withQuotes(quoteDrafts.get(key), "Why?"),
    [
      "> the parser skips blank lines",
      "> Alpha by Ann\n> Beta by Ben\n>\n> Gamma by Cy",
      "> the lexer is fine",
      "Why?",
    ].join("\n\n"),
    "a repeated or blank selection adds no quote",
  );
  quoteDrafts.remove(key, 1);
  assert.equal(
    withQuotes(quoteDrafts.get(key), ""),
    "> the parser skips blank lines\n\n> the lexer is fine",
  );
  assert.equal(
    sendable({ text: withQuotes(quoteDrafts.get(key), ""), images: { items: [], busy: false } }),
    true,
    "quotes alone can be sent",
  );
  quoteDrafts.clear(key);
  assert.equal(withQuotes(quoteDrafts.get(key), "hi"), "hi");
});
