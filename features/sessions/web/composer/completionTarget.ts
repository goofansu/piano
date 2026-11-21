import { directoryTrust } from "../../../../web/src/shared/state/directoryTrust.ts";
import {
  focusedDirectory,
  sessionReady,
  workspaceFor,
} from "../../../../web/src/shared/state/sessionContext.ts";
import type { AppState } from "../../../../web/src/shared/state/state.ts";
export interface CompletionTarget {
  cwd: string;
  session?: { workspaceId: string; sessionId: string };
  revision: string;
}

export function completionTarget(state: AppState): CompletionTarget | undefined {
  const focus = focusedDirectory(state);
  const session = state.view.kind === "session" ? state.session : null;
  if (!focus || !state.connected || (session && !sessionReady(state))) return undefined;
  const revision = [
    state.selectionId,
    session?.cursor?.generation,
    session?.hosted,
    directoryTrust(state, focus.cwd)?.trusted,
    state.catalogs[focus.cwd]?.fetchedAt,
  ].join(":");
  if (!session?.hosted || !session.sessionId) return { cwd: focus.cwd, revision };
  const workspaceId = workspaceFor(state, session.cwd)?.id;
  return workspaceId
    ? { cwd: focus.cwd, session: { workspaceId, sessionId: session.sessionId }, revision }
    : undefined;
}
