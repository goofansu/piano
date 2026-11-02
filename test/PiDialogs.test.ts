import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientCommand, Dialog, DialogResolution, SessionState } from "../shared/wire.ts";
import {
  type AnswerReceipt,
  type AnswerTone,
  answeredQuestion,
  answerReceipt,
  createDialogAnswer,
  createQuestionReplies,
  pendingDialogs,
} from "../web/src/lib/piDialogs.ts";
import { type AppState, initialState, type SessionView, sessionKey } from "../web/src/store.ts";

const DEADLINE = 10_000;
const dialog = (id: string, extra: Partial<Dialog> = {}): Dialog => ({
  id,
  generation: "g1",
  receivedAt: 0,
  deadlineAt: DEADLINE,
  deadlineKind: "pi-timeout",
  method: "input",
  ...extra,
});

function answering(d: Dialog = dialog("d1")) {
  const sent: ClientCommand[] = [];
  return {
    sent,
    dialogAnswer: createDialogAnswer({
      dialog: d,
      send: (c) => {
        sent.push(c);
        return "sent";
      },
    }),
  };
}

test("a dialog is answered at most once, with its id and generation", () => {
  const { sent, dialogAnswer } = answering();
  assert.equal(dialogAnswer.answer({ value: "first" }, 1_000, "sel"), true);
  assert.equal(dialogAnswer.answer({ value: "second" }, 1_000, "sel"), false);
  assert.equal(dialogAnswer.cancel(1_000, "sel"), false);
  assert.deepEqual(sent, [
    { _tag: "act", action: { _tag: "answer", id: "d1", generation: "g1", value: "first" } },
  ]);
  assert.equal(dialogAnswer.view(1_000, "sel").submitted, true);
  assert.equal(dialogAnswer.view(1_000, "sel").disabled, true);
});

test("an answer at or after the deadline sends nothing", () => {
  const { sent, dialogAnswer } = answering();
  assert.equal(dialogAnswer.view(DEADLINE, "sel").disabled, true);
  assert.equal(dialogAnswer.answer({ value: "late" }, DEADLINE, "sel"), false);
  assert.equal(dialogAnswer.answer({ value: "later" }, DEADLINE + 1, "sel"), false);
  assert.deepEqual(sent, []);
  assert.equal(dialogAnswer.view(DEADLINE, "sel").submitted, false);
});

test("a question its tool call owns has no answer deadline but still requires a connection", () => {
  const { dialogAnswer } = answering(
    dialog("owned", { toolCallId: "call-1", deadlineAt: null, deadlineKind: "tool-end" }),
  );
  const later = 24 * 60 * 60_000;
  assert.equal(dialogAnswer.view(later, "sel").deadline, null);
  assert.equal(dialogAnswer.view(later, "sel").disabled, false);
  assert.equal(dialogAnswer.answer({ value: "kept" }, later, null), false);
  assert.equal(dialogAnswer.answer({ value: "kept" }, later, "sel"), true);
});

test("a disconnected answer sends nothing and leaves the dialog answerable", () => {
  const { sent, dialogAnswer } = answering();
  assert.equal(dialogAnswer.answer({ confirmed: true }, 1_000, null), false);
  assert.deepEqual(sent, []);
  assert.deepEqual(dialogAnswer.view(1_000, null), {
    submitted: false,
    disabled: true,
    abortDisabled: true,
    title: "Pi needs an answer",
    deadline: { label: "Estimated Pi timeout", remainingSeconds: 9, at: DEADLINE },
    waiting: "Sending response…",
  });
  assert.equal(
    dialogAnswer.answer({ confirmed: true }, 1_000, "sel"),
    true,
    "answerable on reconnect",
  );
});

for (const action of ["answer", "cancel", "abort"] as const) {
  test(`a known-unsent ${action} releases the guard; uncertain delivery never does`, () => {
    let disposition: "not-sent" | "uncertain" = "not-sent";
    let attempts = 0;
    const controller = createDialogAnswer({
      dialog: dialog("d1"),
      send: () => {
        attempts++;
        assert.equal(controller.cancel(1_000, "sel"), false, "guard before calling transport");
        return disposition;
      },
    });
    const submit = () =>
      action === "answer"
        ? controller.answer({ value: "kept" }, 1_000, "sel")
        : controller[action](1_000, "sel");
    assert.equal(submit(), false);
    assert.equal(controller.getState(), null);
    assert.equal(controller.view(1_000, null).disabled, true);
    assert.equal(controller.view(1_000, null).abortDisabled, true);
    assert.equal(controller.view(1_000, "sel").disabled, false);
    assert.equal(controller.view(1_000, "sel").abortDisabled, false);
    assert.equal(controller.view(DEADLINE, "sel").disabled, true, "retry respects deadline");
    assert.equal(controller.view(DEADLINE, "sel").abortDisabled, false);
    assert.equal(attempts, 1, "reconnection does not replay");
    disposition = "uncertain";
    assert.equal(submit(), true);
    assert.equal(controller.getState(), "sel");
    assert.equal(controller.view(1_000, null).disabled, true);
    assert.equal(controller.view(1_000, "sel").disabled, true);
    assert.equal(controller.view(1_000, "sel").abortDisabled, true);
    assert.equal(submit(), false);
    assert.equal(controller.cancel(1_000, "sel"), false);
    assert.equal(controller.abort(1_000, "sel"), false);
    assert.equal(attempts, 2);
  });
}

test("closing a dialog cancels it", () => {
  const { sent, dialogAnswer } = answering();
  assert.equal(dialogAnswer.cancel(1_000, "sel"), true);
  assert.deepEqual(sent, [
    { _tag: "act", action: { _tag: "answer", id: "d1", generation: "g1", cancelled: true } },
  ]);
});

test("a sent answer holds for its attachment; a later one may answer the dialog again", () => {
  const { sent, dialogAnswer } = answering();
  assert.equal(dialogAnswer.answer({ value: "first" }, 1_000, "sel"), true);
  assert.equal(dialogAnswer.view(1_000, null).submitted, true, "awaits its outcome while closed");
  assert.equal(dialogAnswer.view(1_000, null).disabled, true);
  assert.equal(dialogAnswer.answer({ value: "again" }, 1_000, "sel"), false);
  assert.equal(dialogAnswer.abort(1_000, "sel"), false);
  // Still listed on a new attachment: the server never claimed the first answer.
  assert.equal(dialogAnswer.view(1_000, "sel2").submitted, false);
  assert.equal(dialogAnswer.answer({ value: "again" }, 1_000, "sel2"), true);
  assert.equal(dialogAnswer.answer({ value: "third" }, 1_000, "sel2"), false);
  assert.deepEqual(
    sent.map((c) => c._tag === "act" && c.action._tag === "answer" && c.action.value),
    ["first", "again"],
  );
});

test("abort is sent once and stays available after the deadline", () => {
  const { sent, dialogAnswer } = answering();
  const late = dialogAnswer.view(DEADLINE + 5_000, "sel");
  assert.equal(late.disabled, true);
  assert.equal(late.abortDisabled, false, "abort ignores the deadline");
  assert.equal(dialogAnswer.abort(DEADLINE + 5_000, null), false, "not while disconnected");
  assert.equal(dialogAnswer.abort(DEADLINE + 5_000, "sel"), true);
  assert.equal(dialogAnswer.abort(DEADLINE + 5_000, "sel"), false);
  assert.equal(dialogAnswer.answer({ value: "x" }, 1_000, "sel"), false, "abort ends answering");
  assert.deepEqual(sent, [{ _tag: "act", action: { _tag: "abort" } }]);
  assert.equal(dialogAnswer.view(1_000, "sel").abortDisabled, true);
});

test("subscribers hear the dialog become submitted", () => {
  const { dialogAnswer } = answering();
  let heard = 0;
  const stop = dialogAnswer.subscribe(() => heard++);
  dialogAnswer.answer({ value: "x" }, 1_000, "sel");
  stop();
  assert.equal(heard, 1);
  assert.equal(dialogAnswer.getState(), "sel");
});

test("remaining seconds round up and stop at zero", () => {
  const { dialogAnswer } = answering();
  const remaining = (now: number) => dialogAnswer.view(now, "sel").deadline?.remainingSeconds;
  assert.equal(remaining(0), 10);
  assert.equal(remaining(1), 10);
  assert.equal(remaining(DEADLINE - 1), 1);
  assert.equal(remaining(DEADLINE), 0);
  assert.equal(remaining(DEADLINE + 3_000), 0);
});

test("a dialog reads the same on every surface: title, deadline and what it waits for", () => {
  const view = (extra: Partial<Dialog>) =>
    answering(dialog("d1", extra)).dialogAnswer.view(1_000, "sel");
  const owned = { toolCallId: "call-1", deadlineAt: null, deadlineKind: "tool-end" } as const;

  assert.equal(view({}).title, "Pi needs an answer");
  assert.equal(view({ title: "" }).title, "Pi needs an answer");
  assert.equal(view({ title: "Pick one" }).title, "Pick one");

  assert.deepEqual(view({}).deadline, {
    label: "Estimated Pi timeout",
    remainingSeconds: 9,
    at: DEADLINE,
  });
  assert.equal(
    view({ deadlineKind: "host-recovery" }).deadline?.label,
    "Host recovery cancellation",
  );
  assert.equal(view(owned).deadline, null, "an owned question has no deadline to report");
  assert.equal(
    view({ ...owned, method: "confirm" }).deadline,
    null,
    "an owned confirmation must not read as a host recovery with null seconds",
  );

  assert.equal(view({ method: "select" }).waiting, "Sending response…");
  assert.equal(view({ ...owned, method: "select" }).waiting, "Waiting for Pi to confirm…");
  assert.equal(view({ method: "confirm" }).waiting, "Waiting for the host’s resolution.");
});

const session = (dialogs: Dialog[]): SessionView => ({
  cwd: "/repo",
  sessionId: "s1",
  hosted: true,
  cursor: null,
  state: { sessionId: "s1" } as SessionState,
  messages: [],
  dialogs,
});
const ready: AppState = { ...initialState, connected: true, selectionId: "sel" };

test("a receipt is shown by delivery and ownership; an answer-less one is a status line", () => {
  const answered: DialogResolution = {
    id: "d1",
    generation: "g1",
    reason: "answered",
    delivery: "written",
    detail: "Written to Pi",
    answer: { title: "Question", value: "Answer" },
  };
  const quiet: AnswerReceipt = {
    card: false,
    status: null,
    details: false,
    notice: null,
    accepted: false,
  };
  const card = (
    label: string,
    tone: AnswerTone,
    details = false,
    pulse = false,
  ): AnswerReceipt => ({
    ...quiet,
    card: true,
    status: { label, tone, pulse },
    details,
  });
  const cases: [string, Partial<DialogResolution>, AnswerReceipt][] = [
    ["pending", { delivery: "pending" }, card("Sending answer…", "busy", false, true)],
    ["written, not owned", {}, quiet],
    [
      "written, owned by a tool call",
      { toolCallId: "call-1" },
      card("Sent, waiting for Pi…", "busy"),
    ],
    ["accepted", { delivery: "accepted" }, { ...quiet, accepted: true }],
    [
      "accepted, owned",
      { delivery: "accepted", toolCallId: "call-1" },
      { ...quiet, accepted: true },
    ],
    [
      "rejected",
      { delivery: "rejected", toolCallId: "call-1" },
      card("Answer not accepted", "err", true),
    ],
    ["uncertain", { delivery: "uncertain" }, card("Delivery uncertain", "warn", true)],
    ["not sent", { delivery: "not-sent" }, card("Not sent", "muted", true)],
  ];
  for (const [name, change, expected] of cases)
    assert.deepEqual(answerReceipt({ ...answered, ...change }), expected, name);

  const ended = (reason: DialogResolution["reason"], delivery: DialogResolution["delivery"]) =>
    answerReceipt({
      ...answered,
      reason,
      delivery,
      detail: "Transport outcome",
      answer: undefined,
    });
  for (const delivery of ["written", "accepted"] as const) {
    const receipt = ended("cancelled", delivery);
    assert.equal(receipt.notice, null, delivery);
    assert.equal(receipt.card, false);
    assert.equal(receipt.accepted, false, "only an answer is announced");
  }
  for (const delivery of ["pending", "uncertain", "not-sent"] as const)
    assert.deepEqual(ended("cancelled", delivery).notice, {
      tone: "quiet",
      title: "Dialog cancelled: Transport outcome",
    });
  assert.deepEqual(ended("expired", "not-sent").notice, {
    tone: "quiet",
    title: "Dialog expired: Transport outcome",
  });
});

test("a written answer leaves the composer after the last question; delivery problems remain visible", () => {
  const resolution: DialogResolution = {
    id: "d1",
    generation: "g1",
    reason: "answered",
    delivery: "written",
    detail: "Written to Pi",
    answer: { title: "Last question", value: "Last answer" },
  };
  const view = (receipt = resolution, dialogs: Dialog[] = []): AppState => ({
    ...ready,
    session: {
      ...session(dialogs),
      state: { sessionId: "s1", isStreaming: true, dialogResolution: receipt },
    },
  });
  assert.equal(
    answeredQuestion(view()),
    undefined,
    "completed questions must not pin the last answer above the composer",
  );
  assert.equal(
    answeredQuestion(view(resolution, [dialog("d2")])),
    undefined,
    "a new question must not resurrect an old receipt",
  );
  const owned = { ...resolution, toolCallId: "call-1" };
  assert.equal(answeredQuestion(view(owned)), owned, "an owned answer waits for its tool's end");
  assert.equal(answeredQuestion({ ...view(owned), resync: true }), undefined);
  assert.equal(answeredQuestion(ready), undefined);
});

test("pending dialogs expose the queue head and how many follow it", () => {
  const pending = pendingDialogs({
    ...ready,
    session: session([dialog("d1"), dialog("d2"), dialog("d3")]),
  });
  assert.equal(pending.head?.id, "d1");
  assert.equal(pending.more, 2);
  assert.equal(pending.attachment, "sel");
  assert.deepEqual(pendingDialogs(ready), {
    head: undefined,
    surface: null,
    more: 0,
    attachment: "sel",
    session: null,
  });
});

test("a confirmation is asked in a modal, every other method inline", () => {
  const surface = (method: Dialog["method"]) =>
    pendingDialogs({ ...ready, session: session([dialog("d1", { method })]) }).surface;
  assert.equal(surface("confirm"), "modal");
  for (const method of ["select", "input", "editor"] as const)
    assert.equal(surface(method), "inline", method);
});

test("no dialog is pending during a resync, and answers wait for a settled attachment", () => {
  const queued = session([dialog("d1")]);
  assert.deepEqual(pendingDialogs({ ...ready, resync: true, session: queued }), {
    head: undefined,
    surface: null,
    more: 0,
    attachment: null,
    session: sessionKey(queued),
  });
  const selecting = pendingDialogs({
    ...ready,
    session: queued,
    selecting: { cwd: "/repo", sessionId: "s1" },
  });
  assert.equal(selecting.head?.id, "d1");
  assert.equal(selecting.attachment, null);
  assert.equal(pendingDialogs({ ...ready, connected: false, session: queued }).attachment, null);
});

test("a question's typed reply outlasts its component while the question stays open", () => {
  const replies = createQuestionReplies();
  let state: AppState = ready;
  const listeners = new Set<() => void>();
  const show = (next: AppState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const stop = replies.follow({
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  const asked = dialog("d1", { prefill: "draft" });
  const queued = session([asked]);
  show({ ...ready, session: queued });
  const key = pendingDialogs(state).session;
  assert.equal(replies.get(key, asked), "draft", "an untouched question starts from its prefill");
  replies.set(key, asked, "a half-typed paragraph");
  // A resync and another session's view both hide the question; neither ends it.
  show({ ...ready, resync: true, session: queued });
  show({ ...ready, session: { ...session([]), sessionId: "s2" } });
  show({ ...ready, session: queued });
  assert.equal(replies.get(key, asked), "a half-typed paragraph");
  assert.equal(
    replies.get(key, { ...asked, generation: "g2" }),
    "draft",
    "a restarted Pi's question starts from its own prefill",
  );
  const choice = dialog("d2", { method: "select", options: ["a", "b"] });
  assert.equal(replies.get(key, choice), "", "a choice starts unselected");
  replies.set(key, choice, "2");
  show({ ...ready, session: session([asked, choice]) });
  assert.equal(replies.get(key, choice), "2");
  // Answered, cancelled or timed out: the question leaves the queue and its reply goes with it.
  show({ ...ready, session: session([choice]) });
  assert.equal(replies.get(key, asked), "draft");
  stop();
  show({ ...ready, session: session([]) });
  assert.equal(replies.get(key, choice), "2", "a stopped follower drops nothing");
});
