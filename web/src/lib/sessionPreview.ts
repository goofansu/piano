/**
 * The selected session's managed app, as the session header, palette and Archive/Delete show it.
 * An app belongs to one live Pi generation (ADR 0003): a saved, closed or peeked session has none,
 * and its old links in the transcript are not a running preview. Nothing here starts Pi or an app.
 */
// Relative, not @shared: module tests load this file directly in Node.
import type { ClientCommand, SessionPreview } from "../../../shared/wire.ts";
import { type AppState, isSession } from "../store.ts";
import { hostOf, type SessionRef, sessionReady } from "./sessionContext.ts";

/** The selected session's app while its live generation owns one. */
export function selectedPreview(state: AppState): SessionPreview | undefined {
  const session = state.session;
  if (!session?.hosted || !session.sessionId || session.state.closure) return undefined;
  const preview = session.state.preview;
  if (!preview || sessionReady(state)) return preview;
  // Losing the browser attachment says nothing about the server-owned app's lifetime.
  return {
    ...preview,
    state: "unknown",
    ready: false,
    url: null,
    detail: "",
  };
}

/** Ending this session's Pi would stop an app it owns: the selected one, or a background host. */
export function sessionHasPreview(state: AppState, target: SessionRef): boolean {
  const session = state.session;
  if (isSession(session, target)) return !!selectedPreview(state);
  return !!hostOf(state, target)?.preview;
}

export type PreviewTone = "ready" | "pending" | "problem" | "idle";

/** How the header names an app: a short label, a tone for its icon, and one line of status. */
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
    // Its process runs, but the local check got no usable answer from the app.
    case "running":
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
export const PREVIEW_STATUS: ClientCommand = { _tag: "act", action: { _tag: "preview_status" } };

/** Stop exactly this instance; a replacement is left alone. */
export const stopPreview = (preview: Pick<SessionPreview, "instanceId">): ClientCommand => ({
  _tag: "act",
  action: { _tag: "preview_stop", instanceId: preview.instanceId },
});
