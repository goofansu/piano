import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "effect";
import { Attachment, type ServerMessage } from "../../../../shared/wire.ts";
import { sessionDraftKey } from "../../../../web/src/shared/state/draftKey.ts";
import { imageLabel } from "../../contracts/attachments.ts";
import {
  checkAttachments,
  createDrafts,
  type DraftMessage,
  EMPTY_DRAFT,
  hasContent,
  type AttachmentCandidate,
  QUEUE_IMAGES_REMOVED_NOTICE,
  QUEUE_RESTORED_NOTICE,
  sendable,
} from "../../web/composer/messageDraft.ts";

const MiB = 1024 * 1024;
const SIGNATURES = {
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d],
  "image/jpeg": [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1],
  "image/gif": [...Buffer.from("GIF89a"), 1, 0, 1, 0, 0, 0],
  "image/webp": [...Buffer.from("RIFF"), 0x24, 0, 0, 0, ...Buffer.from("WEBP")],
} as const;
const png = (name: string, size: number, type = "image/png"): AttachmentCandidate => ({
  name,
  size,
  type,
  head: Uint8Array.from(SIGNATURES["image/png"]),
});
const held = (size: number): Attachment => ({
  kind: "image",
  name: "held.png",
  mimeType: "image/png",
  data: Buffer.alloc(size).toString("base64"),
});
const rejected = (check: ReturnType<typeof checkAttachments>) =>
  check.ok ? undefined : check.reason;

test("each image may be up to exactly 10 MiB of original bytes and must not be empty", () => {
  assert.deepEqual(checkAttachments([], [png("max.png", 10 * MiB)]), {
    ok: true,
    mimeTypes: ["image/png"],
  });
  assert.match(
    rejected(checkAttachments([], [png("big.png", 10 * MiB + 1)])) ?? "",
    /big\.png.*up to 10 MiB/,
  );
  assert.match(rejected(checkAttachments([], [png("empty.png", 0)])) ?? "", /empty\.png/);
});

test("DWG attachments require the file extension and header and allow up to 10 MiB", () => {
  const file = {
    name: "plan.DWG",
    type: "application/octet-stream",
    size: 10 * MiB,
    head: Buffer.from("AC1032"),
  };
  assert.deepEqual(checkAttachments([], [file]), { ok: true, mimeTypes: ["image/vnd.dwg"] });
  assert.equal(checkAttachments([], [{ ...file, size: file.size + 1 }]).ok, false);
  assert.equal(checkAttachments([], [{ ...file, name: "plan.bin" }]).ok, false);
  assert.equal(checkAttachments([], [{ ...file, head: Buffer.from("invalid") }]).ok, false);
});

test("a message holds ten images totalling at most 50 MiB, counting those already in the draft", () => {
  assert.equal(
    checkAttachments(
      Array.from({ length: 8 }, () => held(1)),
      [png("i.png", 1), png("j.png", 1)],
    ).ok,
    true,
  );
  assert.match(
    rejected(
      checkAttachments(
        Array.from({ length: 9 }, () => held(1)),
        [png("j.png", 1), png("k.png", 1)],
      ),
    ) ?? "",
    /up to 10 files/,
  );
  assert.match(
    rejected(
      checkAttachments(
        [],
        Array.from({ length: 11 }, (_, i) => png(`${i}.png`, 1)),
      ),
    ) ?? "",
    /up to 10 files/,
  );
  assert.equal(
    checkAttachments(
      Array.from({ length: 4 }, () => held(10 * MiB)),
      [png("e.png", 10 * MiB)],
    ).ok,
    true,
    "five maximum-size images fit exactly",
  );
  assert.match(
    rejected(
      checkAttachments(
        Array.from({ length: 4 }, () => held(10 * MiB)),
        [png("e.png", 10 * MiB - 2), png("f.png", 3)],
      ),
    ) ?? "",
    /total 50 MiB/,
  );
});

test("PNG, JPEG, GIF and WebP are recognized by signature; the declared type must agree when given", () => {
  for (const [type, head] of Object.entries(SIGNATURES)) {
    assert.deepEqual(
      checkAttachments([], [{ name: "x", size: 100, type, head: Uint8Array.from(head) }]),
      { ok: true, mimeTypes: [type] },
    );
    assert.deepEqual(
      checkAttachments([], [{ name: "x", size: 100, type: "", head: Uint8Array.from(head) }]),
      { ok: true, mimeTypes: [type] },
      "an unknown browser type is fine",
    );
  }
  const unsupported = /use PNG, JPEG, GIF, WebP, or DWG/;
  assert.match(
    rejected(checkAttachments([], [png("renamed.png", 100, "image/jpeg")])) ?? "",
    unsupported,
  );
  assert.match(
    rejected(
      checkAttachments(
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
      checkAttachments(
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

test("an image tile names its type and size as the refusals do, in binary units", () => {
  assert.equal(imageLabel("image/jpeg", 1572864), "JPEG · 1.5 MiB");
  assert.equal(imageLabel("image/jpeg", 9961472), "JPEG · 9.5 MiB");
  assert.equal(imageLabel("image/webp", 10 * MiB), "WebP · 10 MiB");
  assert.equal(imageLabel("image/png", 1536), "PNG · 1.5 KiB");
  assert.equal(imageLabel("image/gif", 1024), "GIF · 1 KiB");
  assert.equal(imageLabel("image/png", 512), "PNG · 512 B");
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

test("an overlong image filename is cut to the 255 code units the attachment schema accepts", async () => {
  const drafts = createDrafts();
  const key = sessionDraftKey({ cwd: "/scratch", sessionId: "long-name" });
  await drafts.addImages(key, [pngFile("n".repeat(300))], encode);
  const [image] = drafts.get(key).images.items;
  assert.equal(image.name, "n".repeat(255));
  Schema.decodeUnknownSync(Attachment)(image);
  assert.throws(() => Schema.decodeUnknownSync(Attachment)({ ...image, name: "n".repeat(256) }));
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
  const notices: string[] = [];
  const stop = drafts.follow(client, (message) => notices.push(message));
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
  client.restore(current, [
    { kind: "follow-up", text: "" },
    { kind: "steering", text: "" },
  ]);
  assert.equal(
    drafts.get(sessionDraftKey(current)).text,
    "other draft",
    "an image-only queue returns no text",
  );
  client.restore(current, [
    { kind: "follow-up", text: "" },
    { kind: "steering", text: "mixed" },
  ]);
  assert.equal(
    drafts.get(sessionDraftKey(current)).text,
    "other draft\n\nmixed",
    "image-only messages add no blank paragraphs",
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
  assert.deepEqual(
    notices,
    [
      QUEUE_RESTORED_NOTICE,
      QUEUE_IMAGES_REMOVED_NOTICE,
      QUEUE_RESTORED_NOTICE,
      QUEUE_RESTORED_NOTICE,
    ],
    "each non-empty restore says whether text reached the draft; an empty one says nothing",
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

const receipt = (inputId: string, outcome = "started") =>
  ({
    _tag: "session",
    selectionId: "any",
    cursor: 1,
    event: { _tag: "submission", submission: { id: 1, inputId, outcome } },
  }) as unknown as ServerMessage;
const refusal = (inputId: string) =>
  ({ _tag: "error", message: "This session is archived.", inputId }) as ServerMessage;

test("PIN-132: two tabs' first sends carry distinct input IDs, so one tab's receipt never settles the other's", () => {
  const page = source();
  const key = sessionDraftKey({ cwd: "/scratch", sessionId: "two-tabs" });
  const [a, b] = [createDrafts(), createDrafts()];
  a.follow(page, () => {});
  b.follow(page, () => {});
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

test("Pi-rejected images returned while another is added stay editable past the limit, never sent", async () => {
  const page = source();
  const drafts = createDrafts();
  drafts.follow(page, () => {});
  const key = sessionDraftKey({ cwd: "/scratch", sessionId: "eleven-images" });
  drafts.setText(key, "ten shots");
  await drafts.addImages(
    key,
    Array.from({ length: 10 }, (_, i) => pngFile(`${i + 1}.png`)),
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
  let finish!: () => void;
  const reading = drafts.addImages(key, [pngFile("11.png")], async (file) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return encode(file);
  });
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  drafts.setText(key, "and one more");
  page.emit(receipt(inputId, "rejected"));
  finish();
  await reading;
  const draft = drafts.get(key);
  assert.equal(draft.text, "ten shots\n\nand one more");
  assert.deepEqual(
    draft.images.items.map((a) => a.name),
    Array.from({ length: 11 }, (_, i) => `${i + 1}.png`),
  );
  assert.match(draft.images.error, /up to 10 files/);
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

test("a follow-up its session refused before Pi saw it comes back to its draft, once", () => {
  const page = source();
  const drafts = createDrafts();
  drafts.follow(page, () => {});
  const key = sessionDraftKey({ cwd: "/scratch", sessionId: "not-sent" });
  const send = (text: string) => {
    let inputId = "";
    drafts.setText(key, text);
    drafts.submit(key, (_, id) => {
      inputId = id;
      return "sent";
    });
    assert.equal(drafts.get(key), EMPTY_DRAFT);
    return inputId;
  };

  const started = send("reached Pi");
  for (const message of [receipt(started, "submitting"), receipt(started, "started")])
    page.emit(message);
  assert.equal(drafts.get(key), EMPTY_DRAFT, "input Pi took stays sent");

  const refused = send("never reached Pi");
  for (const message of [receipt(refused, "submitting"), receipt(refused, "not_sent")])
    page.emit(message);
  assert.equal(drafts.get(key).text, "never reached Pi");

  page.emit(refusal(refused));
  assert.equal(drafts.get(key).text, "never reached Pi");
});
