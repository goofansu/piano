import assert from "node:assert/strict";
import { test } from "node:test";
import type { Attachment, StartOptions } from "../shared/wire.ts";
import {
  type ComposerSituation,
  composerControl,
  messageCommand,
  type NewSessionSituation,
  newSessionCommand,
  newSessionReady,
  queuePanel,
  RESTORE_QUEUE,
  STOP,
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
  assert.equal(ready.escape, null);
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

const restoreQueue = { _tag: "act", action: { _tag: "restore_queue" } };
const stop = { _tag: "act", action: { _tag: "stop" } };

test("Esc returns queued messages to the draft first, then stops Pi, and does nothing while loading or stopping", () => {
  assert.deepEqual(at({ streaming: true, queued: 1 }).escape, restoreQueue);
  assert.deepEqual(at({ streaming: true, queued: 1, text: "typed" }).escape, restoreQueue);
  assert.deepEqual(at({ queued: 1 }).escape, restoreQueue, "a paused queue is restored too");
  assert.deepEqual(at({ streaming: true }).escape, stop);
  assert.deepEqual(at({ streaming: true, text: "typed" }).escape, stop);
  assert.equal(at({}).escape, null);
  assert.equal(at({ streaming: true, queued: 1, stopping: true }).escape, null);
  assert.equal(at({ streaming: true, queued: 1, disabled: true }).escape, null);
  assert.equal(at({ queued: 1, stopping: true }).canRestoreQueue, false);
  assert.deepEqual(STOP, stop, "the Stop button sends what Esc sends");
  assert.deepEqual(RESTORE_QUEUE, restoreQueue, "Edit sends what Esc sends");
});

const start: StartOptions = { model: "fake/alpha", thinkingLevel: "high" };
const message = { text: "hi", attachments: [image] };
/** The command a send-key press sends in situation `over`, or null. */
const sent = (over: Partial<ComposerSituation>, alt: boolean) => {
  const kind = at(over).delivery(alt);
  return kind && messageCommand(kind, message, start);
};

test("a send carries the draft and the picker's start options, as a steer or a prompt by delivery", () => {
  const steer = { _tag: "act", action: { _tag: "steer", text: "hi", attachments: [image] }, start };
  const prompt = {
    _tag: "act",
    action: { _tag: "prompt", text: "hi", attachments: [image] },
    start,
  };
  assert.deepEqual(sent({ text: "hi" }, false), steer, "idle Enter in steering mode");
  assert.deepEqual(sent({ text: "hi", streaming: true }, false), steer);
  assert.deepEqual(sent({ text: "hi", streaming: true }, true), prompt, "Alt+Enter follows up");
  assert.deepEqual(sent({ text: "hi", streaming: true, mode: "follow-up" }, false), prompt);
  assert.deepEqual(sent({ text: "hi", streaming: true, mode: "follow-up" }, true), steer);
  for (const alt of [false, true])
    assert.deepEqual(
      sent({ text: "hi", streaming: true, compacting: true }, alt),
      prompt,
      "a send during compaction is forced to a follow-up",
    );
  assert.equal(sent({ text: "" }, false), null);
});

test("the queue panel names a running or paused queue, offers Edit or Edit all, and shows kinds only when a steer is queued", () => {
  assert.equal(queuePanel([], true), null);
  assert.deepEqual(queuePanel([{ kind: "follow-up" }], true), {
    heading: "Queued messages (1)",
    editLabel: "Edit",
    editAriaLabel: "Edit queued message",
    showKinds: false,
  });
  assert.deepEqual(queuePanel([{ kind: "follow-up" }, { kind: "steering" }], false), {
    heading: "Paused queue (2)",
    editLabel: "Edit all",
    editAriaLabel: "Edit all queued messages",
    showKinds: true,
  });
});

const firstMessage: NewSessionSituation = {
  text: "hi",
  images: { items: [], busy: false },
  connected: true,
  catalog: {},
  cwd: "/repo",
  model: "fake/alpha",
  projectOpen: true,
};

test("the New page sends its first message only with a connection, a directory whose models loaded, a model, an open project and a sendable draft", () => {
  assert.equal(newSessionReady(firstMessage), true);
  assert.equal(
    newSessionReady({ ...firstMessage, text: "", images: { items: [image], busy: false } }),
    true,
    "an image alone starts a session",
  );
  const blocked: [string, Partial<NewSessionSituation>][] = [
    ["disconnected", { connected: false }],
    ["models still loading", { catalog: null }],
    ["models failed to load", { catalog: { error: "pi exited" } }],
    ["no directory", { cwd: "  " }],
    ["no model", { model: undefined }],
    ["archived project", { projectOpen: false }],
    ["blank draft", { text: " \n" }],
    ["image still being read", { images: { items: [image], busy: true } }],
  ];
  for (const [why, over] of blocked)
    assert.equal(newSessionReady({ ...firstMessage, ...over }), false, why);
});

test("the first message creates the session in the trimmed directory, joining the project, with the picker's options", () => {
  assert.deepEqual(newSessionCommand({ cwd: " /repo \n", projectId: "p1" }, message, start), {
    _tag: "create_session",
    cwd: "/repo",
    projectId: "p1",
    options: start,
    text: "hi",
    attachments: [image],
  });
  assert.equal(
    JSON.stringify(newSessionCommand({ cwd: "/repo", projectId: undefined }, message, {})),
    JSON.stringify({
      _tag: "create_session",
      cwd: "/repo",
      options: {},
      text: "hi",
      attachments: [image],
    }),
    "without a project the command names none",
  );
});
