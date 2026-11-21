import { closureNeedsAttention } from "../../../shared/session/sessionStatus.ts";
import type { ClientCommand, ExtensionState } from "../../../shared/wire.ts";
import { answerReceipt } from "../../../web/src/shared/state/dialogAnswer.ts";
import { sessionContext, sessionInputMode } from "../../../web/src/shared/state/sessionContext.ts";
import type { AppState } from "../../../web/src/shared/state/state.ts";
import { submissionReceipt } from "./composer/submissionReceipt.ts";

export type SessionNoticePlacement = "banner" | "status" | "composer";

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
  | "archived"
  | "checkout-missing";

export interface SessionNotice {
  id: SessionNoticeId;
  placement: SessionNoticePlacement;
  tone: SessionNoticeTone;
  title: string;
  details: string[];
  action?: { label: string; command: ClientCommand };
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

export function sessionNotices(state: AppState, _messagesOnly: boolean): SessionNotice[] {
  const t = state.session;
  const { folder } = sessionContext(state);
  const mode = sessionInputMode(state);
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
  const answerNotice = resolution && answerReceipt(resolution).notice;
  if (answerNotice)
    notices.push(notice("dialog-resolution", "status", answerNotice.tone, answerNotice.title));
  if (receipt?.text) {
    const pending = state.pendingCreate;
    const reconcile = pending?.outcome === "uncertain" && !t?.sessionId;
    notices.push(
      notice(
        "submission",
        reconcile ? "banner" : "status",
        receipt.tone,
        receipt.text,
        [receipt.detail],
        reconcile
          ? {
              action: {
                label: "Check start",
                command: {
                  _tag: "select",
                  cwd: pending.cwd,
                  sessionId: null,
                  attemptId: pending.attemptId,
                },
              },
            }
          : {},
      ),
    );
  }
  const extension = t?.state.extension;
  if (
    extension &&
    (extension.title ||
      extension.statuses.length ||
      extension.widgets.length ||
      extension.editorRequest)
  ) {
    notices.push(notice("extension", "status", "quiet", "Extension state", [], { extension }));
  }

  if (mode === "archived") {
    notices.push(
      notice("archived", "composer", "neutral", "Archived · Read-only session", [
        "History is still available. Unarchive it in Settings → Data controls to continue.",
      ]),
    );
  }
  if (mode === "checkout-missing") {
    notices.push(
      notice("checkout-missing", "composer", "neutral", "Checkout removed · Read-only session", [
        "History is still available. You can archive or delete this session, or restore the checkout at its original path to continue.",
      ]),
    );
  }
  return notices;
}
