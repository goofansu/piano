/**
 * The selected session's notices, decided once: the banners above the transcript, the status
 * lines below it, the extension block and the read-only notice that replaces the composer.
 * The session view renders these descriptors in order; which ones appear, and in what words,
 * lives here so it can be checked without a browser.
 */
// Relative, not @shared: module tests load this file directly in Node.
import type { ClientCommand, ExtensionState } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";
import type { SessionDisplay } from "./sessionCommands.ts";
import { closureNeedsAttention, sessionActivity, sessionContext } from "./sessionContext.ts";

/** Where a notice sits: above the transcript, below it, or in place of the composer. */
export type SessionNoticePlacement = "banner" | "status" | "composer";

/** `quiet` is secondary text; the rest name the alert or text variant. */
export type SessionNoticeTone = "destructive" | "warning" | "quiet" | "neutral";

export type SessionNoticeId =
  | "git-unavailable" | "closure" | "projection-error" | "refresh-error"
  | "dialog-resolution" | "submission" | "extension" | "checkout-missing";

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

const notice = (id: SessionNoticeId, placement: SessionNoticePlacement, tone: SessionNoticeTone, title: string, details: (string | undefined)[] = [], rest: Partial<SessionNotice> = {}): SessionNotice =>
  ({ id, placement, tone, title, details: details.filter((d): d is string => !!d), ...rest });

/** The selected session's notices, in display order. `display` is the transcript display. */
export function sessionNotices(state: AppState, display: SessionDisplay): SessionNotice[] {
  const t = state.session;
  const input = state.pendingCreate;
  const { folder, checkoutMissing } = sessionContext(state);
  const { submissionText } = sessionActivity(state, display);
  const notices: SessionNotice[] = [];

  if (t && folder?.discovery.status === "error") {
    notices.push(notice("git-unavailable", "banner", "destructive", "Git status unavailable.", [folder.discovery.detail],
      { action: { label: "Refresh", command: { _tag: "registry" } } }));
  }
  if (t && closureNeedsAttention(t.state.closure)) {
    notices.push(notice("closure", "banner", "destructive", `Pi stopped: ${t.state.closure.detail}.`,
      ["Interrupted operations are not resumed. Inspect the checkout before continuing."]));
  }
  if (t?.state.projectionError) {
    notices.push(notice("projection-error", "banner", "warning", "Unable to refresh the conversation. Recent changes may be missing.", [t.state.projectionError]));
  }
  if (t?.state.stateRefreshError || t?.state.statsRefreshError) {
    notices.push(notice("refresh-error", "banner", "warning", "Unable to refresh session details. Some information may be stale.",
      [t.state.stateRefreshError, t.state.statsRefreshError]));
  }

  const resolution = t?.state.dialogResolution;
  if (resolution) notices.push(notice("dialog-resolution", "status", "quiet", `Dialog ${resolution.reason}: ${resolution.detail}`));
  if (submissionText) {
    const submission = t?.state.submission;
    // Browser-held input describes the first message until Pi's own submission supersedes it.
    notices.push(notice("submission", "status", submission?.outcome === "uncertain" || submission?.outcome === "rejected" ? "warning" : "quiet",
      submissionText, [input?.detail ?? submission?.detail]));
  }
  const extension = t?.state.extension;
  // Pi reports an extension block for every session; only one that says something is shown.
  if (extension && (extension.title || extension.statuses.length || extension.widgets.length || extension.editorRequest)) {
    notices.push(notice("extension", "status", "quiet", "Extension state", [], { extension }));
  }

  if (checkoutMissing) {
    notices.push(notice("checkout-missing", "composer", "neutral", "Checkout removed · Read-only session",
      ["History is still available. You can archive or delete this session, or restore the checkout at its original path and reload to continue."]));
  }
  return notices;
}
