import type { RadiusSetupState } from "@shared/features/radius/radius";

type Installation = RadiusSetupState["installation"];

export interface RadiusProgress {
  installation: Installation["status"] | undefined;
  finished: "install" | "uninstall" | undefined;
  configured: boolean | undefined;
}

export type RadiusObservation =
  | { kind: "observed"; installation: Installation; manual?: boolean }
  | { kind: "settled"; configured: boolean };

export const RADIUS_PROGRESS: RadiusProgress = {
  installation: undefined,
  finished: undefined,
  configured: undefined,
};

export function radiusAnnouncements(
  prev: RadiusProgress,
  next: RadiusObservation,
): { progress: RadiusProgress; message?: string } {
  if (next.kind === "observed") {
    const { status, action } = next.installation;
    const finished =
      prev.installation === "running" && status === "success" ? action : prev.finished;
    const progress = { ...prev, installation: status, finished };
    return next.manual && status !== "running" && !finished
      ? { progress, message: "Radius setup refreshed." }
      : { progress };
  }
  const progress = { ...prev, finished: undefined, configured: next.configured };
  if (prev.configured === false && next.configured)
    return { progress, message: "All set. New Pi sessions can use Radius tools and web search." };
  if (prev.finished === "install")
    return { progress, message: "Web search installed. Start a new session to use it." };
  if (prev.finished === "uninstall")
    return { progress, message: "Web search uninstalled for new sessions." };
  return { progress };
}
