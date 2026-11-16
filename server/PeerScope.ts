import { type ClientMessage, sameSession } from "../shared/wire.ts";
import type { Selection } from "./ClientSessions.ts";
import { inOpenFolder, type RegistryData } from "./Registry.ts";

type Request = Exclude<ClientMessage, { _tag: "ack" }>;
type Act = Extract<Request, { _tag: "act" }>;
type Create = Extract<Request, { _tag: "create_session" }>;

export type PeerVerdict = "admit" | "refuse";

export const registered = (data: RegistryData, cwd: string) =>
  data.workspaces.some((workspace) => workspace.path === cwd);
const listed = (data: RegistryData, cwd: string, sessionId: string) =>
  registered(data, cwd) && data.sessions.some((entry) => sameSession(entry, { cwd, sessionId }));
export const inputTarget = (data: RegistryData, cwd: string, sessionId: string | null) =>
  sessionId === null ? inOpenFolder(data, cwd) : listed(data, cwd, sessionId);

function actionAllowed({ action, start }: Act): boolean {
  if (start?.name !== undefined || start?.dispatchedFrom !== undefined) return false;
  switch (action._tag) {
    case "prompt":
    case "steer":
      return !action.attachments?.length;
    case "stop":
    case "abort":
    case "restore_queue":
    case "set_model":
    case "set_thinking_level":
    case "answer":
      return true;
    default:
      return false;
  }
}

function creationAllowed({ inheritProject, worktree, attachments, options }: Create) {
  return (
    !inheritProject &&
    worktree === undefined &&
    !attachments?.length &&
    options.name === undefined &&
    options.dispatchedFrom === undefined
  );
}

export function peerVerdict(
  data: RegistryData,
  request: Request,
  selection: Selection | null,
): PeerVerdict {
  switch (request._tag) {
    case "ping":
    case "registry":
      return "admit";
    case "models":
    case "directory":
      return registered(data, request.cwd) ? "admit" : "refuse";
    case "set_trust":
      return registered(data, request.path) ? "admit" : "refuse";
    case "select":
      return request.attemptId && request.sessionId === null
        ? registered(data, request.cwd)
          ? "admit"
          : "refuse"
        : request.sessionId !== null && listed(data, request.cwd, request.sessionId)
          ? "admit"
          : "refuse";
    case "update_project":
    case "delete_project":
    case "set_project_done":
      return "admit";
    case "save_project":
      return !request.assign || listed(data, request.assign.cwd, request.assign.sessionId)
        ? "admit"
        : "refuse";
    case "assign_project":
    case "rename_session":
    case "pin_session":
    case "archive_session":
    case "delete_session":
      return listed(data, request.cwd, request.sessionId) ? "admit" : "refuse";
    case "create_session":
      return inOpenFolder(data, request.cwd) && creationAllowed(request) ? "admit" : "refuse";
    case "act":
      return selection?.selectionId === request.selectionId &&
        inputTarget(data, selection.cwd, selection.sessionId) &&
        actionAllowed(request)
        ? "admit"
        : "refuse";
    default:
      return "refuse";
  }
}
