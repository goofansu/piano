/**
 * How Pi's turn ended, read from the stop reason on its last assistant message. The server
 * announces `response_completed` from it and the dispatch wait judges a child's turn from it, so
 * both ask here rather than spelling Pi's words themselves.
 *
 * - `completed`: the model ended the turn of its own accord. Pi's `length` counts: the reply was
 *   cut off at the token limit, but nothing failed or interrupted it, Pi's own `done` event lists
 *   it beside `stop`, and the turn is over with output for the user to read. So a truncated reply
 *   is announced as a finished response and a dispatch wait calls it settled, never a judgement of
 *   the work's quality.
 * - `cancelled`: the turn was interrupted (`aborted`).
 * - `failed`: the turn ended in an error (`error`).
 * - `other`: no ending is proven: the turn continues (`toolUse`, `pending`, `deferred`), there is
 *   no stop reason, or a word outside Pi's StopReason vocabulary.
 */
export type TurnEnding = "completed" | "cancelled" | "failed" | "other";

export const turnEnding = (stopReason: string | undefined): TurnEnding => {
  switch (stopReason) {
    case "stop":
    case "length":
      return "completed";
    case "aborted":
      return "cancelled";
    case "error":
      return "failed";
    default:
      return "other";
  }
};
