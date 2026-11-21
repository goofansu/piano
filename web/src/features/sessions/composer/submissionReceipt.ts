import type { PromptSubmission } from "@shared/wire";
import type { AppState } from "../../../app/store.ts";

export type SubmissionPhase =
  | "starting"
  | "submitting"
  | "submitted"
  | "handled"
  | "rejected"
  | "not_sent"
  | "uncertain";

export interface SubmissionReceipt {
  source: "browser" | "pi";
  phase: SubmissionPhase;
  tone: "warning" | "quiet";
  text: string | undefined;
  detail: string | undefined;
}

const PI_PHASE = {
  submitting: "submitting",
  started: "submitted",
  queued: "submitted",
  handled: "handled",
  rejected: "rejected",
  not_sent: "not_sent",
  uncertain: "uncertain",
} as const satisfies Record<PromptSubmission["outcome"], SubmissionPhase>;

export const submissionPhase = (outcome: PromptSubmission["outcome"]) => PI_PHASE[outcome];

const text = (phase: SubmissionPhase, source: SubmissionReceipt["source"]): string | undefined => {
  switch (phase) {
    case "starting":
    case "submitted":
      return undefined;
    case "submitting":
      return "Submitting — waiting for Pi.";
    case "handled":
      return "Command handled.";
    case "rejected":
      return "Message rejected.";
    case "not_sent":
      return "Not sent.";
    case "uncertain":
      return `Delivery uncertain — inspect the ${source === "browser" ? "session list" : "session and queue"} before deciding whether to send again. Piano will not resend automatically.`;
  }
};

const receipt = (
  source: SubmissionReceipt["source"],
  phase: SubmissionPhase,
  detail: string | undefined,
): SubmissionReceipt => ({
  source,
  phase,
  tone: phase === "rejected" || phase === "not_sent" || phase === "uncertain" ? "warning" : "quiet",
  text: text(phase, source),
  detail,
});

export function submissionReceipt(state: AppState): SubmissionReceipt | undefined {
  const input = state.pendingCreate;
  const submission = state.session?.state.submission;
  if (input) return receipt("browser", input.outcome, input.detail ?? submission?.detail);
  return submission
    ? receipt("pi", submissionPhase(submission.outcome), submission.detail)
    : undefined;
}
