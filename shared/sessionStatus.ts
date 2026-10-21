/**
 * What a session is doing, read from one Snapshot: the disposition a status reports and the last
 * answer it carries. Pure, so every reader of a session (the status read, a project's home) says
 * the same thing about the same snapshot.
 */
import { type Disposition, LAST_ANSWER_CHARS } from "./dispatch.ts";
import { isWorking } from "./sessionProjection.ts";
import { turnEnding } from "./turnEnding.ts";
import type { Dialog, Snapshot } from "./wire.ts";

/**
 * `live` is a running host's snapshot; otherwise it is saved history, with the closure Piano
 * remembers for this server process, if any. Saved history alone proves an ending only when its
 * last message is a reply whose turn ended; anything else is unknown, never a guess.
 *
 * A live session is settled only when its host publishes `isQuiescent`, the one answer to "is
 * this session done?" that the wait tool also waits for. An idle Pi whose last input or dialog
 * answer Piano could not confirm delivering may never become quiescent, nor do anything: unknown.
 */
export function dispositionOf(
  snapshot: Snapshot,
  live: boolean,
): { readonly disposition: Disposition; readonly dialog?: Dialog } {
  const { state, dialogs } = snapshot;
  if (live) {
    const dialog = dialogs[0];
    if (dialog) return { disposition: "needs_input", dialog };
    if (
      isWorking(state) ||
      state.isStopping ||
      state.submission?.outcome === "submitting" ||
      (state.queuedMessages?.length ?? 0) > 0
    )
      return { disposition: "running" };
    if (
      state.submission?.outcome === "uncertain" ||
      state.dialogResolution?.delivery === "uncertain"
    )
      return { disposition: "unknown" };
    // Pi looks idle, but Piano may still be delivering an answer, awaiting an acknowledgement or
    // catching up on output: running until the host says otherwise.
    return { disposition: state.isQuiescent === true ? "settled" : "running" };
  }
  if (state.closure)
    return {
      disposition: state.closure._tag === "released" ? "settled" : "exited",
    };
  const last = snapshot.messages.at(-1);
  return {
    disposition:
      last?.role === "assistant" && turnEnding(last.stopReason) !== "other" ? "settled" : "unknown",
  };
}

/**
 * The last turn's final reply, at most LAST_ANSWER_CHARS: the last assistant message after the
 * last user message, when it has text and is neither a step toward a tool call nor an
 * interrupted or failed reply. Null otherwise, including mid-turn.
 */
export function lastAnswerOf(snapshot: Snapshot): string | null {
  const messages = snapshot.messages;
  const turn = messages.slice(messages.findLastIndex((m) => m.role === "user") + 1);
  const last = turn.findLast((m) => m.role === "assistant");
  if (!last?.text.trim() || last.stopReason === "toolUse" || last.isError) return null;
  const ending = turnEnding(last.stopReason);
  if (ending === "cancelled" || ending === "failed") return null;
  return last.text.slice(0, LAST_ANSWER_CHARS);
}
