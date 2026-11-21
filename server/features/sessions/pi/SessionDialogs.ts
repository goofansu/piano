import { Clock, Deferred, Effect, Fiber, type Scope } from "effect";
import { answerStored } from "../../../../shared/features/sessions/askUser.ts";
import type { Dialog, DialogResolution, SessionAction } from "../../../../shared/wire.ts";
import {
  type DialogRequest,
  dialogAnswerFor,
  dialogCancellation,
  type PiCommand,
} from "./PiRecords.ts";
import { PiSessionError } from "./PiTransport.ts";
import type { PublicationTransaction, SessionPublication } from "./SessionPublication.ts";

export interface SessionDialogsOptions {
  readonly generation: string;
  readonly recoveryMs: number;
  readonly scope: Scope.Scope;
  readonly write: (command: PiCommand) => Effect.Effect<void, PiSessionError>;
  readonly publication: SessionPublication;
  readonly abortInProgress: () => Deferred.Deferred<void> | undefined;
}

const lapsed = (dialog: Dialog) =>
  dialog.deadlineKind === "pi-timeout" ? ("expired" as const) : ("recovery" as const);

type ReceiptEvent =
  | { readonly _tag: "question-opened"; readonly toolCallId: string }
  | { readonly _tag: "tool-ended"; readonly toolCallId: string; readonly result: unknown }
  | { readonly _tag: "late-answer"; readonly id: string; readonly value: string }
  | { readonly _tag: "exited" }
  | { readonly _tag: "run-started" };

export const makeSessionDialogs = ({
  generation,
  recoveryMs,
  scope,
  write,
  publication,
  abortInProgress,
}: SessionDialogsOptions) => {
  const closed = new Map<string, Deferred.Deferred<void>>();
  const ownedReceipt = (resolution: DialogResolution | undefined, toolCallId?: string) =>
    resolution?.generation === generation &&
    resolution.toolCallId !== undefined &&
    (toolCallId === undefined || resolution.toolCallId === toolCallId);

  const closure = (
    dialog: Dialog,
    reason: DialogResolution["reason"],
    delivery: DialogResolution["delivery"],
    detail: string,
    answer?: DialogResolution["answer"],
  ): DialogResolution => ({
    id: dialog.id,
    generation,
    reason,
    ...(dialog.toolCallId !== undefined ? { toolCallId: dialog.toolCallId } : {}),
    ...(dialog.questionId !== undefined ? { questionId: dialog.questionId } : {}),
    ...(dialog.title !== undefined ? { title: dialog.title } : {}),
    delivery,
    detail,
    ...(answer ? { answer } : {}),
  });

  const unsettled = (current: DialogResolution) =>
    !(
      current.delivery === "accepted" ||
      (current.delivery === "not-sent" && !current.answer) ||
      (current.delivery === "written" && !ownedReceipt(current))
    );

  const nextReceipt = (
    current: DialogResolution | undefined,
    event: ReceiptEvent,
  ): DialogResolution | "retired" | undefined => {
    if (!current) return;
    const waiting = current.delivery === "pending" || current.delivery === "written";
    switch (event._tag) {
      case "question-opened":
        return waiting && current.reason === "answered" && ownedReceipt(current, event.toolCallId)
          ? { ...current, delivery: "accepted", detail: "Pi stored your answer." }
          : undefined;
      case "tool-ended": {
        if (!waiting || !ownedReceipt(current, event.toolCallId)) return;
        if (current.reason !== "answered")
          return { ...current, delivery: "accepted", detail: "Question cancelled." };
        const stored =
          typeof current.answer?.value === "string" &&
          current.questionId !== undefined &&
          answerStored(event.result, current.questionId, current.answer.value);
        return {
          ...current,
          delivery: stored ? "accepted" : "rejected",
          detail: stored
            ? "Pi stored your answer."
            : "The question closed before Pi stored your answer. It was not resent and is kept here.",
        };
      }
      case "late-answer":
        return current.id === event.id && ownedReceipt(current) && !current.answer
          ? {
              ...current,
              delivery: "rejected",
              answer: {
                ...(current.title !== undefined ? { title: current.title } : {}),
                value: event.value,
              },
              detail:
                "The question closed before your answer arrived. Your answer was not sent and is kept here.",
            }
          : undefined;
      case "exited":
        return current.delivery === "pending" ||
          (current.delivery === "written" && ownedReceipt(current))
          ? {
              ...current,
              delivery: "uncertain",
              detail: current.answer
                ? "Pi stopped before confirming this answer. It is kept here; do not resend it."
                : "Pi stopped during response delivery. Do not resend this dialog response.",
            }
          : undefined;
      case "run-started":
        return unsettled(current) ? undefined : "retired";
    }
  };

  const advance = Effect.fnUntraced(function* (
    transaction: PublicationTransaction,
    event: ReceiptEvent,
  ) {
    const next = nextReceipt((yield* publication.state).dialogResolution, event);
    if (next)
      yield* transaction.mergeState({ dialogResolution: next === "retired" ? undefined : next });
  });

  const settle = Effect.fnUntraced(function* (
    transaction: PublicationTransaction,
    resolution: DialogResolution,
  ) {
    const signal = closed.get(resolution.id);
    if (signal) yield* Deferred.succeed(signal, undefined);
    closed.delete(resolution.id);
    yield* transaction.publish({ _tag: "dialog_resolved", resolution });
    const state = yield* publication.state;
    if (state.dialogResolution && unsettled(state.dialogResolution) && !resolution.answer) return;
    yield* transaction.publish({
      _tag: "state",
      state: { ...state, dialogResolution: resolution },
    });
  });

  const resolve = Effect.fn("SessionDialogs.resolve")(function* (
    dialog: Dialog,
    reason: DialogResolution["reason"],
    answer?: PiCommand,
    receipt?: DialogResolution["answer"],
  ) {
    const resolution = yield* publication.transaction((transaction) =>
      Effect.gen(function* () {
        if (!(yield* publication.dialogs).some((open) => open.id === dialog.id)) return;
        const now = yield* Clock.currentTimeMillis;
        if (
          (reason === "answered" || reason === "cancelled") &&
          dialog.deadlineAt !== null &&
          now >= dialog.deadlineAt
        ) {
          reason = lapsed(dialog);
        }
        const send = reason !== "expired" && reason !== "exited";
        const detail =
          reason === "expired"
            ? "Estimated Pi deadline elapsed. Pi owns the actual timeout; no closure acknowledgement is available."
            : reason === "exited"
              ? "Pi stopped before this dialog was answered. No response sent."
              : reason === "recovery"
                ? "Host recovery deadline elapsed; cancelling an unconfirmed dialog."
                : reason === "aborted"
                  ? "Abort current: cancelling this dialog. Pending queue is not cleared."
                  : "Response claimed locally; waiting for transport delivery.";
        const resolution = closure(
          dialog,
          reason,
          send ? "pending" : "not-sent",
          detail,
          reason === "answered" ? receipt : undefined,
        );
        yield* settle(transaction, resolution);
        return resolution;
      }),
    );
    if (!resolution || resolution.delivery === "not-sent") return resolution;
    const result = yield* write(
      resolution.reason === "answered" && answer ? answer : dialogCancellation(dialog.id),
    ).pipe(Effect.result);
    const owned = dialog.toolCallId !== undefined;
    const response = resolution.reason === "answered" ? "Answer" : "Cancellation";
    const final: DialogResolution =
      result._tag === "Success"
        ? {
            ...resolution,
            delivery: "written",
            detail: owned
              ? `${response} written to Pi. Waiting for the question to close.`
              : `${response} written to Pi. Consumption is unconfirmed; Pi sends no UI acknowledgement.`,
          }
        : result.failure.notSent
          ? {
              ...resolution,
              delivery: "not-sent",
              detail: `${response} not delivered: Pi never received it. It will not be retried or reopened. ${result.failure.detail}`,
            }
          : {
              ...resolution,
              delivery: "uncertain",
              detail: `Dialog response delivery is uncertain. It will not be retried or reopened. Inspect the session; restart Pi if blocked. ${result.failure.detail}`,
            };
    yield* publication.transaction((transaction) =>
      Effect.gen(function* () {
        const state = yield* publication.state;
        if (
          state.dialogResolution?.id === dialog.id &&
          state.dialogResolution.delivery === "pending" &&
          !publication.announced()
        )
          yield* transaction.publish({
            _tag: "state",
            state: { ...state, dialogResolution: final },
          });
        if (final.delivery === "uncertain")
          yield* transaction.publish({
            _tag: "notice",
            level: "error",
            message: final.detail,
          });
      }),
    );
    if (result._tag === "Failure") return yield* result.failure;
    return final;
  });

  const opened = Effect.fnUntraced(function* (
    transaction: PublicationTransaction,
    request: DialogRequest,
  ): Effect.fn.Return<Dialog> {
    const { receivedAt, timeoutMs, toolCallId } = request;
    const piTimeout = timeoutMs !== undefined && timeoutMs <= recoveryMs;
    const dialog: Dialog =
      toolCallId === undefined
        ? {
            ...request,
            deadlineAt: receivedAt + (piTimeout ? timeoutMs : recoveryMs),
            deadlineKind: piTimeout ? "pi-timeout" : "host-recovery",
          }
        : { ...request, deadlineAt: null, deadlineKind: "tool-end" };
    if (toolCallId !== undefined)
      yield* advance(transaction, { _tag: "question-opened", toolCallId });
    closed.set(dialog.id, yield* Deferred.make<void>());
    yield* transaction.publish({ _tag: "dialog", dialog });
    return dialog;
  });

  const watch = Effect.fnUntraced(function* (dialog: Dialog) {
    const signal = closed.get(dialog.id);
    if (!signal) return;
    const abort = abortInProgress();
    yield* Effect.gen(function* () {
      if (abort) yield* Deferred.await(abort);
      else if (dialog.deadlineAt === null) return;
      else
        yield* Effect.sleep(Math.max(0, dialog.deadlineAt - (yield* Clock.currentTimeMillis))).pipe(
          Effect.raceFirst(Deferred.await(signal)),
        );
      yield* resolve(dialog, abort ? "aborted" : lapsed(dialog));
    }).pipe(Effect.ignore, Effect.forkIn(scope));
  });

  const toolEnded = Effect.fnUntraced(function* (
    transaction: PublicationTransaction,
    { toolCallId, result }: { toolCallId: string; result: unknown },
  ) {
    for (const dialog of yield* publication.dialogs) {
      if (dialog.toolCallId !== toolCallId) continue;
      yield* settle(
        transaction,
        closure(dialog, "cancelled", "not-sent", "Pi closed this question before it was answered."),
      );
    }
    yield* advance(transaction, { _tag: "tool-ended", toolCallId, result });
  });

  const answer = Effect.fn("SessionDialogs.answer")(function* (
    action: Extract<SessionAction, { _tag: "answer" }>,
  ) {
    const work = Effect.gen(function* () {
      const dialog = (yield* publication.dialogs).find((open) => open.id === action.id);
      if (!dialog || action.generation !== generation) {
        yield* retain(action);
        return yield* new PiSessionError({
          reason: "rejected",
          detail: "This question is closed. Your answer was not sent.",
        });
      }
      const translation = dialogAnswerFor(action, dialog);
      if ("rejected" in translation)
        return yield* new PiSessionError({ reason: "rejected", detail: translation.rejected });
      const resolution = yield* resolve(
        dialog,
        action.cancelled ? "cancelled" : "answered",
        translation.command,
        translation.answer,
      );
      if (!resolution || resolution.reason === "expired" || resolution.reason === "recovery") {
        yield* retain(action);
        return yield* new PiSessionError({
          reason: "rejected",
          detail:
            "Dialog was already claimed or its host deadline elapsed. The answer was not sent.",
        });
      }
    });
    yield* work.pipe(Effect.forkIn(scope), Effect.flatMap(Fiber.join));
  });

  const retain = Effect.fnUntraced(function* (action: Extract<SessionAction, { _tag: "answer" }>) {
    if (action.cancelled || action.generation !== generation || action.value === undefined) return;
    const late = { _tag: "late-answer" as const, id: action.id, value: action.value };
    yield* publication.transaction((transaction) => advance(transaction, late));
  });

  const resolveAll = Effect.fn("SessionDialogs.resolveAll")(function* (
    reason: "aborted" | "exited",
    dialogs?: ReadonlyArray<Dialog>,
  ) {
    for (const dialog of dialogs ?? (yield* publication.dialogs))
      yield* resolve(dialog, reason).pipe(Effect.ignore);
    if (reason !== "exited") return;
    yield* publication.transaction((transaction) => advance(transaction, { _tag: "exited" }));
  });

  const runStarted = (transaction: PublicationTransaction) =>
    advance(transaction, { _tag: "run-started" });

  return { opened, watch, answer, toolEnded, runStarted, resolveAll };
};
