import { cutText } from "../../cutText.ts";
import type { Dialog, SessionClosure, SessionState, Snapshot } from "../../wire.ts";
import { type Disposition, LAST_ANSWER_CHARS } from "../dispatch/dispatch.ts";
import { isWorking } from "./sessionProjection.ts";
import { turnEnding } from "./turnEnding.ts";

export type LiveActivity =
  | { readonly _tag: "needs_input"; readonly dialog: Dialog }
  | { readonly _tag: "running" }
  | { readonly _tag: "uncertain"; readonly detail: string }
  | { readonly _tag: "idle" };

export const closureNeedsAttention = (
  closure: SessionClosure | undefined,
): closure is SessionClosure =>
  !!closure &&
  closure._tag !== "released" &&
  closure._tag !== "stopped" &&
  !(closure._tag === "exited" && closure.code === 0);

export const workUnderWay = (state: SessionState): boolean =>
  isWorking(state) ||
  !!state.isStopping ||
  state.submission?.outcome === "submitting" ||
  (state.queuedMessages?.length ?? 0) > 0 ||
  state.dialogResolution?.delivery === "pending";

export const dialogAsks = (dialog: Dialog): string =>
  dialog.title?.trim() || dialog.message?.trim() || `Pi is waiting for a ${dialog.method} answer.`;

export function liveActivityOf({ state, dialogs }: Snapshot): LiveActivity {
  const dialog = dialogs[0];
  if (dialog) return { _tag: "needs_input", dialog };
  if (workUnderWay(state)) return { _tag: "running" };
  if (state.submission?.outcome === "uncertain")
    return {
      _tag: "uncertain",
      detail: state.submission.detail ?? "Prompt delivery is uncertain.",
    };
  if (state.dialogResolution?.delivery === "uncertain")
    return { _tag: "uncertain", detail: state.dialogResolution.detail };
  return { _tag: "idle" };
}

export function dispositionOf(
  snapshot: Snapshot,
  live: boolean,
): { readonly disposition: Disposition; readonly dialog?: Dialog } {
  const { state } = snapshot;
  if (state.closure)
    return {
      disposition: state.closure._tag === "released" ? "settled" : "exited",
    };
  if (live) {
    const activity = liveActivityOf(snapshot);
    switch (activity._tag) {
      case "needs_input":
        return { disposition: "needs_input", dialog: activity.dialog };
      case "running":
        return { disposition: "running" };
      case "uncertain":
        return { disposition: "unknown" };
      case "idle":
        return { disposition: state.isQuiescent === true ? "settled" : "running" };
    }
  }
  const last = snapshot.messages.at(-1);
  return {
    disposition:
      last?.role === "assistant" && turnEnding(last.stopReason) !== "other" ? "settled" : "unknown",
  };
}

export const isAnswer = (message: Snapshot["messages"][number]): boolean =>
  message.text.trim().length > 0 &&
  !message.isError &&
  turnEnding(message.stopReason) === "completed";

export function lastAnswerOf(snapshot: Snapshot, limit = LAST_ANSWER_CHARS): string | null {
  const messages = snapshot.messages;
  const turn = messages.slice(messages.findLastIndex((m) => m.role === "user") + 1);
  const last = turn.findLast((m) => m.role === "assistant");
  return last && isAnswer(last) ? cutText(last.text, limit) : null;
}
