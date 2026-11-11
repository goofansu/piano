import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CreationContext,
  type CreationResultFrame,
  creationVerdictOf,
} from "../shared/creationVerdict.ts";

const creating: CreationContext = { attemptId: "attempt", sessionNamed: false };
const named: CreationContext = { ...creating, sessionNamed: true };

const rejected = (inputId?: string, selectionId = "sel"): CreationResultFrame => ({
  _tag: "selection_rejected",
  selectionId,
  ...(inputId === undefined ? {} : { inputId }),
  message: "No",
});
const error = (inputId?: string): CreationResultFrame => ({
  _tag: "error",
  selectionId: "sel",
  ...(inputId === undefined ? {} : { inputId, cwd: "/r", sessionId: "s" }),
  message: "No",
});

test("a creation's result frame reads as one verdict", () => {
  const cases: Array<[string, CreationResultFrame, CreationContext, string]> = [
    ["a rejection naming the attempt's input", rejected("attempt"), creating, "refused"],
    ["a rejection naming its selection", rejected(undefined, "attempt"), creating, "refused"],
    // A read-back's capacity or a peer's scope refuses the read, not the creation.
    ["a rejection naming nothing", rejected(), creating, "uncertain"],
    ["a rejection after the session was named", rejected("attempt"), named, "created_uncertain"],
    ["an error naming the input", error("attempt"), creating, "created_not_sent"],
    ["an error naming another input", error("other"), named, "created_uncertain"],
    ["an error before the session was named", error(), creating, "uncertain"],
    ["an error after it", error(), named, "created_uncertain"],
    [
      "a failed attachment",
      { _tag: "selection_failed", selectionId: "sel", message: "No" },
      creating,
      "uncertain",
    ],
  ];
  for (const [what, frame, context, expected] of cases) {
    const verdict = creationVerdictOf(frame, context);
    assert.equal(verdict.detail, "No", what);
    assert.equal(verdict.kind, expected, what);
  }
});
