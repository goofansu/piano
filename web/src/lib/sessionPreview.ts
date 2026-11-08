/**
 * The selected session's managed app: which one the store records, and how inspection names it;
 * what the page shows of it is `seenPreview` (previewObservation).
 * An app belongs to one live Pi generation (ADR 0003): a saved, closed or peeked session has none,
 * and its old links in the transcript are not a running preview. Nothing here starts Pi or an app.
 */
// Relative, not @shared: module tests load this file directly in Node.
import type { ClientCommand, SessionPreview } from "../../../shared/wire.ts";
import { type AppState, isSession } from "../store.ts";
import { hostOf, type SessionRef } from "./sessionContext.ts";

/**
 * The app the selected session's live generation owns, as the store last recorded it. Only for
 * its identity (which instance, whether there is one): its status may be one this page cannot
 * vouch for. What the page shows of the app is `seenPreview` (previewObservation).
 */
export function hostedPreview(state: AppState): SessionPreview | undefined {
  const session = state.session;
  if (!session?.hosted || !session.sessionId || session.state.closure) return undefined;
  return session.state.preview;
}

/**
 * The app on screen when a preview action was chosen: the selection showing it, the Pi generation
 * that owns it (ADR 0003) and its instance. A later Stop or Preview details acts on that app only.
 */
export interface PreviewClaim {
  instanceId: string;
  selectionId: string | null;
  generation: string | null;
}

/** Claims the selected session's app as it is now; none when it has none. */
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

/**
 * Whether the app `claim` named is still the one on screen: the same selection, the same Pi
 * generation and the same instance. A new attachment, a restarted Pi or a replaced app each end it.
 */
export function previewClaimHolds(state: AppState, claim: PreviewClaim): boolean {
  const now = previewClaim(state);
  return (
    !!now &&
    now.instanceId === claim.instanceId &&
    now.selectionId === claim.selectionId &&
    now.generation === claim.generation
  );
}

/** Ending this session's Pi would stop an app it owns: the selected one, or a background host. */
export function sessionHasPreview(state: AppState, target: SessionRef): boolean {
  const session = state.session;
  if (isSession(session, target)) return !!hostedPreview(state);
  return !!hostOf(state, target)?.preview;
}

export type PreviewTone = "ready" | "pending" | "problem" | "idle";

/** How inspection names an app: a short label, a dot tone, and one line of status. */
export interface PreviewFace {
  label: string;
  tone: PreviewTone;
  status: string;
}

/** `localhost:5173` for a URL; the URL itself when it cannot be parsed. */
export function previewHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function previewFace(preview: SessionPreview): PreviewFace {
  if (preview.url) return { label: "Preview", tone: "ready", status: "Running" };
  switch (preview.state) {
    case "starting":
      return { label: "Starting…", tone: "pending", status: "Starting" };
    case "stopping":
      return { label: "Stopping…", tone: "pending", status: "Stopping" };
    // Its process runs and has not answered yet; Piano keeps checking.
    case "running":
      if (preview.warming)
        return { label: "Warming up…", tone: "pending", status: "Running, warming up" };
      // Its process runs, but the local check got no usable answer within its warm-up window.
      return { label: "Not ready", tone: "problem", status: "Running, not answering" };
    case "failed":
      return { label: "Failed", tone: "problem", status: "Failed" };
    case "exited":
      return { label: "Exited", tone: "idle", status: "Exited" };
    case "not-loaded":
      return { label: "Stopped", tone: "idle", status: "Not running" };
    case "unknown":
      return { label: "Unknown", tone: "problem", status: "Status unavailable" };
  }
}

/** Where opening the link works, from what Piano checked; never a claim it did not observe. */
export function previewAccess(preview: SessionPreview): string {
  return preview.externalAccess === "same-host"
    ? "Opens on the computer running Piano."
    : "Checked on the server. Opening it uses your private exe.dev access.";
}

/** Re-observe the selected session's app; it never starts Pi or launches anything. */
export const previewStatus = (requestId: string): ClientCommand => ({
  _tag: "act",
  action: { _tag: "preview_status", requestId },
});

/** Stop exactly this instance; a replacement is left alone. */
export const stopPreview = (preview: Pick<SessionPreview, "instanceId">): ClientCommand => ({
  _tag: "act",
  action: { _tag: "preview_stop", instanceId: preview.instanceId },
});
