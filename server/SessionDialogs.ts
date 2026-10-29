/**
 * SessionDialogs: every path one dialog can end by (INV-04: a dialog has one terminal resolution).
 * An ordinary dialog gets a host deadline from Pi's advertised timeout and the recovery policy. A
 * dialog a tool call owns has none: Pi's native end record for that call closes it, and the
 * result Pi stored confirms or rejects the answer written for it. Answer, cancel, deadline,
 * abort, tool end and exit compete for one claim taken under the session's snapshot lock; the
 * response is written to Pi only after the claim, outside the lock, and no transport
 * acknowledgement reopens it. Internal to PiSessions, which owns the child; resolutions go
 * through the session's SessionPublication. This module owns the deadlines, claims, resolution
 * reasons and their detail texts.
 */
import { Clock, Deferred, Effect, Fiber, type Scope } from "effect";
import { answerStored } from "../shared/askUser.ts";
import type { Dialog, DialogResolution, SessionAction } from "../shared/wire.ts";
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
  /** Bounds a dialog whose Pi timeout is absent or later: Pi does not report an extension
   * cancelling its own dialog, so an unbounded one could block the session forever. A dialog
   * owned by a tool call is exempt: that call's end closes it. */
  readonly recoveryMs: number;
  /** Watchers and answers belong to the session, not to the requesting browser. */
  readonly scope: Scope.Scope;
  readonly write: (command: PiCommand) => Effect.Effect<void, PiSessionError>;
  readonly publication: SessionPublication;
  /** The in-progress abort's dispatch signal, if an abort is cancelling the current run. */
  readonly abortInProgress: () => Deferred.Deferred<void> | undefined;
}

/** The reason a dialog ends at its deadline: Pi's own timeout, or Piano's recovery policy. */
const lapsed = (dialog: Dialog) =>
  dialog.deadlineKind === "pi-timeout" ? ("expired" as const) : ("recovery" as const);

export const makeSessionDialogs = ({
  generation,
  recoveryMs,
  scope,
  write,
  publication,
  abortInProgress,
}: SessionDialogsOptions) => {
  // Claim/removal, deadline wakeup and resolution frames share one atomic snapshot boundary.
  const closed = new Map<string, Deferred.Deferred<void>>();
  /** Dialog id to the tool call that owns it. Kept for the generation, so an answer arriving
   * after the call ended is still recognised as one of Piano's own questions. */
  const owners = new Map<string, string>();

  /** Settle one dialog's claim under the lock: remove it, wake its watcher, publish. */
  const settle = Effect.fnUntraced(function* (
    transaction: PublicationTransaction,
    resolution: DialogResolution,
  ) {
    const signal = closed.get(resolution.id);
    if (signal) yield* Deferred.succeed(signal, undefined);
    closed.delete(resolution.id);
    yield* transaction.publish({ _tag: "dialog_resolved", resolution });
    yield* transaction.publish({
      _tag: "state",
      state: { ...(yield* publication.state), dialogResolution: resolution },
    });
  });

  /** All terminal paths compete under the snapshot lock, before any transport yield. */
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
        const resolution: DialogResolution = {
          id: dialog.id,
          generation,
          reason,
          ...(dialog.toolCallId !== undefined ? { toolCallId: dialog.toolCallId } : {}),
          delivery: send ? "pending" : "not-sent",
          detail,
          ...(reason === "answered" && receipt ? { answer: receipt } : {}),
        };
        yield* settle(transaction, resolution);
        return resolution;
      }),
    );
    if (!resolution || resolution.delivery === "not-sent") return resolution;
    const result = yield* write(
      resolution.reason === "answered" && answer ? answer : dialogCancellation(dialog.id),
    ).pipe(Effect.result);
    const owned = dialog.toolCallId !== undefined;
    const final: DialogResolution = {
      ...resolution,
      delivery: result._tag === "Success" ? "written" : "uncertain",
      detail:
        result._tag === "Success"
          ? owned
            ? `${resolution.reason === "answered" ? "Answer" : "Cancellation"} written to Pi. Waiting for the question to close.`
            : `${resolution.reason === "answered" ? "Answer" : "Cancellation"} written to Pi. Consumption is unconfirmed; Pi sends no UI acknowledgement.`
          : `Dialog response delivery is uncertain. It will not be retried or reopened. Inspect the session; restart Pi if blocked. ${result.failure.detail}`,
    };
    yield* publication.transaction((transaction) =>
      Effect.gen(function* () {
        const state = yield* publication.state;
        // The owning tool can end before the stdin write completes: never downgrade its verdict.
        if (
          state.dialogResolution?.id === dialog.id &&
          state.dialogResolution.delivery === "pending" &&
          !publication.announced()
        )
          yield* transaction.publish({
            _tag: "state",
            state: { ...state, dialogResolution: final },
          });
        if (result._tag === "Failure")
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

  /**
   * Open a dialog Pi requested, under the publication lock. An ordinary dialog's deadline is the
   * earlier of Pi's timeout and host recovery. A dialog its tool call owns has none, and its
   * arrival confirms the answer written for that call's previous question: the tool only asks
   * the next one after storing the last.
   */
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
    if (toolCallId !== undefined) {
      owners.set(dialog.id, toolCallId);
      const previous = (yield* publication.state).dialogResolution;
      if (
        previous?.reason === "answered" &&
        (previous.delivery === "pending" || previous.delivery === "written") &&
        owners.get(previous.id) === toolCallId
      )
        yield* transaction.mergeState({
          dialogResolution: { ...previous, delivery: "accepted", detail: "Pi stored your answer." },
        });
    }
    closed.set(dialog.id, yield* Deferred.make<void>());
    yield* transaction.publish({ _tag: "dialog", dialog });
    return dialog;
  });

  /** End an open dialog at its deadline, or once an abort in progress has been dispatched. */
  const watch = Effect.fnUntraced(function* (dialog: Dialog) {
    const signal = closed.get(dialog.id);
    if (!signal) return;
    const abort = abortInProgress();
    // Never stop stdout consumption while an extension or a pipe is blocked.
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

  /**
   * A tool call ended (Pi's native record, consumed under the same lock as local claims). Its
   * dialogs still open closed with it: nothing is written, Pi no longer reads a reply. The answer
   * written for it is accepted when the result Pi stored holds it, otherwise rejected and kept;
   * a written cancellation is confirmed by the end alone.
   */
  const toolEnded = Effect.fnUntraced(function* (
    transaction: PublicationTransaction,
    { toolCallId, result }: { toolCallId: string; result: unknown },
  ) {
    for (const dialog of yield* publication.dialogs) {
      if (owners.get(dialog.id) !== toolCallId) continue;
      yield* settle(transaction, {
        id: dialog.id,
        generation,
        reason: "cancelled",
        toolCallId,
        delivery: "not-sent",
        detail: "Pi closed this question before it was answered.",
      });
    }
    const current = (yield* publication.state).dialogResolution;
    if (
      !current ||
      (current.delivery !== "pending" && current.delivery !== "written") ||
      owners.get(current.id) !== toolCallId
    )
      return;
    if (current.reason === "cancelled")
      yield* transaction.mergeState({
        dialogResolution: { ...current, delivery: "accepted", detail: "Question cancelled." },
      });
    if (current.reason !== "answered") return;
    const stored =
      typeof current.answer?.value === "string" && answerStored(result, current.answer.value);
    yield* transaction.mergeState({
      dialogResolution: {
        ...current,
        delivery: stored ? "accepted" : "rejected",
        detail: stored
          ? "Pi stored your answer."
          : "The question closed before Pi stored your answer. It was not resent and is kept here.",
      },
    });
  });

  /** A browser's answer or cancellation, accepted only for a dialog still open in this generation. */
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

  /**
   * Keep an answer to one of Piano's own questions that arrived after it closed, in the live
   * receipt only: it replaces that question's closure, never another tab's claimed answer or a
   * different dialog's receipt. Ordinary dialogs keep their recovery policy and no echo.
   */
  const retain = Effect.fnUntraced(function* (action: Extract<SessionAction, { _tag: "answer" }>) {
    if (
      action.cancelled ||
      action.generation !== generation ||
      action.value === undefined ||
      !owners.has(action.id)
    )
      return;
    const value = action.value;
    yield* publication.transaction((transaction) =>
      Effect.gen(function* () {
        const current = (yield* publication.state).dialogResolution;
        if (current?.id !== action.id || current.answer) return;
        yield* transaction.mergeState({
          dialogResolution: {
            ...current,
            delivery: "rejected",
            answer: { value },
            detail:
              "The question closed before your answer arrived. Your answer was not sent and is kept here.",
          },
        });
      }),
    );
  });

  /**
   * Resolve every dialog in `dialogs` (by default, those open now). Abort passes the dialogs open
   * before it dispatched, so a newer run's dialog is never cancelled by an older abort. On exit,
   * a response still being delivered becomes uncertain; it must not be resent.
   */
  const resolveAll = Effect.fn("SessionDialogs.resolveAll")(function* (
    reason: "aborted" | "exited",
    dialogs?: ReadonlyArray<Dialog>,
  ) {
    for (const dialog of dialogs ?? (yield* publication.dialogs))
      yield* resolve(dialog, reason).pipe(Effect.ignore);
    if (reason !== "exited") return;
    yield* publication.transaction((transaction) =>
      Effect.gen(function* () {
        const resolution = (yield* publication.state).dialogResolution;
        // An owned dialog's written reply was still awaiting its tool's end; an ordinary one was final.
        if (
          resolution?.delivery === "pending" ||
          (resolution?.delivery === "written" && owners.has(resolution.id))
        )
          yield* transaction.mergeState({
            dialogResolution: {
              ...resolution,
              delivery: "uncertain",
              detail: resolution.answer
                ? "Pi stopped before confirming this answer. It is kept here; do not resend it."
                : "Pi stopped during response delivery. Do not resend this dialog response.",
            },
          });
      }),
    );
    owners.clear();
  });

  return { opened, watch, answer, toolEnded, resolveAll };
};
