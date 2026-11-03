/**
 * Whether an input was sent, read from one server frame. Piano says so over two channels: an
 * `error` naming the input (refused before Pi saw it, with no receipt published) and the
 * session's submission receipt (Pi's verdict, or `not_sent` when Pi refused before seeing it).
 * Every reader of that question (the browser's drafts, the dispatch tools) reads it here, so a new
 * "not sent" path reaches them all.
 */

import type { PromptSubmission, ServerMessage } from "./wire.ts";

/** A decided input: `not_sent` means it never reached Pi, so its sender may send it again; any
 * other outcome is Pi's verdict on an input it holds or held. */
export interface InputVerdict {
  readonly outcome: Exclude<PromptSubmission["outcome"], "submitting">;
  readonly detail: string | undefined;
}

/** A submission's verdict, or `undefined` while it is still `submitting` (or there is none). */
export const submissionVerdict = (
  submission: PromptSubmission | undefined,
): InputVerdict | undefined =>
  submission && submission.outcome !== "submitting"
    ? { outcome: submission.outcome, detail: submission.detail }
    : undefined;

/** The submission a frame carries: a selection's snapshot, or a session's receipt, state or
 * snapshot. */
const submissionOf = (frame: ServerMessage): PromptSubmission | undefined => {
  if (frame._tag === "selected") return frame.snapshot.state.submission;
  if (frame._tag !== "session") return undefined;
  const event = frame.event;
  if (event._tag === "submission") return event.submission;
  if (event._tag === "state") return event.state.submission;
  if (event._tag === "snapshot") return event.snapshot.state.submission;
  return undefined;
};

/**
 * The verdict one frame gives on the input it names, or `undefined` when it names none or the
 * input is still undecided. An `error` without an `inputId` decides nothing: it may precede Pi's
 * own verdict, so its readers wait for that.
 */
export const inputVerdictOf = (
  frame: ServerMessage,
): (InputVerdict & { readonly inputId: string }) | undefined => {
  if (frame._tag === "error")
    return frame.inputId === undefined
      ? undefined
      : { inputId: frame.inputId, outcome: "not_sent", detail: frame.message };
  const submission = submissionOf(frame);
  const verdict = submissionVerdict(submission);
  return verdict && submission?.inputId !== undefined
    ? { inputId: submission.inputId, ...verdict }
    : undefined;
};
