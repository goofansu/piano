import type { Workspace, WorkspaceIgnoredFiles } from "@shared/wire";
import { createContext, useContext, useMemo, useRef } from "react";
import type { AppState, SessionView } from "../store.ts";
import { workspaceIgnoredFiles } from "./api.ts";
import { refreshKey } from "./changesView.ts";
import { sessionContext } from "./sessionContext.ts";
import { type SessionFile, sessionFiles, visibleFiles } from "./sessionFiles.ts";
import { useObservation } from "./useObservation.ts";

/**
 * The files the selected session wrote or edited that follow its workspace's `.gitignore` and still
 * exist, decided once for every surface that lists them (the composer's Files popover and the
 * palette's Files group), so they agree and Git is asked once. Git decides (INV-01), read afresh
 * whenever the set of paths changes, after a tool call that may have moved the checkout, and on
 * focus; its answer also names the file each path places to, so one file
 * edited under several spellings is one entry. Until the next answer the last one still applies, so a known
 * ignored file never flashes back; a path the last answer did not cover shows until Git says
 * otherwise. Without a Git workspace, or after a failed read, every file shows until a successful
 * read restores filtering. The app provides it through `SessionFilesContext`.
 */
export function useSessionFilesController(state: AppState): SessionFile[] {
  return useVisibleFiles(state.session, sessionContext(state).changesWorkspace);
}

export const SessionFilesContext = createContext<SessionFile[] | null>(null);

/** The selected session's files as `useSessionFilesController` decided them. */
export function useSessionFiles(): SessionFile[] {
  const files = useContext(SessionFilesContext);
  if (!files) throw new Error("useSessionFiles needs SessionFilesContext");
  return files;
}

function useVisibleFiles(
  session: SessionView | null,
  workspace: Workspace | undefined,
): SessionFile[] {
  const messages = session?.messages;
  const files = useMemo(() => sessionFiles(messages ?? []), [messages]);
  const key =
    workspace && files.length
      ? JSON.stringify([workspace.id, workspace.path, files.map((file) => file.path)])
      : null;
  const { value, error } = useObservation<WorkspaceIgnoredFiles>(
    key,
    async (signal, k) => {
      const [id, path, paths] = JSON.parse(k) as [string, string, string[]];
      const answer = await workspaceIgnoredFiles(id, paths, { signal });
      // A response for another workspace never shows (INV-07).
      if (answer.workspace.id !== id || answer.workspace.path !== path)
        throw new Error("Files returned a different workspace.");
      return answer;
    },
    { focus: true, trigger: refreshKey(session), debounce: 600 },
  );
  const last = useRef<WorkspaceIgnoredFiles>(undefined);
  // Observation normally retains stale data on transport failure. Files instead fail open,
  // just as for a Git error response; discard the fallback too so a new path cannot revive it.
  if (error !== undefined) last.current = undefined;
  else if (value) last.current = value;
  const known = error === undefined ? (value ?? last.current) : undefined;
  return useMemo(() => visibleFiles(files, known, workspace), [files, known, workspace]);
}
