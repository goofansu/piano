import { toast } from "sonner";
import { ChangesPanel } from "@/components/Changes";
import { WorkspaceFile } from "@/components/WorkspaceFile";
import { drafts, sessionDraftKey } from "@/lib/messageDraft";
import { sessionContext } from "@/lib/sessionContext";
import { useNavigation } from "@/lib/useNavigation";
import { type AppState, sessionKey } from "@/store";

/** What the right sidebar shows for the selected session: its Changes, or a file a link opened.
 * Keyed by session, workspace and path, so a new destination never flashes old content. */
export function SessionPanel({ state }: { state: AppState }) {
  const { settings, sidebar: panel, openPanel, closeSidebar } = useNavigation();
  const t = state.session;
  if (settings || !t || !panel) return null;
  const { workspace, changesWorkspace } = sessionContext(state);
  const draftKey = sessionDraftKey(t);
  if (panel === "changes")
    return (
      <ChangesPanel
        key={sessionKey(t)}
        workspace={changesWorkspace}
        session={t}
        close={closeSidebar}
        onAsk={(text) => {
          if (!draftKey) return;
          drafts.paragraph(draftKey, text);
          toast.success("Added to your message");
        }}
      />
    );
  return (
    <WorkspaceFile
      key={`${workspace?.id}:${sessionKey(t)}:${panel.path}`}
      workspaceId={workspace?.id}
      file={panel}
      open={(path) => openPanel({ kind: "file", path })}
      close={closeSidebar}
    />
  );
}
