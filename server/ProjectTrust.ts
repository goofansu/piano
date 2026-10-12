/**
 * Pi's project trust, read and written through Pi's own store so a terminal Pi
 * and Piano agree. Pi resolves the decision when a child starts: the nearest
 * saved entry for the directory or an ancestor, else the global
 * `defaultProjectTrust` setting, which headless RPC treats as untrusted unless
 * it is "always". Piano never passes `--approve`; it records the decision.
 */

import {
  getAgentDir,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Data, Effect } from "effect";
import type { ProjectTrust } from "../shared/wire.ts";

const store = () => new ProjectTrustStore(getAgentDir());

/** What Pi will do with `cwd`'s protected resources when a session starts there. */
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
      // An unreadable directory or trust file means Pi skips protected resources.
      return { required: true, trusted: false };
    }
  });

export class ProjectTrustError extends Data.TaggedError("ProjectTrustError")<{
  readonly detail: string;
}> {}

/** Save an explicit decision for `cwd` in Pi's trust file; applies to sessions started afterwards. */
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
