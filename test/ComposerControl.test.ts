import assert from "node:assert/strict";
import { test } from "node:test";
import type { Attachment } from "../shared/wire.ts";
import {
  type ComposerSituation,
  composerControl,
  deliveryAction,
} from "../web/src/lib/composerControl.ts";

const image: Attachment = { kind: "image", name: "a.png", mimeType: "image/png", data: "AA==" };
const idle: ComposerSituation = {
  text: "",
  images: { items: [], busy: false },
  disabled: false,
  streaming: false,
  compacting: false,
  stopping: false,
  queued: 0,
  mode: "steering",
};
const at = (over: Partial<ComposerSituation>) => composerControl({ ...idle, ...over });

test("an idle session sends visible text with Enter, and nothing when the draft is blank or an image is still being read", () => {
  const ready = at({ text: "hi" });
  assert.equal(ready.primary, "send");
  assert.equal(ready.label, "Send");
  assert.deepEqual(ready.hint, { lead: "Send", key: "Enter" });
  assert.equal(ready.enabled, true);
  assert.equal(ready.escape, "none");
  for (const blocked of [
    at({ text: "  \n" }),
    at({ text: "hi", images: { items: [], busy: true } }),
    at({ text: "hi", disabled: true }),
    at({ text: "hi", stopping: true }),
  ]) {
    assert.equal(blocked.primary, "send");
    assert.equal(blocked.enabled, false);
    assert.equal(
      blocked.delivery(false),
      null,
      "the send key sends nothing the button would refuse",
    );
  }
});

test("the send key delivers exactly when the button is enabled", () => {
  const flags = [false, true];
  for (const streaming of flags)
    for (const compacting of flags)
      for (const stopping of flags)
        for (const disabled of flags)
          for (const text of ["", "hi"])
            for (const items of [[], [image]])
              for (const busy of flags) {
                const control = at({
                  text,
                  images: { items, busy },
                  streaming,
                  compacting: streaming && compacting,
                  stopping,
                  disabled,
                });
                if (control.primary === "stop") assert.equal(control.delivery(false), null);
                else
                  assert.equal(
                    control.delivery(false) !== null,
                    control.enabled,
                    JSON.stringify({
                      streaming,
                      compacting,
                      stopping,
                      disabled,
                      text,
                      items: items.length,
                      busy,
                    }),
                  );
              }
});

test("while Pi works an empty draft makes the button Stop, and Stop is refused while loading or already stopping", () => {
  const stop = at({ streaming: true });
  assert.equal(stop.primary, "stop");
  assert.equal(stop.label, "Stop");
  assert.equal(stop.enabled, true);
  assert.deepEqual(stop.hint, { lead: "Stop", key: "Esc" });
  assert.deepEqual(at({ streaming: true, queued: 2 }).hint, {
    lead: "Stop and move queued input to the draft.",
    key: "Esc",
    tail: " edits without stopping.",
  });
  assert.equal(at({ streaming: true, stopping: true }).enabled, false);
  assert.equal(at({ streaming: true, disabled: true }).enabled, false);
});

test("while Pi works a draft is queued in the chosen mode, and Alt+Enter uses the other mode", () => {
  const steer = at({ streaming: true, text: "hi" });
  assert.equal(steer.primary, "queue");
  assert.equal(steer.showDelivery, true);
  assert.equal(steer.label, "steer");
  assert.deepEqual(steer.hint, { lead: "steer: Adjust the current task.", key: "Enter" });
  assert.equal(steer.delivery(false), "steering");
  assert.equal(steer.delivery(true), "follow-up");
  const followUp = at({ streaming: true, text: "hi", mode: "follow-up" });
  assert.equal(followUp.label, "follow-up");
  assert.deepEqual(followUp.hint, {
    lead: "follow-up: Add work after the current task.",
    key: "Enter",
  });
  assert.equal(followUp.delivery(false), "follow-up");
  assert.equal(followUp.delivery(true), "steering");
});

test("nothing can steer a compaction: every send waits as a follow-up and the delivery picker is hidden", () => {
  for (const mode of ["steering", "follow-up"] as const) {
    const control = at({ streaming: true, compacting: true, text: "hi", mode });
    assert.equal(control.showDelivery, false);
    assert.equal(control.label, "Queue message");
    assert.deepEqual(control.hint, { lead: "Send after compaction finishes", key: "Enter" });
    assert.equal(control.delivery(false), "follow-up");
    assert.equal(control.delivery(true), "follow-up");
  }
});

test("images wait for Pi to finish", () => {
  const waiting = at({ streaming: true, text: "hi", images: { items: [image], busy: false } });
  assert.equal(waiting.imagesWaiting, true);
  assert.equal(waiting.enabled, false);
  assert.equal(
    at({ images: { items: [image], busy: false } }).enabled,
    true,
    "an image alone is sendable when idle",
  );
});

test("Esc returns queued messages to the draft first, then stops Pi, and does nothing while loading or stopping", () => {
  assert.equal(at({ streaming: true, queued: 1 }).escape, "restore-queue");
  assert.equal(at({ streaming: true, queued: 1, text: "typed" }).escape, "restore-queue");
  assert.equal(at({ queued: 1 }).escape, "restore-queue", "a paused queue is restored too");
  assert.equal(at({ streaming: true }).escape, "stop");
  assert.equal(at({ streaming: true, text: "typed" }).escape, "stop");
  assert.equal(at({}).escape, "none");
  assert.equal(at({ streaming: true, queued: 1, stopping: true }).escape, "none");
  assert.equal(at({ streaming: true, queued: 1, disabled: true }).escape, "none");
  assert.equal(at({ queued: 1, stopping: true }).canRestoreQueue, false);
});

test("steering is delivered as a steer, a follow-up as a prompt", () => {
  assert.equal(deliveryAction("steering"), "steer");
  assert.equal(deliveryAction("follow-up"), "prompt");
});
