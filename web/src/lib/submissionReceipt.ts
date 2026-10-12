/**
 * What happened to the last thing sent in the selected session, decided once. The browser keeps
 * its own record of a first message (`pendingCreate`) from the moment it is sent, including
 * failures Pi never sees: a rejected selection or a lost connection. That record speaks until
 * Pi's own submission supersedes it, after which Pi's submission is the receipt. Status, the
 * reply indicator and the status line all read phase, tone and words from here.
 */
import type { AppState } from "../store.ts";

/**
 * `starting`: the first message is on its way with a new session. `submitting`: Pi has it but has
 * not answered. `submitted`: Pi started or queued it. The rest are Pi's, or the browser's, verdicts.
 */
export type SubmissionPhase =
  | "starting"
  | "submitting"
  | "submitted"
  | "handled"
  | "rejected"
  | "uncertain";

export interface SubmissionReceipt {
  /** Whose record this is: the browser's first message, or Pi's last submission. */
  source: "browser" | "pi";
  phase: SubmissionPhase;
  /** A failed or uncertain delivery needs the person; everything else is secondary. */
  tone: "warning" | "quiet";
  /** The line to show, when the phase needs words the running state does not already say. */
  text: string | undefined;
  detail: string | undefined;
}

const PI_PHASE = {
  submitting: "submitting",
  started: "submitted",
  queued: "submitted",
  handled: "handled",
  rejected: "rejected",
  uncertain: "uncertain",
} as const satisfies Record<string, SubmissionPhase>;

const text = (phase: SubmissionPhase, source: SubmissionReceipt["source"]): string | undefined => {
  switch (phase) {
    case "starting": // The reply area's Piano keys provide startup feedback.
    case "submitted": // Running/ready state describes the work; the queue shows queued input.
      return undefined;
    case "submitting":
      return "Submitting — waiting for Pi.";
    case "handled":
      return "Command handled.";
    case "rejected":
      return "Message rejected.";
    case "uncertain":
      // Before Pi answered, the session itself may not exist; after, the input may sit in its queue.
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
  tone: phase === "rejected" || phase === "uncertain" ? "warning" : "quiet",
  text: text(phase, source),
  detail,
});

/** The selected session's receipt for its last input, if it has one. */
export function submissionReceipt(state: AppState): SubmissionReceipt | undefined {
  const input = state.pendingCreate;
  const submission = state.session?.state.submission;
  if (input) return receipt("browser", input.outcome, input.detail ?? submission?.detail);
  return submission ? receipt("pi", PI_PHASE[submission.outcome], submission.detail) : undefined;
}
