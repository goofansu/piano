/**
 * Answering the extension dialogs Pi raises (select / confirm / input / editor), one at a time.
 * Which dialog is shown: the head of the selected session's queue, none during a resync, and
 * answerable only on a settled attachment (`sessionReady`). How it is answered: at most once per
 * attachment, never after its deadline or while disconnected, and closing it counts as cancelling.
 * Pi sends no closure acknowledgement, so nothing is ever resent automatically. A later attachment
 * whose snapshot still lists the dialog shows the server never claimed an answer (it claims one per
 * dialog and rejects any other), so the person may answer it again. Abort is the user's escape
 * hatch: it follows the same rule and, by rule, is still offered after the deadline. How it
 * reads: which surface asks it, its title and deadline wording are decided here, not per component.
 * Nothing here depends on React.
 */
import type { ClientCommand, Dialog, DialogResolution } from "@shared/wire";
import type { AppState } from "../store.ts";
// Relative, not @/: module tests load this file directly in Node.
import { sessionReady } from "./sessionContext.ts";
import type { SendDisposition } from "./ws.ts";

/** Where a dialog is asked: a confirmation in a modal, any other method inline by the composer. */
export type DialogSurface = "modal" | "inline";

export const dialogSurface = (dialog: Dialog): DialogSurface =>
  dialog.method === "confirm" ? "modal" : "inline";

/** A question's title, or the generic one when Pi gave none; the asking and answered views share it. */
export const dialogTitle = (title: string | undefined): string => title || "Pi needs an answer";

/** A tool call owns the dialog or answer (Piano's own `ask_user`): it ends with that call, never on
 * a timer, and only the call's stored result confirms the answer. */
const ownedByToolCall = ({ toolCallId }: { toolCallId?: string }) => toolCallId !== undefined;

export interface PendingDialogs {
  /** The dialog to answer now; undefined when none is pending or a resync is replacing the list. */
  head: Dialog | undefined;
  /** Which surface asks the head; null when there is none. */
  surface: DialogSurface | null;
  /** Dialogs queued behind the head. */
  more: number;
  /** The settled attachment answers go out on (see `sessionReady`); null while there is none. */
  attachment: string | null;
}

/** The selected session's dialog queue as the dialog host shows it. */
export function pendingDialogs(state: AppState): PendingDialogs {
  const dialogs = state.resync ? [] : (state.session?.dialogs ?? []);
  return {
    head: dialogs[0],
    surface: dialogs[0] ? dialogSurface(dialogs[0]) : null,
    more: Math.max(0, dialogs.length - 1),
    attachment: sessionReady(state) ? state.selectionId : null,
  };
}

/** A status dot's tone; the subset of `StatusTone` an answer receipt uses. */
export type AnswerTone = "busy" | "warn" | "err" | "muted";

/** How a dialog resolution is reported, decided once for the answer card, notices and toasts. */
export interface AnswerReceipt {
  /** The last answer stays above the composer. */
  card: boolean;
  /** The card's delivery line; null when delivery needs no word. */
  status: { label: string; tone: AnswerTone; pulse: boolean } | null;
  /** The card offers the delivery detail behind a Details popover. */
  details: boolean;
  /** The status line for a resolution without an answer; null when it has one. */
  notice: { tone: "warning" | "quiet"; title: string } | null;
  /** The answer was confirmed; announced once per resolution. */
  accepted: boolean;
}

const deliveryStatus: Record<
  DialogResolution["delivery"],
  { label: string; tone: AnswerTone } | null
> = {
  pending: { label: "Sending answer…", tone: "busy" },
  written: null,
  accepted: null,
  rejected: { label: "Answer not accepted", tone: "err" },
  uncertain: { label: "Delivery uncertain", tone: "warn" },
  "not-sent": { label: "Not sent", tone: "muted" },
};

/** A receipt reports delivery, not history: an answer a tool call owns leaves once its stored
 * result confirms it; an ordinary reply leaves once written, without claiming Pi consumed it.
 * Pending/failed/uncertain writes remain visible even without a pending question (INV-04). */
export function answerReceipt(resolution: DialogResolution): AnswerReceipt {
  const { delivery, answer } = resolution;
  const owned = ownedByToolCall(resolution);
  // A written answer to one of Piano's own questions still awaits Pi's confirmation.
  const status =
    delivery === "written" && owned
      ? { label: "Sent, waiting for Pi…", tone: "busy" as const }
      : deliveryStatus[delivery];
  // Cancelling a question Pi already received is worth a warning; other endings stay quiet.
  const cancelled =
    resolution.reason === "cancelled" && (delivery === "written" || delivery === "accepted");
  return {
    card: !!answer && delivery !== "accepted" && !(delivery === "written" && !owned),
    status: status && { ...status, pulse: delivery === "pending" },
    details: delivery === "uncertain" || delivery === "not-sent" || delivery === "rejected",
    notice: answer
      ? null
      : cancelled
        ? { tone: "warning", title: "Question cancelled" }
        : { tone: "quiet", title: `Dialog ${resolution.reason}: ${resolution.detail}` },
    accepted: delivery === "accepted" && !!answer,
  };
}

/** The selected session's last answer while its receipt still has something to say. */
export function answeredQuestion(state: AppState): DialogResolution | undefined {
  if (state.resync) return;
  const resolution = state.session?.state.dialogResolution;
  if (!resolution || !answerReceipt(resolution).card) return;
  return resolution;
}

/** One reply to a dialog; which field is set depends on its method. */
export type DialogReply = { value?: string; confirmed?: boolean; cancelled?: boolean };

export interface DialogAnswerView {
  /** A reply was sent (or abort requested) on this attachment, or the socket has since closed;
   * the host's resolution is awaited. */
  submitted: boolean;
  /** The reply controls are disabled: already submitted, disconnected or past the deadline. */
  disabled: boolean;
  /** Abort is disabled: already submitted or disconnected. It ignores the deadline. */
  abortDisabled: boolean;
  /** The title to show, with the generic fallback applied. */
  title: string;
  /** The estimated answer deadline; null when a tool call owns the dialog and so it has none. */
  deadline: {
    /** What the estimate is: Pi's own timeout, or Piano cancelling it on recovery. */
    label: string;
    /** Whole seconds until the deadline, rounded up and never negative. */
    remainingSeconds: number;
    /** The deadline as epoch milliseconds. */
    at: number;
  } | null;
  /** The status line once submitted: what the dialog now waits for. */
  waiting: string;
}

/** Each method takes the current `PendingDialogs.attachment`. */
export interface DialogAnswer {
  /** The attachment a reply or abort may have been sent on; `subscribe` fires after an attempt. */
  getState: () => string | null;
  subscribe: (listener: () => void) => () => void;
  /** Sends unless disabled; true for sent or uncertain, false for blocked or known not sent. */
  answer: (reply: DialogReply, now: number, attachment: string | null) => boolean;
  /** Closing the dialog: a cancelled reply, under the same rules as `answer`. */
  cancel: (now: number, attachment: string | null) => boolean;
  /** Requests native abort unless disabled; true for sent or uncertain delivery. */
  abort: (now: number, attachment: string | null) => boolean;
  view: (now: number, attachment: string | null) => DialogAnswerView;
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
  send: (command: ClientCommand) => SendDisposition;
}): DialogAnswer {
  let sentOn: string | null = null;
  const listeners = new Set<() => void>();
  const submit = (command: ClientCommand, attachment: string) => {
    // Claim before entering the transport: it can synchronously notify connection subscribers.
    sentOn = attachment;
    // Only proven non-delivery permits a retry on this attachment. Sent/uncertain never replay.
    if (send(command) === "not-sent") sentOn = null;
    for (const listener of listeners) listener();
    return sentOn !== null;
  };
  const owned = ownedByToolCall(dialog);
  const at = owned ? null : dialog.deadlineAt;
  const title = dialogTitle(dialog.title);
  const label =
    dialog.deadlineKind === "pi-timeout" ? "Estimated Pi timeout" : "Host recovery cancellation";
  const waiting =
    dialogSurface(dialog) === "modal"
      ? "Waiting for the host’s resolution."
      : owned
        ? "Waiting for Pi to confirm…"
        : "Sending response…";
  const view = (now: number, attachment: string | null): DialogAnswerView => {
    const expired = at !== null && now >= at;
    // Disconnected, the attempt still awaits its outcome; a new attachment's snapshot decides it.
    const submitted = sentOn !== null && (attachment === null || attachment === sentOn);
    const connected = attachment !== null;
    return {
      submitted,
      disabled: submitted || !connected || expired,
      abortDisabled: submitted || !connected || (!ABORT_IGNORES_DEADLINE && expired),
      title,
      deadline:
        at === null
          ? null
          : { label, remainingSeconds: Math.max(0, Math.ceil((at - now) / 1000)), at },
      waiting,
    };
  };
  const answer = (reply: DialogReply, now: number, attachment: string | null) =>
    attachment !== null &&
    !view(now, attachment).disabled &&
    submit(
      {
        _tag: "act",
        action: { _tag: "answer", id: dialog.id, generation: dialog.generation, ...reply },
      },
      attachment,
    );
  return {
    getState: () => sentOn,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    answer,
    cancel: (now, attachment) => answer({ cancelled: true }, now, attachment),
    abort: (now, attachment) =>
      attachment !== null &&
      !view(now, attachment).abortDisabled &&
      submit({ _tag: "act", action: { _tag: "abort" } }, attachment),
    view,
  };
}
