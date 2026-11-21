import type { Snapshot } from "@shared/wire";
import type { CreationVerdict } from "../../../../shared/session/creationVerdict.ts";
import type { PendingCreate } from "../../../../web/src/shared/state/state.ts";
import { submissionPhase } from "../composer/submissionReceipt.ts";

export const started = (
  attemptId: string,
  cwd: string,
  message: Pick<PendingCreate, "text" | "attachments">,
): PendingCreate => ({ attemptId, cwd, ...message, outcome: "starting" });

export const connectionLost = (input: PendingCreate | null): PendingCreate | null =>
  input?.outcome === "starting"
    ? { ...input, outcome: "uncertain", detail: "Connection lost before delivery was confirmed." }
    : input;

export const rejected = (input: PendingCreate, detail: string): PendingCreate => ({
  ...input,
  outcome: "rejected",
  detail,
});

export const failed = (input: PendingCreate, verdict: CreationVerdict): PendingCreate => ({
  ...input,
  outcome: verdict.kind === "created_not_sent" ? "not_sent" : "uncertain",
  detail: verdict.detail,
});

export function reconcile(
  input: PendingCreate | null,
  session: Snapshot | null,
): PendingCreate | null {
  if (!input || !session) return input;
  if (session.messages.some((m) => m.role === "user") || session.pending?.role === "user")
    return null;
  const submission = session.state.submission;
  if (submission) {
    if (input.submissionId !== undefined && submission.id > input.submissionId) return null;
    if (input.submissionId === undefined) input = { ...input, submissionId: submission.id };
  }
  const phase = submission ? submissionPhase(submission.outcome) : undefined;
  if (phase === "submitted") return { ...input, outcome: phase, detail: undefined };
  if (phase && phase !== "submitting")
    return { ...input, outcome: phase, detail: submission?.detail };
  if (session.state.closure && input.outcome !== "submitted" && input.outcome !== "not_sent")
    return { ...input, outcome: "uncertain", detail: session.state.closure.detail };
  return input;
}
