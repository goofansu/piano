import { abbrevHome, branchLabel } from "../../../../web/src/shared/lib/format.ts";
import { findProject } from "../../../../web/src/shared/lib/projects.ts";
import { sessionDirectories } from "../../../../web/src/shared/state/sessionCatalog.ts";
import { checkoutMissingAt } from "../../../../web/src/shared/state/sessionContext.ts";
import type { AppState } from "../../../../web/src/shared/state/state.ts";
export type DirectoryTrigger =
  | { kind: "none" }
  | { kind: "checkout"; folder: string; branchLabel?: string }
  | { kind: "path"; label: string };

export interface DirectoryRoot {
  path: string;
  label: string;
  selected: boolean;
}

export interface DirectoryChoices {
  trigger: DirectoryTrigger;
  roots: DirectoryRoot[];
}

export function startPlace(
  state: AppState,
  cwd: string,
  projectId: string | undefined,
): { project?: string; folder?: string; branch?: string } {
  const { checkout, folderName } = sessionDirectories(state)(cwd || undefined);
  return {
    project: findProject(state, projectId)?.name,
    folder: folderName || undefined,
    branch: checkout?.branch ?? undefined,
  };
}

export function directoryChoices(state: AppState, cwd: string): DirectoryChoices {
  const { folder, checkout } = sessionDirectories(state)(cwd || undefined);
  const trigger: DirectoryTrigger = !cwd
    ? { kind: "none" }
    : folder && checkout
      ? {
          kind: "checkout",
          folder: folder.name,
          ...(!checkout.root && {
            branchLabel: branchLabel(checkout.branch, checkout.facts?.detached ?? false),
          }),
        }
      : state.registryLoaded
        ? { kind: "path", label: abbrevHome(cwd) }
        : { kind: "checkout", folder: cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd };
  const roots = state.folders.flatMap((f) =>
    f.worktrees
      .filter((w) => w.root && !checkoutMissingAt(state, w.path))
      .map((w) => ({
        path: w.path,
        label: f.name,
        selected: w.path === cwd,
      })),
  );
  return { trigger, roots };
}
