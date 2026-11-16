import {
  getAgentDir,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Data, Effect } from "effect";
import type { ProjectTrust } from "../shared/wire.ts";

const store = () => new ProjectTrustStore(getAgentDir());

export const projectTrust = (cwd: string): Effect.Effect<ProjectTrust> =>
  Effect.sync(() => {
    try {
      const required = hasTrustRequiringProjectResources(cwd);
      if (!required) return { required: false, trusted: true };
      const saved = store().get(cwd);
      if (saved !== null) return { required: true, trusted: saved };
      return {
        required: true,
        trusted: SettingsManager.create(cwd, getAgentDir()).getDefaultProjectTrust() === "always",
      };
    } catch {
      return { required: true, trusted: false };
    }
  });

export class ProjectTrustError extends Data.TaggedError("ProjectTrustError")<{
  readonly detail: string;
}> {}

export const setProjectTrust = (
  cwd: string,
  trusted: boolean,
): Effect.Effect<void, ProjectTrustError> =>
  Effect.try({
    try: () => store().set(cwd, trusted),
    catch: (e) =>
      new ProjectTrustError({
        detail: `Could not save the trust decision: ${e instanceof Error ? e.message : String(e)}`,
      }),
  });
