import type { ServerMessage } from "../../wire.ts";

export type CreationResultFrame = Extract<
  ServerMessage,
  { _tag: "selection_rejected" | "selection_failed" | "error" }
>;

export interface CreationContext {
  readonly attemptId: string;
  readonly sessionNamed: boolean;
}

export type CreationVerdict =
  | { readonly kind: "refused"; readonly detail: string }
  | { readonly kind: "created_not_sent"; readonly detail: string }
  | { readonly kind: "created_uncertain"; readonly detail: string }
  | { readonly kind: "uncertain"; readonly detail: string };

export const refusedAttempt = (frame: ServerMessage): string | undefined =>
  frame._tag === "selection_rejected" ? frame.inputId : undefined;

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
