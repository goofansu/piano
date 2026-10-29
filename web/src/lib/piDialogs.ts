/**
 * Answering the extension dialogs Pi raises (select / confirm / input / editor), one at a time.
 * Which dialog is shown: the head of the selected session's queue, none during a resync, and
 * answerable only on a settled attachment (`sessionReady`). How it is answered: at most once, never
 * after its deadline or while disconnected, and closing it counts as cancelling. Pi sends no closure
 * acknowledgement, so a sent answer is never resent, even after a reconnect. Abort is the user's
 * escape hatch: it is sent at most once and, by rule, still offered after the deadline. Nothing
 * here depends on React.
 */
import type { ClientCommand, Dialog, DialogResolution } from "@shared/wire";
import type { AppState } from "../store.ts";
// Relative, not @/: module tests load this file directly in Node.
import { sessionReady } from "./sessionContext.ts";

export interface PendingDialogs {
  /** The dialog to answer now; undefined when none is pending or a resync is replacing the list. */
  head: Dialog | undefined;
  /** Dialogs queued behind the head. */
  more: number;
  /** Answers may be sent (see `sessionReady`). */
  connected: boolean;
}

/** The selected session's dialog queue as the dialog host shows it. */
export function pendingDialogs(state: AppState): PendingDialogs {
  const dialogs = state.resync ? [] : (state.session?.dialogs ?? []);
  return {
    head: dialogs[0],
    more: Math.max(0, dialogs.length - 1),
    connected: sessionReady(state),
  };
}

/** A receipt reports delivery, not history: an answer a tool call owns leaves once its stored
 * result confirms it; an ordinary reply leaves once written, without claiming Pi consumed it.
 * Pending/failed/uncertain writes remain visible even without a pending question (INV-04). */
export function answeredQuestion(state: AppState): DialogResolution | undefined {
  if (state.resync) return;
  const session = state.session;
  const resolution = session?.state.dialogResolution;
  if (!session || !resolution?.answer) return;
  if (resolution.delivery === "accepted") return;
  if (resolution.delivery === "written" && resolution.toolCallId === undefined) return;
  return resolution;
}

/** One reply to a dialog; which field is set depends on its method. */
export type DialogReply = { value?: string; confirmed?: boolean; cancelled?: boolean };

export interface DialogAnswerView {
  /** A reply was sent (or abort requested); the host's resolution is awaited. */
  submitted: boolean;
  /** The reply controls are disabled: already submitted, disconnected or past the deadline. */
  disabled: boolean;
  /** Abort is disabled: already submitted or disconnected. It ignores the deadline. */
  abortDisabled: boolean;
  /** Whole seconds until the deadline, rounded up and never negative. */
  remainingSeconds: number | null;
}

export interface DialogAnswer {
  /** Whether a reply or abort was sent; `subscribe` fires when it becomes true. */
  getState: () => boolean;
  subscribe: (listener: () => void) => () => void;
  /** Sends the reply unless `view(now, connected).disabled`; true when it was sent. */
  answer: (reply: DialogReply, now: number, connected: boolean) => boolean;
  /** Closing the dialog: a cancelled reply, under the same rules as `answer`. */
  cancel: (now: number, connected: boolean) => boolean;
  /** Requests a native abort unless `view(now, connected).abortDisabled`; true when it was sent. */
  abort: (now: number, connected: boolean) => boolean;
  view: (now: number, connected: boolean) => DialogAnswerView;
}

/**
 * Abort stays available past the deadline: the deadline only bounds when Pi still reads a reply,
 * while abort is how the user gets out of a dialog Pi may already have given up on.
 */
export const ABORT_IGNORES_DEADLINE = true;

export function createDialogAnswer({
  dialog,
  send,
}: {
  dialog: Dialog;
  send: (command: ClientCommand) => void;
}): DialogAnswer {
  let submitted = false;
  const listeners = new Set<() => void>();
  const submit = (command: ClientCommand) => {
    submitted = true;
    send(command);
    for (const listener of listeners) listener();
    return true;
  };
  const view = (now: number, connected: boolean): DialogAnswerView => {
    const expired = dialog.deadlineAt !== null && now >= dialog.deadlineAt;
    return {
      submitted,
      disabled: submitted || !connected || expired,
      abortDisabled: submitted || !connected || (!ABORT_IGNORES_DEADLINE && expired),
      remainingSeconds:
        dialog.deadlineAt === null
          ? null
          : Math.max(0, Math.ceil((dialog.deadlineAt - now) / 1000)),
    };
  };
  const answer = (reply: DialogReply, now: number, connected: boolean) =>
    !view(now, connected).disabled &&
    submit({
      _tag: "act",
      action: { _tag: "answer", id: dialog.id, generation: dialog.generation, ...reply },
    });
  return {
    getState: () => submitted,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    answer,
    cancel: (now, connected) => answer({ cancelled: true }, now, connected),
    abort: (now, connected) =>
      !view(now, connected).abortDisabled && submit({ _tag: "act", action: { _tag: "abort" } }),
    view,
  };
}
