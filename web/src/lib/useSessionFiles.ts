import type { Workspace, WorkspaceIgnoredFiles } from "@shared/wire";
import { useMemo, useRef } from "react";
import type { SessionView } from "../store.ts";
import { workspaceIgnoredFiles } from "./api.ts";
import { type SessionFile, sessionFiles, visibleFiles } from "./sessionFiles.ts";
import { useObservation } from "./useObservation.ts";

/**
 * The files a session wrote or edited that follow the workspace's `.gitignore`: Git decides
 * (INV-01), read afresh whenever the set of paths changes and on focus. Until the next answer the
 * last one still applies, so a known ignored file never flashes back; a path the last answer did
 * not cover shows until Git says otherwise. Without a Git workspace every file shows.
 */
export function useSessionFiles(
  session: SessionView | null,
  workspace: Workspace | undefined,
  { enabled = true }: { enabled?: boolean } = {},
): SessionFile[] {
  const messages = session?.messages;
  const files = useMemo(() => sessionFiles(messages ?? []), [messages]);
  const key =
    workspace && files.length
      ? JSON.stringify([workspace.id, workspace.path, files.map((file) => file.path)])
      : null;
  const { value } = useObservation<WorkspaceIgnoredFiles>(
    key,
    async (signal, k) => {
      const [id, path, paths] = JSON.parse(k) as [string, string, string[]];
      const answer = await workspaceIgnoredFiles(id, paths, { signal });
      // A response for another workspace never shows (INV-07).
      if (answer.workspace.id !== id || answer.workspace.path !== path)
        throw new Error("Files returned a different workspace.");
      return answer;
    },
    { enabled, focus: true },
  );
  const last = useRef<WorkspaceIgnoredFiles>(undefined);
  if (value) last.current = value;
  const known = workspace ? (value ?? last.current) : undefined;
  return useMemo(() => visibleFiles(files, known, workspace), [files, known, workspace]);
}
