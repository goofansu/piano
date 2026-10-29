/**
 * What a session is doing, read from one Snapshot: the disposition a status reports and the last
 * answer it carries. Pure, so every reader of a session (the host's quiescence, the status read, a
 * project's home, the wait tool) says the same thing about the same snapshot.
 */

import { cutText } from "./cutText.ts";
import { type Disposition, LAST_ANSWER_CHARS } from "./dispatch.ts";
import { isWorking } from "./sessionProjection.ts";
import { turnEnding } from "./turnEnding.ts";
import type { Dialog, SessionClosure, SessionState, Snapshot } from "./wire.ts";

/**
 * What a live session is doing, from its retained state alone: waiting on a dialog, holding work
 * Pi or Piano is still carrying out, idle after an input or dialog answer Piano could not confirm
 * delivering (Pi may act on it or never do anything), or idle with nothing pending. Only an idle
 * session can be done, and only once its host also confirms quiescence.
 */
export type LiveActivity =
  | { readonly _tag: "needs_input"; readonly dialog: Dialog }
  | { readonly _tag: "running" }
  | { readonly _tag: "uncertain"; readonly detail: string }
  | { readonly _tag: "idle" };

/** Whether a stop needs the person's attention: anything but a quiet release, a stop they asked
 * for or a clean exit may have cut work short. The toast, the banner and the `session.failed`
 * webhook all follow this, never the display text. */
export const closureNeedsAttention = (
  closure: SessionClosure | undefined,
): closure is SessionClosure =>
  !!closure &&
  closure._tag !== "released" &&
  closure._tag !== "stopped" &&
  !(closure._tag === "exited" && closure.code === 0);

/**
 * Work Pi or Piano is still carrying out for the session: a run, a compaction or a retry, a stop,
 * an input or dialog answer on its way, or queued messages. The one rule for a session's working
 * state: the sidebar's, the session's announced status, whether Archive and Delete stop work, and
 * `liveActivityOf`'s `running`.
 */
export const workUnderWay = (state: SessionState): boolean =>
  isWorking(state) ||
  !!state.isStopping ||
  state.submission?.outcome === "submitting" ||
  (state.queuedMessages?.length ?? 0) > 0 ||
  state.dialogResolution?.delivery === "pending";

/**
 * What a waiting dialog asks, in one line: its title (the question; a confirm's message is the
 * detail under it), else its message, else what kind of answer Pi waits for. A blank field counts
 * as absent. The status read and the start and wait tools all report this.
 */
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

/**
 * A closure decides first: a Pi that stopped reads exited, or settled when it was released idle,
 * whatever its snapshot shows beside that. `live` is a running host's snapshot; otherwise it is
 * saved history, with the closure Piano remembers for this server process, if any. Saved history
 * alone proves an ending only when its last message is a reply whose turn ended; anything else is
 * unknown, never a guess.
 *
 * A live session is settled only when idle and its host publishes `isQuiescent`, the point the
 * wait tool also waits for; uncertain delivery reads unknown, as the wait tool reports it.
 */
export function dispositionOf(
  snapshot: Snapshot,
  live: boolean,
): { readonly disposition: Disposition; readonly dialog?: Dialog } {
  const { state } = snapshot;
  // Pi has stopped, whether or not its host is retired yet: what it was doing when it stopped,
  // or whether it looked quiescent, no longer says anything about it.
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
        // Pi looks idle, but Piano may still await an acknowledgement or be catching up on
        // output: running until the host says otherwise.
        return { disposition: state.isQuiescent === true ? "settled" : "running" };
    }
  }
  const last = snapshot.messages.at(-1);
  return {
    disposition:
      last?.role === "assistant" && turnEnding(last.stopReason) !== "other" ? "settled" : "unknown",
  };
}

/**
 * Whether an assistant message is an answer: it has text and its turn completed (a reply cut off
 * at the token limit included). A step toward a tool call, an interrupted or failed reply, or a
 * reply still being written is not, whatever text it already shows. The status read, webhooks and
 * the dispatch wait each choose their message and ask here.
 */
export const isAnswer = (message: Snapshot["messages"][number]): boolean =>
  message.text.trim().length > 0 &&
  !message.isError &&
  turnEnding(message.stopReason) === "completed";

/**
 * The last turn's final reply, at most `limit` (default LAST_ANSWER_CHARS): the last assistant
 * message after the last user message, when it is an answer. Null otherwise.
 */
export function lastAnswerOf(snapshot: Snapshot, limit = LAST_ANSWER_CHARS): string | null {
  const messages = snapshot.messages;
  const turn = messages.slice(messages.findLastIndex((m) => m.role === "user") + 1);
  const last = turn.findLast((m) => m.role === "assistant");
  return last && isAnswer(last) ? cutText(last.text, limit) : null;
}
