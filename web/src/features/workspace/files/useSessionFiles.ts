import type { Workspace, WorkspaceWrittenFiles } from "@shared/wire";
import { createContext, useContext, useMemo, useRef } from "react";
import type { AppState, SessionView } from "../../../app/store.ts";
import { useObservation } from "../../../shared/lib/useObservation.ts";
import { sessionContext } from "../../sessions/sessionContext.ts";
import { refreshKey } from "../changes/changesView.ts";
import { workspaceWrittenFiles } from "./fileApi.ts";
import { type SessionFile, sessionFiles, visibleFiles } from "./sessionFiles.ts";

export function useSessionFilesController(state: AppState): SessionFile[] {
  return useVisibleFiles(state.session, sessionContext(state).changesWorkspace);
}

export const SessionFilesContext = createContext<SessionFile[] | null>(null);

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
      const [asked, paths] = JSON.parse(k) as [Workspace, string[]];
      return workspaceWrittenFiles(asked, paths, { signal });
    },
    { focus: true, trigger: refreshKey(session), debounce: 600 },
  );
  const last = useRef<WorkspaceWrittenFiles>(undefined);
  if (error !== undefined) last.current = undefined;
  else if (value) last.current = value;
  const known = error === undefined ? (value ?? last.current) : undefined;
  return useMemo(() => visibleFiles(files, known, workspace), [files, known, workspace]);
}
