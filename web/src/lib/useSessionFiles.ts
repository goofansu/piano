import type { Workspace, WorkspaceWrittenFiles } from "@shared/wire";
import { createContext, useContext, useMemo, useRef } from "react";
import type { AppState, SessionView } from "../store.ts";
import { workspaceWrittenFiles } from "./api.ts";
import { refreshKey } from "./changesView.ts";
import { sessionContext } from "./sessionContext.ts";
import { type SessionFile, sessionFiles, visibleFiles } from "./sessionFiles.ts";
import { useObservation } from "./useObservation.ts";

/**
 * The files the selected session wrote or edited that follow its workspace's `.gitignore` and still
 * exist, decided once (the session rail's Outputs), so Git is asked once. Git decides (INV-01), read afresh
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
      ? JSON.stringify([
          { id: workspace.id, folder: workspace.folder, path: workspace.path },
          files.map((file) => file.path),
        ])
      : null;
  const { value, error } = useObservation<WorkspaceWrittenFiles>(
    key,
    async (signal, k) => {
      // The adapter refuses a reply naming another workspace (INV-07).
      const [asked, paths] = JSON.parse(k) as [Workspace, string[]];
      return workspaceWrittenFiles(asked, paths, { signal });
    },
    { focus: true, trigger: refreshKey(session), debounce: 600 },
  );
  const last = useRef<WorkspaceWrittenFiles>(undefined);
  // Observation normally retains stale data on transport failure. Files instead fail open,
  // just as for a Git error response; discard the fallback too so a new path cannot revive it.
  if (error !== undefined) last.current = undefined;
  else if (value) last.current = value;
  const known = error === undefined ? (value ?? last.current) : undefined;
  return useMemo(() => visibleFiles(files, known, workspace), [files, known, workspace]);
}
