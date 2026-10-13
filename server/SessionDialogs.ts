/**
 * SessionDialogs: every path one dialog can end by (INV-04: a dialog has one terminal resolution).
 * Answer, cancel, deadline, abort and exit compete for one claim taken under the session's
 * snapshot lock; the response is written to Pi only after the claim, outside the lock, and no
 * transport acknowledgement reopens it. Internal to PiSessions, which owns the lock, publication
 * and the child; this module owns the claims, resolution reasons and their detail texts.
 */
import { Clock, Deferred, Effect, Fiber, type Scope } from "effect";
import type {
  Dialog,
  DialogResolution,
  SessionAction,
  SessionEvent,
  SessionState,
} from "../shared/wire.ts";
import { dialogCancellation, type PiCommand, piCommandFor } from "./PiRecords.ts";
import { PiSessionError } from "./PiTransport.ts";

/** The session publication a dialog resolution goes through. */
export interface DialogPublication {
  /** Run under the session's snapshot lock. */
  readonly locked: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>;
  /** Fold and send one event; callers hold the lock. */
  readonly publish: (event: SessionEvent) => Effect.Effect<void>;
  /** Merge state fields; callers hold the lock. */
  readonly mergeState: (patch: Partial<SessionState>) => Effect.Effect<void>;
  readonly state: Effect.Effect<SessionState>;
  readonly dialogs: Effect.Effect<ReadonlyArray<Dialog>>;
  /** True once subscribers have been told Pi is gone. */
  readonly announced: () => boolean;
}

export interface SessionDialogsOptions {
  readonly generation: string;
  /** Watchers and answers belong to the session, not to the requesting browser. */
  readonly scope: Scope.Scope;
  readonly write: (command: PiCommand) => Effect.Effect<void, PiSessionError>;
  readonly publication: DialogPublication;
  /** The in-progress abort's dispatch signal, if an abort is cancelling the current run. */
  readonly abortInProgress: () => Deferred.Deferred<void> | undefined;
}

export const makeSessionDialogs = ({
  generation,
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
    const resolution = yield* publication.locked(
      Effect.gen(function* () {
        if (!(yield* publication.dialogs).some((open) => open.id === dialog.id)) return;
        const now = yield* Clock.currentTimeMillis;
        if ((reason === "answered" || reason === "cancelled") && now >= dialog.deadlineAt) {
          reason = dialog.deadlineKind === "pi-timeout" ? "expired" : "recovery";
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
        yield* publication.publish({ _tag: "dialog_resolved", resolution });
        yield* publication.publish({
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
    yield* publication.locked(
      Effect.gen(function* () {
        const state = yield* publication.state;
        if (state.dialogResolution?.id === dialog.id && !publication.announced())
          yield* publication.publish({
            _tag: "state",
            state: { ...state, dialogResolution: final },
          });
        if (result._tag === "Failure")
          yield* publication.publish({ _tag: "notice", level: "error", message: final.detail });
      }),
    );
    if (result._tag === "Failure") return yield* result.failure;
    return final;
  });

  /** Register a dialog's claim as it is published; callers hold the lock. */
  const opened = Effect.fnUntraced(function* (dialog: Dialog) {
    closed.set(dialog.id, yield* Deferred.make<void>());
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
      yield* resolve(
        dialog,
        abort ? "aborted" : dialog.deadlineKind === "pi-timeout" ? "expired" : "recovery",
      );
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
      const translation = piCommandFor(action, dialog);
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
    yield* publication.locked(
      Effect.gen(function* () {
        const resolution = (yield* publication.state).dialogResolution;
        if (resolution?.delivery === "pending")
          yield* publication.mergeState({
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
