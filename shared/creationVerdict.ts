/**
 * What a session creation's result frame says about it. The wire never states a creation's
 * outcome: a reader infers it from the frame's tag, whether the frame names the creation's first
 * input, and whether a session was already named. Every reader of a creation (the browser's first
 * message, the dispatch tools) decides here, so a new reading reaches them all.
 *
 * Readers still act differently on one verdict: on a selection frame the browser changes its first
 * message only while it still awaits the creation's own answer (it is already uncertain while
 * reading back, and a re-attachment's session decides it otherwise), and ignores
 * `selection_failed`; the dispatch tools settle on every verdict.
 */

import type { ServerMessage } from "./wire.ts";

/** A frame that can end a creation: a refused or failed selection, or an error. */
export type CreationResultFrame = Extract<
  ServerMessage,
  { _tag: "selection_rejected" | "selection_failed" | "error" }
>;

/** What the reader knows when its creation's result frame arrives. */
export interface CreationContext {
  /** The creation's attempt, which is also its first input's `inputId`. */
  readonly attemptId: string;
  /** A `selected` frame already named the created session. */
  readonly sessionNamed: boolean;
}

export type CreationVerdict =
  /** No session exists and nothing was sent: the input may be sent again. The frame named this
   * attempt, so a reader that returns named inputs to their draft has done so. */
  | { readonly kind: "refused"; readonly detail: string }
  /** The session exists; Piano refused its first input before Pi saw it. */
  | { readonly kind: "created_not_sent"; readonly detail: string }
  /** The session exists; whether its first input reached Pi is unknown. */
  | { readonly kind: "created_uncertain"; readonly detail: string }
  /** Whether a session exists, and whether its input reached Pi, is unknown. */
  | { readonly kind: "uncertain"; readonly detail: string };

/** The creation attempt a rejection refuses by name, whatever selection it answers. Only a
 * creation's rejection, or its read-back's, carries an `inputId`. */
export const refusedAttempt = (frame: ServerMessage): string | undefined =>
  frame._tag === "selection_rejected" ? frame.inputId : undefined;

/**
 * The verdict one result frame gives on a creation, read with what its reader knows.
 *
 * - `selection_rejected`: once a session was named, a rejection cannot undo it. Otherwise one
 *   naming the attempt (by its input, or by the selection that carried it) refuses it. Every
 *   rejection of a creation names it, and main and remote Pianos run one revision, so one naming
 *   nothing (a read-back's capacity or a peer's scope) says nothing about the creation.
 * - `error` naming the input: Piano refused the first input of a session it created (the frame
 *   names that session). Any other `error`, like any `selection_failed`, may follow the creation
 *   and its input's delivery.
 */
export const creationVerdictOf = (
  frame: CreationResultFrame,
  { attemptId, sessionNamed }: CreationContext,
): CreationVerdict => {
  const detail = frame.message;
  if (frame._tag === "selection_rejected") {
    if (sessionNamed) return { kind: "created_uncertain", detail };
    return (frame.inputId ?? frame.selectionId) === attemptId
      ? { kind: "refused", detail }
      : { kind: "uncertain", detail };
  }
  if (frame._tag === "error" && frame.inputId !== undefined && frame.inputId === attemptId)
    return { kind: "created_not_sent", detail };
  return sessionNamed ? { kind: "created_uncertain", detail } : { kind: "uncertain", detail };
};
