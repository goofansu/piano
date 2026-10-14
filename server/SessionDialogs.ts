/**
 * SessionDialogs: every path one dialog can end by (INV-04: a dialog has one terminal resolution).
 * It sets each dialog's host deadline from Pi's advertised timeout and the recovery policy, and
 * publishes the dialog with it. Answer, cancel, deadline, abort and exit compete for one claim
 * taken under the session's snapshot lock; the response is written to Pi only after the claim,
 * outside the lock, and no transport acknowledgement reopens it. Internal to PiSessions, which
 * owns the child; resolutions go through the session's SessionPublication. This module owns the
 * deadlines, claims, resolution reasons and their detail texts.
 */
import { Clock, Deferred, Effect, Fiber, type Scope } from "effect";
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
   * cancelling its own dialog, so an unbounded one could block the session forever. */
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

  /** All terminal paths compete under the snapshot lock, before any transport yield. */
  const resolve = Effect.fn("SessionDialogs.resolve")(function* (
    dialog: Dialog,
    reason: DialogResolution["reason"],
    answer?: PiCommand,
  ) {
    const resolution = yield* publication.transaction((transaction) =>
      Effect.gen(function* () {
        if (!(yield* publication.dialogs).some((open) => open.id === dialog.id)) return;
        const now = yield* Clock.currentTimeMillis;
        if ((reason === "answered" || reason === "cancelled") && now >= dialog.deadlineAt) {
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
          delivery: send ? "pending" : "not-sent",
          detail,
        };
        const signal = closed.get(dialog.id);
        if (signal) yield* Deferred.succeed(signal, undefined);
        closed.delete(dialog.id);
        yield* transaction.publish({ _tag: "dialog_resolved", resolution });
        yield* transaction.publish({
          _tag: "state",
          state: { ...(yield* publication.state), dialogResolution: resolution },
        });
        return resolution;
      }),
    );
    if (!resolution || resolution.delivery === "not-sent") return resolution;
    const result = yield* write(
      resolution.reason === "answered" && answer ? answer : dialogCancellation(dialog.id),
    ).pipe(Effect.result);
    const final: DialogResolution = {
      ...resolution,
      delivery: result._tag === "Success" ? "written" : "uncertain",
      detail:
        result._tag === "Success"
          ? `${resolution.reason === "answered" ? "Answer" : "Cancellation"} written to Pi. Consumption is unconfirmed; Pi sends no UI acknowledgement.`
          : `Dialog response delivery is uncertain. It will not be retried or reopened. Inspect the session; restart Pi if blocked. ${result.failure.detail}`,
    };
    yield* publication.transaction((transaction) =>
      Effect.gen(function* () {
        const state = yield* publication.state;
        if (state.dialogResolution?.id === dialog.id && !publication.announced())
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
   * Open a dialog Pi requested: the earlier of Pi's timeout and host recovery becomes its
   * deadline, its claim is registered and it is published in the record transaction.
   */
  const opened = Effect.fnUntraced(function* (
    transaction: PublicationTransaction,
    request: DialogRequest,
  ): Effect.fn.Return<Dialog> {
    const { receivedAt, timeoutMs } = request;
    const piTimeout = timeoutMs !== undefined && timeoutMs <= recoveryMs;
    const dialog: Dialog = {
      ...request,
      deadlineAt: receivedAt + (piTimeout ? timeoutMs : recoveryMs),
      deadlineKind: piTimeout ? "pi-timeout" : "host-recovery",
    };
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
      else
        yield* Effect.sleep(Math.max(0, dialog.deadlineAt - (yield* Clock.currentTimeMillis))).pipe(
          Effect.raceFirst(Deferred.await(signal)),
        );
      yield* resolve(dialog, abort ? "aborted" : lapsed(dialog));
    }).pipe(Effect.ignore, Effect.forkIn(scope));
  });

  /** A browser's answer or cancellation, accepted only for a dialog still open in this generation. */
  const answer = Effect.fn("SessionDialogs.answer")(function* (
    action: Extract<SessionAction, { _tag: "answer" }>,
  ) {
    const work = Effect.gen(function* () {
      const dialog = (yield* publication.dialogs).find((open) => open.id === action.id);
      if (!dialog || action.generation !== generation)
        return yield* new PiSessionError({
          reason: "rejected",
          detail:
            "Dialog is no longer open in this Pi process. Refresh the session; do not resend the answer.",
        });
      const translation = dialogAnswerFor(action, dialog);
      if ("rejected" in translation)
        return yield* new PiSessionError({ reason: "rejected", detail: translation.rejected });
      const resolution = yield* resolve(
        dialog,
        action.cancelled ? "cancelled" : "answered",
        translation.command,
      );
      if (!resolution || resolution.reason === "expired" || resolution.reason === "recovery")
        return yield* new PiSessionError({
          reason: "rejected",
          detail:
            "Dialog was already claimed or its host deadline elapsed. The answer was not sent.",
        });
    });
    yield* work.pipe(Effect.forkIn(scope), Effect.flatMap(Fiber.join));
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
        if (resolution?.delivery === "pending")
          yield* transaction.mergeState({
            dialogResolution: {
              ...resolution,
              delivery: "uncertain",
              detail: "Pi stopped during response delivery. Do not resend this dialog response.",
            },
          });
      }),
    );
  });

  return { opened, watch, answer, resolveAll };
};
