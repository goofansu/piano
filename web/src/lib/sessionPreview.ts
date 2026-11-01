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

/** Hosts browsers treat as potentially trustworthy, so an HTTPS page may still frame them. */
const loopback = (hostname: string) =>
  hostname === "localhost" ||
  hostname.endsWith(".localhost") ||
  hostname === "[::1]" ||
  /^127(\.\d{1,3}){3}$/.test(hostname);

/** Only a registered, ready HTTP page on a different origin may be embedded (INV-11).
 * An HTTPS Piano never frames a plain-HTTP remote app: the browser would block it as mixed content.
 * This is a browser policy check, not a hostile-code sandbox or proof of framing/authentication.
 */
export function previewFrameUrl(
  preview: SessionPreview | undefined,
  controlOrigin: string,
): string | null {
  if (!preview?.ready || preview.state !== "running" || !preview.url) return null;
  try {
    const url = new URL(preview.url);
    const control = new URL(controlOrigin);
    const mixed =
      control.protocol === "https:" && url.protocol === "http:" && !loopback(url.hostname);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      !mixed &&
      url.origin !== control.origin
      ? preview.url
      : null;
  } catch {
    return null;
  }
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
