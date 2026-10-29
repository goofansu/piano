/**
 * The selected session's notices, decided once: the banners above the transcript, the status
 * lines below it, the extension block and the read-only notice that replaces the composer.
 * The session view renders these descriptors in order; which ones appear, and in what words,
 * lives here so it can be checked without a browser.
 */
// Relative, not @shared: module tests load this file directly in Node.
import { closureNeedsAttention } from "../../../shared/sessionStatus.ts";
import type { ClientCommand, ExtensionState } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";
import { sessionContext } from "./sessionContext.ts";
import { submissionReceipt } from "./submissionReceipt.ts";

/** Where a notice sits: above the transcript, below it, or in place of the composer. */
export type SessionNoticePlacement = "banner" | "status" | "composer";

/** `quiet` is secondary text; the rest name the alert or text variant. */
export type SessionNoticeTone = "destructive" | "warning" | "quiet" | "neutral";

export type SessionNoticeId =
  | "selection-rejected"
  | "git-unavailable"
  | "closure"
  | "projection-error"
  | "refresh-error"
  | "dialog-resolution"
  | "submission"
  | "extension"
  | "checkout-missing";

export interface SessionNotice {
  id: SessionNoticeId;
  placement: SessionNoticePlacement;
  tone: SessionNoticeTone;
  title: string;
  /** Supporting lines: folded under a banner, shown beneath a status line. */
  details: string[];
  /** A command the notice offers beside its title. */
  action?: { label: string; command: ClientCommand };
  /** Only the extension block: what Pi's extensions report, rendered as their own lines. */
  extension?: ExtensionState;
}

const notice = (
  id: SessionNoticeId,
  placement: SessionNoticePlacement,
  tone: SessionNoticeTone,
  title: string,
  details: (string | undefined)[] = [],
  rest: Partial<SessionNotice> = {},
): SessionNotice => ({
  id,
  placement,
  tone,
  title,
  details: details.filter((d): d is string => !!d),
  ...rest,
});

/** The selected session's notices, in display order. No notice depends on Messages only today;
 * callers pass it so one that does need not change them. */
export function sessionNotices(state: AppState, _messagesOnly: boolean): SessionNotice[] {
  const t = state.session;
  const { folder, checkoutMissing } = sessionContext(state);
  const receipt = submissionReceipt(state);
  const notices: SessionNotice[] = [];

  const failure = state.selectionFailure;
  if (failure)
    notices.push(
      notice(
        "selection-rejected",
        "banner",
        "destructive",
        "Unable to open session.",
        [failure.message],
        failure.sessionId
          ? {
              action: {
                label: "Retry",
                command: { _tag: "select", cwd: failure.cwd, sessionId: failure.sessionId },
              },
            }
          : {},
      ),
    );

  if (t && folder?.discovery.status === "error") {
    notices.push(
      notice(
        "git-unavailable",
        "banner",
        "destructive",
        "Git status unavailable.",
        [folder.discovery.detail],
        { action: { label: "Refresh", command: { _tag: "registry" } } },
      ),
    );
  }
  if (t && closureNeedsAttention(t.state.closure)) {
    notices.push(
      notice("closure", "banner", "destructive", `Pi stopped: ${t.state.closure.detail}.`, [
        "Interrupted operations are not resumed. Inspect the checkout before continuing.",
      ]),
    );
  }
  if (t?.state.projectionError) {
    notices.push(
      notice(
        "projection-error",
        "banner",
        "warning",
        "Unable to refresh the conversation. Recent changes may be missing.",
        [t.state.projectionError],
      ),
    );
  }
  if (t?.state.stateRefreshError || t?.state.statsRefreshError) {
    notices.push(
      notice(
        "refresh-error",
        "banner",
        "warning",
        "Unable to refresh session details. Some information may be stale.",
        [t.state.stateRefreshError, t.state.statsRefreshError],
      ),
    );
  }

  const resolution = t?.state.dialogResolution;
  // The answer card owns its receipt and delivery details; never repeat them as a status line.
  if (resolution && !resolution.answer) {
    const cancelled = resolution.reason === "cancelled" && resolution.delivery === "written";
    notices.push(
      notice(
        "dialog-resolution",
        "status",
        cancelled ? "warning" : "quiet",
        cancelled ? "Question cancelled" : `Dialog ${resolution.reason}: ${resolution.detail}`,
      ),
    );
  }
  if (receipt?.text)
    notices.push(notice("submission", "status", receipt.tone, receipt.text, [receipt.detail]));
  const extension = t?.state.extension;
  // Pi reports an extension block for every session; only one that says something is shown.
  if (
    extension &&
    (extension.title ||
      extension.statuses.length ||
      extension.widgets.length ||
      extension.editorRequest)
  ) {
    notices.push(notice("extension", "status", "quiet", "Extension state", [], { extension }));
  }

  if (checkoutMissing) {
    notices.push(
      notice("checkout-missing", "composer", "neutral", "Checkout removed · Read-only session", [
        "History is still available. You can archive or delete this session, or restore the checkout at its original path to continue.",
      ]),
    );
  }
  return notices;
}
