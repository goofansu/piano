/**
 * What a session is doing, read from one Snapshot: the disposition a status reports and the last
 * answer it carries. Pure, so every reader of a session (the host's quiescence, the status read, a
 * project's home, the wait tool) says the same thing about the same snapshot.
 */
import { type Disposition, LAST_ANSWER_CHARS } from "./dispatch.ts";
import { isWorking } from "./sessionProjection.ts";
import { turnEnding } from "./turnEnding.ts";
import type { Dialog, Snapshot } from "./wire.ts";

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

export function liveActivityOf({ state, dialogs }: Snapshot): LiveActivity {
  const dialog = dialogs[0];
  if (dialog) return { _tag: "needs_input", dialog };
  // A retry, a compaction, a queued message or an answer being written is work under way.
  if (
    isWorking(state) ||
    state.isStopping ||
    state.submission?.outcome === "submitting" ||
    (state.queuedMessages?.length ?? 0) > 0 ||
    state.dialogResolution?.delivery === "pending"
  )
    return { _tag: "running" };
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
 * The last turn's final reply, at most LAST_ANSWER_CHARS: the last assistant message after the
 * last user message, when it has text and its turn completed (a reply cut off at the token limit
 * included). Null otherwise: a step toward a tool call, an interrupted or failed reply, or a
 * reply still being written, whose text is not yet an answer.
 */
export function lastAnswerOf(snapshot: Snapshot): string | null {
  const messages = snapshot.messages;
  const turn = messages.slice(messages.findLastIndex((m) => m.role === "user") + 1);
  const last = turn.findLast((m) => m.role === "assistant");
  if (!last?.text.trim() || last.isError || turnEnding(last.stopReason) !== "completed")
    return null;
  return last.text.slice(0, LAST_ANSWER_CHARS);
}
