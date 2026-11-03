/**
 * The browser's record of a session's first message, from the moment it is sent until Pi's own
 * submission supersedes it. It covers failures Pi never sees (a rejected selection, a lost
 * connection) and is never part of Pi's transcript or the registry (INV-01). The store decides
 * when each transition applies; this module decides what each one does to the record.
 */
import type { RenderMsg, Snapshot } from "@shared/wire";
import { type SubmissionPhase, submissionPhase } from "./submissionReceipt.ts";

/** Browser-only submitted input, never part of Pi's transcript or registry. */
export interface PendingCreate {
  /** The creation request, not a later attachment to the same session. */
  selectionId: string;
  cwd: string;
  text: string;
  attachments?: RenderMsg["attachments"];
  /** Every phase but `submitting`: until Pi answers, the record still reads `starting`. */
  outcome: Exclude<SubmissionPhase, "submitting">;
  /** First observed Pi submission; later input supersedes this local receipt. */
  submissionId?: number;
  detail?: string;
}

/** The first message, sent with the selection that starts its session. */
export const started = (
  selectionId: string,
  cwd: string,
  message: Pick<PendingCreate, "text" | "attachments">,
): PendingCreate => ({ selectionId, cwd, ...message, outcome: "starting" });

/** A socket that closes before delivery is confirmed leaves the first message's fate unknown. */
export const connectionLost = (input: PendingCreate | null): PendingCreate | null =>
  input?.outcome === "starting"
    ? { ...input, outcome: "uncertain", detail: "Connection lost before delivery was confirmed." }
    : input;

/** The server refused the selection that carried the first message. */
export const rejected = (
  input: PendingCreate | null,
  selectionId: string,
  detail: string,
): PendingCreate | null =>
  input?.selectionId === selectionId ? { ...input, outcome: "rejected", detail } : input;

/** An error on the first message's selection: it may or may not have reached Pi. */
export const failed = (input: PendingCreate, detail: string): PendingCreate => ({
  ...input,
  outcome: "uncertain",
  detail,
});

/**
 * Folds the session's latest snapshot into the record. Returns the record itself when nothing
 * changed, and null once Pi's transcript or a later submission supersedes it.
 */
export function reconcile(
  input: PendingCreate | null,
  session: Snapshot | null,
): PendingCreate | null {
  if (!input || !session) return input;
  // Pi may expand slash commands, so reconcile by the new session's first user
  // message, not text equality. Never insert the local input into history.
  if (session.messages.some((m) => m.role === "user") || session.pending?.role === "user")
    return null;
  const submission = session.state.submission;
  if (submission) {
    if (input.submissionId !== undefined && submission.id > input.submissionId) return null;
    if (input.submissionId === undefined) input = { ...input, submissionId: submission.id };
  }
  // Pi's verdict reads as its receipt does; `submitting` decides nothing yet.
  const phase = submission ? submissionPhase(submission.outcome) : undefined;
  if (phase === "submitted") return { ...input, outcome: phase, detail: undefined };
  if (phase && phase !== "submitting")
    return { ...input, outcome: phase, detail: submission?.detail };
  if (session.state.closure && input.outcome !== "submitted")
    return { ...input, outcome: "uncertain", detail: session.state.closure.detail };
  return input;
}
