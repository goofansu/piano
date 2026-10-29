import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientCommand, Dialog, DialogResolution, SessionState } from "../shared/wire.ts";
import {
  type AnswerReceipt,
  type AnswerTone,
  answeredQuestion,
  answerReceipt,
  createDialogAnswer,
  pendingDialogs,
} from "../web/src/lib/piDialogs.ts";
import { type AppState, initialState, type SessionView } from "../web/src/store.ts";

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
  return { sent, dialogAnswer: createDialogAnswer({ dialog: d, send: (c) => sent.push(c) }) };
}

test("a dialog is answered at most once, with its id and generation", () => {
  const { sent, dialogAnswer } = answering();
  assert.equal(dialogAnswer.answer({ value: "first" }, 1_000, true), true);
  assert.equal(dialogAnswer.answer({ value: "second" }, 1_000, true), false);
  assert.equal(dialogAnswer.cancel(1_000, true), false);
  assert.deepEqual(sent, [
    { _tag: "act", action: { _tag: "answer", id: "d1", generation: "g1", value: "first" } },
  ]);
  assert.equal(dialogAnswer.view(1_000, true).submitted, true);
  assert.equal(dialogAnswer.view(1_000, true).disabled, true);
});

test("an answer at or after the deadline sends nothing", () => {
  const { sent, dialogAnswer } = answering();
  assert.equal(dialogAnswer.view(DEADLINE, true).disabled, true);
  assert.equal(dialogAnswer.answer({ value: "late" }, DEADLINE, true), false);
  assert.equal(dialogAnswer.answer({ value: "later" }, DEADLINE + 1, true), false);
  assert.deepEqual(sent, []);
  assert.equal(dialogAnswer.view(DEADLINE, true).submitted, false);
});

test("a question its tool call owns has no answer deadline but still requires a connection", () => {
  const { dialogAnswer } = answering(
    dialog("owned", { toolCallId: "call-1", deadlineAt: null, deadlineKind: "tool-end" }),
  );
  const later = 24 * 60 * 60_000;
  assert.equal(dialogAnswer.view(later, true).deadline, null);
  assert.equal(dialogAnswer.view(later, true).disabled, false);
  assert.equal(dialogAnswer.answer({ value: "kept" }, later, false), false);
  assert.equal(dialogAnswer.answer({ value: "kept" }, later, true), true);
});

test("a disconnected answer sends nothing and leaves the dialog answerable", () => {
  const { sent, dialogAnswer } = answering();
  assert.equal(dialogAnswer.answer({ confirmed: true }, 1_000, false), false);
  assert.deepEqual(sent, []);
  assert.deepEqual(dialogAnswer.view(1_000, false), {
    submitted: false,
    disabled: true,
    abortDisabled: true,
    title: "Pi needs an answer",
    deadline: { label: "Estimated Pi timeout", remainingSeconds: 9, at: DEADLINE },
    waiting: "Sending response…",
  });
  assert.equal(
    dialogAnswer.answer({ confirmed: true }, 1_000, true),
    true,
    "answerable on reconnect",
  );
});

test("closing a dialog cancels it", () => {
  const { sent, dialogAnswer } = answering();
  assert.equal(dialogAnswer.cancel(1_000, true), true);
  assert.deepEqual(sent, [
    { _tag: "act", action: { _tag: "answer", id: "d1", generation: "g1", cancelled: true } },
  ]);
});

test("abort is sent once and stays available after the deadline", () => {
  const { sent, dialogAnswer } = answering();
  const late = dialogAnswer.view(DEADLINE + 5_000, true);
  assert.equal(late.disabled, true);
  assert.equal(late.abortDisabled, false, "abort ignores the deadline");
  assert.equal(dialogAnswer.abort(DEADLINE + 5_000, false), false, "not while disconnected");
  assert.equal(dialogAnswer.abort(DEADLINE + 5_000, true), true);
  assert.equal(dialogAnswer.abort(DEADLINE + 5_000, true), false);
  assert.equal(dialogAnswer.answer({ value: "x" }, 1_000, true), false, "abort ends answering");
  assert.deepEqual(sent, [{ _tag: "act", action: { _tag: "abort" } }]);
  assert.equal(dialogAnswer.view(1_000, true).abortDisabled, true);
});

test("subscribers hear the dialog become submitted", () => {
  const { dialogAnswer } = answering();
  let heard = 0;
  const stop = dialogAnswer.subscribe(() => heard++);
  dialogAnswer.answer({ value: "x" }, 1_000, true);
  stop();
  assert.equal(heard, 1);
  assert.equal(dialogAnswer.getState(), true);
});

test("remaining seconds round up and stop at zero", () => {
  const { dialogAnswer } = answering();
  const remaining = (now: number) => dialogAnswer.view(now, true).deadline?.remainingSeconds;
  assert.equal(remaining(0), 10);
  assert.equal(remaining(1), 10);
  assert.equal(remaining(DEADLINE - 1), 1);
  assert.equal(remaining(DEADLINE), 0);
  assert.equal(remaining(DEADLINE + 3_000), 0);
});

test("a dialog reads the same on every surface: title, deadline and what it waits for", () => {
  const view = (extra: Partial<Dialog>) =>
    answering(dialog("d1", extra)).dialogAnswer.view(1_000, true);
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
  assert.equal(
    view({ method: "confirm" }).waiting,
    "Waiting for the host’s resolution. Do not resend on reconnect.",
  );
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
    assert.deepEqual(receipt.notice, { tone: "warning", title: "Question cancelled" }, delivery);
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
  assert.equal(pending.connected, true);
  assert.deepEqual(pendingDialogs(ready), {
    head: undefined,
    surface: null,
    more: 0,
    connected: true,
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
    connected: false,
  });
  const selecting = pendingDialogs({
    ...ready,
    session: queued,
    selecting: { cwd: "/repo", sessionId: "s1" },
  });
  assert.equal(selecting.head?.id, "d1");
  assert.equal(selecting.connected, false);
  assert.equal(pendingDialogs({ ...ready, connected: false, session: queued }).connected, false);
});
