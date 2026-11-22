import { readProposal } from "../../../../shared/session/libraryTools.ts";
import type { SendDisposition } from "../../../../shared/transport/ws.ts";
import type { ClientCommand, Dialog, DialogResolution } from "../../../../shared/wire.ts";
import type { AppState } from "./state.ts";
export const dialogTitle = (title: string | undefined): string => title || "Pi needs an answer";

const ownedByToolCall = ({ toolCallId }: { toolCallId?: string }) => toolCallId !== undefined;

export type AnswerTone = "busy" | "warn" | "err" | "muted";

export interface AnswerReceipt {
  card: boolean;
  status: { label: string; tone: AnswerTone } | null;
  details: boolean;
  notice: { tone: "quiet"; title: string } | null;
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

export function answerReceipt(resolution: DialogResolution): AnswerReceipt {
  const { delivery, answer } = resolution;
  const owned = ownedByToolCall(resolution);
  const status =
    delivery === "written" && owned
      ? { label: "Sent, waiting for Pi…", tone: "busy" as const }
      : deliveryStatus[delivery];
  const cancelled =
    (resolution.reason === "cancelled" || resolution.reason === "aborted") &&
    (delivery === "written" || delivery === "accepted");
  return {
    card: !!answer && delivery !== "accepted" && !(delivery === "written" && !owned),
    status,
    details: delivery === "uncertain" || delivery === "not-sent" || delivery === "rejected",
    notice:
      answer || cancelled
        ? null
        : { tone: "quiet", title: `Dialog ${resolution.reason}: ${resolution.detail}` },
  };
}

export function answeredQuestion(state: AppState): DialogResolution | undefined {
  if (state.resync) return;
  const resolution = state.session?.state.dialogResolution;
  if (!resolution || !answerReceipt(resolution).card) return;
  return resolution;
}

export type DialogReply = { value?: string; confirmed?: boolean; cancelled?: boolean };

export interface DialogAnswerView {
  submitted: boolean;
  disabled: boolean;
  abortDisabled: boolean;
  title: string;
  deadline: {
    label: string;
    remainingSeconds: number;
    at: number;
  } | null;
  waiting: string;
}

export interface DialogAnswer {
  getState: () => string | null;
  subscribe: (listener: () => void) => () => void;
  answer: (reply: DialogReply, now: number, attachment: string | null) => boolean;
  cancel: (now: number, attachment: string | null) => boolean;
  abort: (now: number, attachment: string | null) => boolean;
  view: (now: number, attachment: string | null) => DialogAnswerView;
}

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
    sentOn = attachment;
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
    dialogPresentation(dialog) === "modal"
      ? "Waiting for the host’s resolution."
      : owned
        ? "Waiting for Pi to confirm…"
        : "Sending response…";
  const view = (now: number, attachment: string | null): DialogAnswerView => {
    const expired = at !== null && now >= at;
    const submitted = sentOn !== null && (attachment === null || attachment === sentOn);
    const connected = attachment !== null;
    return {
      submitted,
      disabled: submitted || !connected || expired,
      abortDisabled: submitted || !connected,
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

export type DialogPresentation = "modal" | "inline";

export const dialogPresentation = (dialog: Dialog): DialogPresentation =>
  dialog.method === "confirm" && !readProposal(dialog) ? "modal" : "inline";
