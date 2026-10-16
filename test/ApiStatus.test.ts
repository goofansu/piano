import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveStatus } from "../server/ApiStatus.ts";
import type { Dialog, SessionState } from "../shared/wire.ts";

const dialog: Dialog = {
  id: "d",
  generation: "g",
  receivedAt: 0,
  deadlineAt: 1,
  deadlineKind: "host-recovery",
  method: "input",
  title: "Choose",
};
const cases: Array<[string, Partial<SessionState>, Dialog[], boolean, string, string | null]> = [
  ["idle", {}, [], true, "idle", null],
  [
    "history",
    { closure: { _tag: "released", detail: "released" }, isStreaming: true },
    [],
    false,
    "idle",
    null,
  ],
  ...(["exited", "failed", "released_during_work"] as const).map((tag): (typeof cases)[number] => [
    tag,
    {
      closure:
        tag === "exited"
          ? { _tag: tag, code: 1, detail: "closed" }
          : { _tag: tag, detail: "closed" },
      isStreaming: true,
    },
    [dialog],
    false,
    "error",
    "closed",
  ]),
  [
    "projection",
    { projectionError: "bad projection", isStreaming: true },
    [dialog],
    true,
    "error",
    "bad projection",
  ],
  [
    "rejected",
    { submission: { id: 1, outcome: "rejected", detail: "no" } },
    [dialog],
    true,
    "error",
    "no",
  ],
  ["dialog", { isStreaming: true }, [dialog], true, "waiting", "Choose"],
  [
    "dialog message",
    {},
    [{ ...dialog, title: undefined, message: "Answer" }],
    true,
    "waiting",
    "Answer",
  ],
  ...(["isStreaming", "isCompacting", "isRetrying", "isStopping"] as const).map(
    (flag): (typeof cases)[number] => [flag, { [flag]: true }, [], true, "running", null],
  ),
  ["queue", { queuedMessages: [{ kind: "steering", text: "next" }] }, [], true, "running", null],
  ...(["submitting", "started", "queued"] as const).map((outcome): (typeof cases)[number] => [
    outcome,
    { submission: { id: 1, outcome } },
    [],
    true,
    "running",
    null,
  ]),
  ["nonquiescent", { isQuiescent: false }, [], true, "running", null],
  ["handled", { submission: { id: 1, outcome: "handled" } }, [], true, "idle", null],
];
for (const [name, state, dialogs, hosted, status, detail] of cases)
  test(`API status: ${name}`, () =>
    assert.deepEqual(
      deriveStatus({ sessionId: "s", isStreaming: false, ...state }, dialogs, hosted),
      { status, detail },
    ));
