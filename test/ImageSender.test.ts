/**
 * Sending a draft with images to a remote: the images are prepared on the peer first, then one
 * input carries the reference. These hold the rules a person relies on while that upload runs:
 * moving away abandons it and gives the draft back, a reference no input uses is discarded, one
 * upload runs at a time, and the model pick is spent only by input that was sent.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PreparedImages } from "../shared/remoteImages.ts";
import type { ClientCommand } from "../shared/wire.ts";
import { messageCommand } from "../web/src/lib/composerControl.ts";
import { createImageSender, type ImageSend } from "../web/src/lib/imageSender.ts";
import { createDrafts, type DraftKey, sessionDraftKey } from "../web/src/lib/messageDraft.ts";
import type { SendDisposition } from "../web/src/lib/ws.ts";

const TARGET = { cwd: "/repo", sessionId: "s1" };
const KEY = sessionDraftKey(TARGET);
const START = { model: "a/quick" };

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const addImage = (drafts: ReturnType<typeof createDrafts>) =>
  drafts.addImages(KEY, [new File([png], "shot.png", { type: "image/png" })], async () =>
    Buffer.from(png).toString("base64"),
  );

async function harness(disposition: SendDisposition = "sent") {
  const drafts = createDrafts();
  drafts.setText(KEY, "Reply with exactly: X");
  await addImage(drafts);
  const uploads: Array<{ resolve: (reference: PreparedImages) => void; signal: AbortSignal }> = [];
  const discarded: string[] = [];
  const sent: ClientCommand[] = [];
  let consumed = 0;
  const sender = createImageSender({
    prepare: (_machine, _target, _images, signal) =>
      new Promise((resolve) => uploads.push({ resolve, signal })),
    discard: (_machine, reference) => discarded.push(reference.id),
  });
  const editor = (key: DraftKey): ImageSend["editor"] => ({
    get attachments() {
      return drafts.get(key).images;
    },
    get preparing() {
      return drafts.get(key).preparing;
    },
    submit: (deliver) => drafts.submit(key, deliver),
    prepareSubmit: (deliver) => drafts.prepareSubmit(key, deliver),
  });
  const send = () =>
    sender.send(
      {
        machineId: "eng-1",
        target: TARGET,
        editor: editor(KEY),
        captureSend: () => (command) => {
          sent.push(command);
          return disposition;
        },
        choice: { start: START, consume: () => consumed++ },
      },
      (message, inputId, start) => messageCommand("follow-up", message, start, inputId),
    );
  return {
    drafts,
    sender,
    uploads,
    discarded,
    sent,
    consumed: () => consumed,
    send,
  };
}

test("moving away while images upload discards them, gives the draft back and keeps the pick", async () => {
  const h = await harness();
  const done = h.send();
  assert.equal(h.uploads.length, 1);
  assert.equal(h.drafts.get(KEY).text, "", "the draft is preparing, not editable");
  h.sender.abandon();
  assert.ok(h.uploads[0]!.signal.aborted, "the upload is abandoned");
  // The peer finishes the upload anyway: its reference must not be used or kept.
  h.uploads[0]!.resolve({ id: "late" });
  await done;
  assert.deepEqual(h.sent, [], "nothing goes to the old or new target");
  assert.deepEqual(h.discarded, ["late"]);
  assert.equal(h.drafts.get(KEY).text, "Reply with exactly: X");
  assert.equal(h.drafts.get(KEY).images.items.length, 1);
  assert.equal(h.consumed(), 0, "the abandoned send is never reported");
});

for (const disposition of ["not-sent", "sent", "uncertain"] as const) {
  test(`${disposition === "uncertain" ? "an" : "a"} ${disposition} send ${disposition === "not-sent" ? "discards its images and keeps" : "keeps its images and spends"} the pick`, async () => {
    const h = await harness(disposition);
    const done = h.send();
    h.uploads[0]!.resolve({ id: "prepared" });
    await done;
    const [input] = h.sent;
    assert.ok(input?._tag === "act" && input.action._tag === "prompt");
    assert.deepEqual(input.preparedImages, { id: "prepared" });
    assert.equal(input.action.attachments, undefined, "no inline bytes");
    assert.deepEqual(input.start, START, "the pick captured at send");
    if (disposition === "not-sent") {
      assert.deepEqual(h.discarded, ["prepared"]);
      assert.equal(h.consumed(), 0);
      assert.equal(h.drafts.get(KEY).images.items.length, 1, "the draft comes back");
    } else {
      // Pi may hold the input: the reference is its, never reused or resubmitted.
      assert.deepEqual(h.discarded, []);
      assert.equal(h.consumed(), 1);
    }
  });
}

test("a second send while images upload is ignored", async () => {
  const h = await harness();
  const first = h.send();
  // A newer image typed in while the first one uploads: sending it now would race the first.
  h.drafts.setText(KEY, "And this one");
  await addImage(h.drafts);
  await h.send();
  assert.equal(h.uploads.length, 1, "one upload at a time");
  assert.equal(h.drafts.get(KEY).text, "And this one", "the newer draft waits");
  h.uploads[0]!.resolve({ id: "prepared" });
  await first;
  assert.equal(h.sent.length, 1);
  assert.equal(h.consumed(), 1);
});
