import type { PromptSubmission, ServerMessage } from "../wire.ts";

export interface InputVerdict {
  readonly outcome: Exclude<PromptSubmission["outcome"], "submitting">;
  readonly detail: string | undefined;
}

export const submissionVerdict = (
  submission: PromptSubmission | undefined,
): InputVerdict | undefined =>
  submission && submission.outcome !== "submitting"
    ? { outcome: submission.outcome, detail: submission.detail }
    : undefined;

const submissionOf = (frame: ServerMessage): PromptSubmission | undefined => {
  if (frame._tag === "selected") return frame.snapshot.state.submission;
  if (frame._tag !== "session") return undefined;
  const event = frame.event;
  if (event._tag === "submission") return event.submission;
  if (event._tag === "state") return event.state.submission;
  if (event._tag === "snapshot") return event.snapshot.state.submission;
  return undefined;
};

export const inputVerdictOf = (
  frame: ServerMessage,
): (InputVerdict & { readonly inputId: string }) | undefined => {
  if (frame._tag === "error" || frame._tag === "selection_rejected")
    return frame.inputId === undefined
      ? undefined
      : { inputId: frame.inputId, outcome: "not_sent", detail: frame.message };
  const submission = submissionOf(frame);
  const verdict = submissionVerdict(submission);
  return verdict && submission?.inputId !== undefined
    ? { inputId: submission.inputId, ...verdict }
    : undefined;
};
