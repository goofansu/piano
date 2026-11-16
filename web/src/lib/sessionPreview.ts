import type { ClientCommand, SessionPreview } from "../../../shared/wire.ts";
import { type AppState, isSession } from "../store.ts";
import { hostOf, type SessionRef } from "./sessionContext.ts";

export function hostedPreview(state: AppState): SessionPreview | undefined {
  const session = state.session;
  if (!session?.hosted || !session.sessionId || session.state.closure) return undefined;
  return session.state.preview;
}

export interface PreviewClaim {
  instanceId: string;
  selectionId: string | null;
  generation: string | null;
}

export function previewClaim(state: AppState): PreviewClaim | undefined {
  const preview = hostedPreview(state);
  return (
    preview && {
      instanceId: preview.instanceId,
      selectionId: state.selectionId,
      generation: state.session?.cursor?.generation ?? null,
    }
  );
}

export function previewClaimHolds(state: AppState, claim: PreviewClaim): boolean {
  const now = previewClaim(state);
  return (
    !!now &&
    now.instanceId === claim.instanceId &&
    now.selectionId === claim.selectionId &&
    now.generation === claim.generation
  );
}

export function sessionHasPreview(state: AppState, target: SessionRef): boolean {
  const session = state.session;
  if (isSession(session, target)) return !!hostedPreview(state);
  return !!hostOf(state, target)?.preview;
}

export type PreviewTone = "ready" | "pending" | "problem" | "idle";

export interface PreviewFace {
  tone: PreviewTone;
  status: string;
}

export function previewHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function previewFace(preview: SessionPreview): PreviewFace {
  if (preview.url) return { tone: "ready", status: "Running" };
  switch (preview.state) {
    case "starting":
      return { tone: "pending", status: "Starting" };
    case "stopping":
      return { tone: "pending", status: "Stopping" };
    case "running":
      if (preview.warming) return { tone: "pending", status: "Running, warming up" };
      return { tone: "problem", status: "Running, not answering" };
    case "failed":
      return { tone: "problem", status: "Failed" };
    case "exited":
      return { tone: "idle", status: "Exited" };
    case "not-loaded":
      return { tone: "idle", status: "Not running" };
    case "unknown":
      return { tone: "problem", status: "Status unavailable" };
  }
}

export function previewAccess(preview: SessionPreview): string {
  return preview.externalAccess === "same-host"
    ? "Opens on the computer running Piano."
    : "Checked on the server. Opening it uses your private exe.dev access.";
}

export const previewStatus = (requestId: string): ClientCommand => ({
  _tag: "act",
  action: { _tag: "preview_status", requestId },
});

export const stopPreview = (preview: Pick<SessionPreview, "instanceId">): ClientCommand => ({
  _tag: "act",
  action: { _tag: "preview_stop", instanceId: preview.instanceId },
});
