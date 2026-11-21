import { isWorking } from "../../../shared/session/sessionProjection.ts";
import { workUnderWay } from "../../../shared/session/sessionStatus.ts";
import {
  type SessionContext,
  sessionReady,
  sessionInputMode,
} from "../../../web/src/shared/state/sessionContext.ts";
import type { AppState } from "../../../web/src/shared/state/state.ts";
import { submissionReceipt } from "./composer/submissionReceipt.ts";
export interface SessionPlace {
  name: string;
  repository: boolean;
  ref: { kind: "branch" | "commit"; name: string } | undefined;
}

export function sessionPlace({
  folderName,
  githubRepo,
  branch,
  detachedHead,
}: Pick<SessionContext, "folderName" | "githubRepo" | "branch" | "detachedHead">):
  | SessionPlace
  | undefined {
  if (folderName === undefined) return undefined;
  return {
    name: githubRepo ?? folderName,
    repository: githubRepo !== undefined,
    ref: detachedHead
      ? { kind: "commit", name: detachedHead.slice(0, 10) }
      : branch
        ? { kind: "branch", name: branch }
        : undefined,
  };
}

export type ReplyActivity = "starting" | "working";

export interface SessionActivity {
  status: string;
  replyActivity: ReplyActivity | undefined;
}

export function sessionActivity(state: AppState, messagesOnly: boolean): SessionActivity {
  const t = state.session;
  const mode = sessionInputMode(state);
  const receipt = submissionReceipt(state);
  const streaming = !!t && isWorking(t.state);
  const working = !!t && workUnderWay(t.state);
  const activity = [
    t?.dialogs.length ? "Waiting for input" : null,
    t?.state.isCompacting ? "Compacting" : null,
    t?.state.isRetrying ? "Retrying" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const starting = receipt?.phase === "starting";
  let replyActivity: ReplyActivity | undefined;
  if (messagesOnly || !t?.pending?.text) {
    if (starting) replyActivity = "starting";
    else if (streaming) replyActivity = "working";
  }
  const status =
    starting && !t?.dialogs.length
      ? "Starting"
      : !t && receipt
        ? receipt.phase === "rejected"
          ? "Message rejected"
          : receipt.phase === "not_sent"
            ? "Not sent"
            : "Delivery uncertain"
        : !state.connected || (t !== null && !sessionReady(state))
          ? "Reconnecting"
          : !t
            ? "Loading"
            : mode === "archived"
              ? "Archived"
              : mode === "checkout-missing"
                ? "Read-only"
                : t.state.closure
                  ? "Exited"
                  : activity || (working ? "Working" : t.hosted ? "Ready" : "Not running");
  return { status, replyActivity };
}

export interface SessionPane {
  list: boolean;
  skeleton: boolean;
  placeholder: string | undefined;
  composerDisabled: boolean;
  editorDisabled: boolean;
}

const inputOnItsWay = (t: NonNullable<AppState["session"]>): boolean =>
  t.state.submission?.outcome === "submitting" || isWorking(t.state);

export function sessionPane(state: AppState): SessionPane {
  const t = state.session;
  const input = state.pendingCreate;
  const onItsWay = !!t && inputOnItsWay(t);
  const hasContent = !!t && (t.messages.length > 0 || !!t.pending);
  const mode = sessionInputMode(state);
  return {
    list: !!t || !!input,
    skeleton: !input && !state.selectionFailure && !(t && (hasContent || !onItsWay)),
    placeholder: t && !input && !hasContent && !onItsWay ? "No messages yet." : undefined,
    composerDisabled: mode !== "writable",
    editorDisabled: mode !== "writable" && mode !== "not-ready",
  };
}
