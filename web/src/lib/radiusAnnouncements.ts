/**
 * Which Radius setup toast, if any, a new observation earns. Web-search changes finish in the
 * background, so a change seen to finish is remembered until the page settles and can announce it.
 * Completing setup is announced only when it turns complete while the page is open, not each time
 * a complete setup is opened, and it outranks the install that completed it: one toast per change.
 * Nothing here depends on React.
 */
import type { RadiusSetupState } from "@shared/radius";

type Installation = RadiusSetupState["installation"];

export interface RadiusProgress {
  /** The installation status last observed. */
  installation: Installation["status"] | undefined;
  /** A web-search change seen to finish and not yet announced. */
  finished: "install" | "uninstall" | undefined;
  /** Whether setup was complete when the page last settled; `undefined` before it first settles. */
  configured: boolean | undefined;
}

export type RadiusObservation =
  /** A setup state read or returned by a change; `manual` when the user asked for the read. */
  | { kind: "observed"; installation: Installation; manual?: boolean }
  /** Nothing is loading, running or failing; `configured` says whether setup is complete. */
  | { kind: "settled"; configured: boolean };

export const RADIUS_PROGRESS: RadiusProgress = { installation: undefined, finished: undefined, configured: undefined };

export function radiusAnnouncements(prev: RadiusProgress, next: RadiusObservation): { progress: RadiusProgress; message?: string } {
  if (next.kind === "observed") {
    const { status, action } = next.installation;
    const finished = prev.installation === "running" && status === "success" ? action : prev.finished;
    const progress = { ...prev, installation: status, finished };
    // A running or just-finished web-search change gets its own toast once it settles.
    return next.manual && status !== "running" && !finished ? { progress, message: "Radius setup refreshed." } : { progress };
  }
  const progress = { ...prev, finished: undefined, configured: next.configured };
  if (prev.configured === false && next.configured) return { progress, message: "All set. New Pi sessions can use Radius tools and web search." };
  if (prev.finished === "install") return { progress, message: "Web search installed. Start a new session to use it." };
  if (prev.finished === "uninstall") return { progress, message: "Web search uninstalled for new sessions." };
  return { progress };
}
