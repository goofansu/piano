import assert from "node:assert/strict";
import { test } from "node:test";
import type { Attachment, ServerMessage } from "../shared/wire.ts";
import {
  checkImages,
  createDrafts,
  type DraftMessage,
  EMPTY_DRAFT,
  hasContent,
  type ImageCandidate,
  sendable,
  sessionDraftKey,
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

const PNG_BASE64 = Buffer.from(SIGNATURES["image/png"]).toString("base64");
const pngFile = (name: string) =>
  new File([Uint8Array.from(SIGNATURES["image/png"])], name, { type: "image/png" });
const encode = async (file: File) => Buffer.from(await file.arrayBuffer()).toString("base64");

test("an addition the policy refuses leaves the draft's accepted images in place", async () => {
  const drafts = createDrafts();
  const key = sessionDraftKey({ cwd: "/scratch", sessionId: "images" });
  await drafts.addImages(key, [pngFile("a.png")], encode);
  assert.deepEqual(
    drafts.get(key).images.items.map((a) => [a.name, a.mimeType, a.data]),
    [["a.png", "image/png", PNG_BASE64]],
  );
  await drafts.addImages(
    key,
    [new File(["Not an image"], "notes.txt", { type: "text/plain" })],
    encode,
  );
  assert.deepEqual(
    drafts.get(key).images.items.map((a) => a.name),
    ["a.png"],
  );
  assert.match(drafts.get(key).images.error, /notes\.txt/);
  assert.deepEqual(
    drafts.get(sessionDraftKey({ cwd: "/scratch", sessionId: "other" })).images.items,
    [],
    "drafts are per session",
  );
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
  const drafts = createDrafts();
  const key = sessionDraftKey({ cwd: "/scratch", sessionId: "quotes" });
  drafts.addQuote(key, "  the parser skips blank lines\r\n");
  drafts.addQuote(key, "Alpha by Ann   \nBeta by Ben\n\n\n\nGamma by Cy");
  drafts.addQuote(key, "the parser skips blank lines");
  drafts.addQuote(key, " \n ");
  drafts.addQuote(key, "the lexer is fine");
  drafts.setText(key, "  Why?\n");
  assert.equal(
    drafts.message(key).text,
    [
      "> the parser skips blank lines",
      "> Alpha by Ann\n> Beta by Ben\n>\n> Gamma by Cy",
      "> the lexer is fine",
      "Why?",
    ].join("\n\n"),
    "a repeated or blank selection adds no quote; typed text is trimmed",
  );
  drafts.removeQuote(key, 1);
  drafts.setText(key, " \n");
  assert.equal(drafts.message(key).text, "> the parser skips blank lines\n\n> the lexer is fine");
  assert.equal(drafts.sendable(key), true, "quotes alone can be sent");
  drafts.removeQuote(key, 0);
  drafts.removeQuote(key, 0);
  assert.equal(drafts.sendable(key), false, "whitespace alone cannot");
});

test("submit delivers text, quotes and images as one message, then empties all three", async () => {
  const drafts = createDrafts();
  const key = sessionDraftKey({ cwd: "/scratch", sessionId: "submit" });
  const other = sessionDraftKey({ cwd: "/scratch", sessionId: "other" });
  drafts.setText(other, "untouched");
  drafts.setText(key, "Explain this ");
  drafts.addQuote(key, "a quoted line");
  await drafts.addImages(key, [pngFile("shot.png")], encode);
  const delivered: DraftMessage[] = [];
  assert.equal(
    drafts.submit(key, (message) => {
      delivered.push(message);
      return "sent";
    }),
    true,
  );
  assert.deepEqual(delivered, [
    {
      text: "> a quoted line\n\nExplain this",
      attachments: [{ kind: "image", name: "shot.png", mimeType: "image/png", data: PNG_BASE64 }],
    },
  ]);
  assert.equal(drafts.get(key), EMPTY_DRAFT, "text, quotes and images are all gone");
  assert.equal(drafts.get(other).text, "untouched", "only the submitted draft empties");
  assert.equal(
    drafts.submit(key, () => assert.fail("an empty draft delivers nothing")),
    false,
  );
});

test("submit refuses while images are being read and keeps the whole draft", async () => {
  const drafts = createDrafts();
  const key = sessionDraftKey({ cwd: "/scratch", sessionId: "busy" });
  drafts.setText(key, "with a screenshot");
  drafts.addQuote(key, "context");
  let finish!: () => void;
  const reading = drafts.addImages(key, [pngFile("slow.png")], async (file) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return encode(file);
  });
  // Let the head read finish so the encoder is waiting.
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drafts.get(key).images.busy, true);
  assert.equal(drafts.sendable(key), false);
  assert.equal(
    drafts.submit(key, () => assert.fail("nothing is delivered while images are read")),
    false,
  );
  drafts.setText(key, "with a screenshot, edited");
  finish();
  await reading;
  const draft = drafts.get(key);
  assert.equal(draft.text, "with a screenshot, edited", "typing while reading is kept");
  assert.deepEqual(draft.quotes, ["context"]);
  assert.deepEqual(
    draft.images.items.map((a) => a.name),
    ["slow.png"],
    "the image read joins the kept draft",
  );
  const delivered: DraftMessage[] = [];
  assert.equal(
    drafts.submit(key, (message) => {
      delivered.push(message);
      return "sent";
    }),
    true,
  );
  assert.equal(delivered[0]?.attachments.length, 1);
  assert.equal(drafts.get(key), EMPTY_DRAFT);
});

/** The page's client, as far as drafts listen to it. */
function source() {
  const listeners = new Set<(message: ServerMessage) => void>();
  return {
    listen: (listener: (message: ServerMessage) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (message: ServerMessage) => {
      for (const listener of listeners) listener(message);
    },
    restore: (
      session: { cwd: string; sessionId: string },
      messages: { kind: "steering" | "follow-up"; text: string }[],
    ) => {
      for (const listener of listeners)
        listener({
          _tag: "action_result",
          ...session,
          result: { _tag: "queue_restored", messages },
        } as ServerMessage);
    },
  };
}

test("a restored queue appends as a paragraph to its own session's draft, whichever is on screen", () => {
  const drafts = createDrafts();
  const client = source();
  const stop = drafts.follow(client);
  const original = { cwd: "/scratch/a", sessionId: "a" };
  const current = { cwd: "/scratch/b", sessionId: "b" };
  drafts.setText(sessionDraftKey(original), "existing edit");
  drafts.setText(sessionDraftKey(current), "other draft");
  client.restore(original, [
    { kind: "steering", text: "change direction" },
    { kind: "follow-up", text: "later\nwith detail" },
    { kind: "follow-up", text: "later\nwith detail" },
  ]);
  assert.equal(
    drafts.get(sessionDraftKey(original)).text,
    "existing edit\n\nchange direction\n\nlater\nwith detail\n\nlater\nwith detail",
  );
  assert.equal(drafts.get(sessionDraftKey(current)).text, "other draft");

  client.restore(current, []);
  assert.equal(
    drafts.get(sessionDraftKey(current)).text,
    "other draft",
    "an empty queue erases nothing",
  );

  drafts.setText(sessionDraftKey(current), " \n");
  client.restore(current, [{ kind: "steering", text: "restored" }]);
  assert.equal(
    drafts.get(sessionDraftKey(current)).text,
    " \nrestored",
    "a whitespace-only draft is not a paragraph",
  );

  stop();
  client.restore(current, [{ kind: "steering", text: "after stop" }]);
  assert.equal(
    drafts.get(sessionDraftKey(current)).text,
    " \nrestored",
    "stopping stops following",
  );
});

test("text added to a draft starts a new paragraph only after visible text; typing appends as typed", () => {
  const drafts = createDrafts();
  const key = sessionDraftKey({ cwd: "/scratch/a", sessionId: "a" });
  drafts.paragraph(key, "from Changes");
  assert.equal(drafts.get(key).text, "from Changes", "an empty draft gets no leading blank line");
  drafts.paragraph(key, "from an extension");
  assert.equal(drafts.get(key).text, "from Changes\n\nfrom an extension");
  drafts.append(key, "!");
  assert.equal(
    drafts.get(key).text,
    "from Changes\n\nfrom an extension!",
    "typed characters join the text as they are",
  );
});

/** What every tab attached to the session hears: Pi's receipt for some tab's input, or a refusal. */
const receipt = (inputId: string) =>
  ({
    _tag: "session",
    selectionId: "any",
    cursor: 1,
    event: { _tag: "submission", submission: { inputId } },
  }) as unknown as ServerMessage;
const refusal = (inputId: string) =>
  ({ _tag: "error", message: "This session is archived.", inputId }) as ServerMessage;

test("PIN-132: two tabs' first sends carry distinct input IDs, so one tab's receipt never settles the other's", () => {
  const page = source();
  const key = sessionDraftKey({ cwd: "/scratch", sessionId: "two-tabs" });
  const [a, b] = [createDrafts(), createDrafts()];
  a.follow(page);
  b.follow(page);
  const sent: string[] = [];
  for (const [drafts, text] of [
    [a, "from A"],
    [b, "from B"],
  ] as const) {
    drafts.setText(key, text);
    assert.equal(
      drafts.submit(key, (_, inputId) => {
        sent.push(inputId);
        return "sent";
      }),
      true,
    );
  }
  assert.notEqual(sent[0], sent[1]);
  for (const message of [receipt(sent[1]!), refusal(sent[0]!)]) page.emit(message);
  assert.equal(a.get(key).text, "from A", "A's refused input comes back to A");
  assert.equal(b.get(key), EMPTY_DRAFT, "B's accepted input stays sent");
});

test("PIN-132: refused images returned while another is added stay editable past the limit, never sent", async () => {
  const page = source();
  const drafts = createDrafts();
  drafts.follow(page);
  const key = sessionDraftKey({ cwd: "/scratch", sessionId: "five-images" });
  drafts.setText(key, "four shots");
  await drafts.addImages(
    key,
    ["1", "2", "3", "4"].map((n) => pngFile(`${n}.png`)),
    encode,
  );
  let inputId = "";
  assert.equal(
    drafts.submit(key, (_, id) => {
      inputId = id;
      return "sent";
    }),
    true,
  );
  // The writer adds a fifth while the server's refusal is on its way; the check sees one image.
  let finish!: () => void;
  const reading = drafts.addImages(key, [pngFile("5.png")], async (file) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return encode(file);
  });
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  drafts.setText(key, "and one more");
  page.emit(refusal(inputId));
  finish();
  await reading;
  const draft = drafts.get(key);
  assert.equal(draft.text, "four shots\n\nand one more");
  assert.deepEqual(
    draft.images.items.map((a) => a.name),
    ["1.png", "2.png", "3.png", "4.png", "5.png"],
  );
  assert.match(draft.images.error, /up to 4 images/);
  assert.equal(drafts.sendable(key), false);
  assert.equal(
    drafts.submit(key, () => assert.fail("a message over the limit is not delivered")),
    false,
  );
  assert.equal(drafts.get(key), draft, "the draft is kept whole");
  drafts.removeImage(key, 4);
  assert.equal(drafts.get(key).images.error, "");
  assert.equal(drafts.sendable(key), true);
});
