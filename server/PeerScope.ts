/**
 * What another machine's Piano may ask of this one through `/ws/peer` (ADR 0004). This Piano owns
 * the sessions, so it decides here, and answers a refusal with the request's ordinary reply in
 * the delivery sequence: the gateway in front stays a pipe that never injects or renumbers frames.
 *
 * The slice lists registered sessions, opens them, starts a session in a registered folder or
 * worktree, sends text/prepared raster images, answers dialogs and stops. Files, worktree creation,
 * projects and settings (trust included: trusting a folder runs its project extensions here) are
 * not offered.
 */
import { type ClientMessage, sameSession } from "../shared/wire.ts";
import type { RegistryData } from "./Registry.ts";

type Request = Exclude<ClientMessage, { _tag: "ack" }>;
type Act = Extract<Request, { _tag: "act" }>;
type Create = Extract<Request, { _tag: "create_session" }>;

/**
 * The session a peer connection last selected or created, for checking its actions. A creation
 * has no session ID until Pi names it; its selection then shows only the session it created.
 */
export interface PeerSelection {
  readonly selectionId: string;
  readonly cwd: string;
  readonly sessionId: string | null;
}

/**
 * - `admit`: run as for a browser on this machine;
 * - `skip`: drop silently: a read about a folder no longer registered here, which a reconnecting
 *   browser may still ask about before the fresh registry refocuses it;
 * - `refuse`: answer with the request's ordinary unanswered reply.
 */
export type PeerVerdict = "admit" | "skip" | "refuse";

/** A folder or worktree registered on this machine: the only directories a peer may ask about. */
export const registered = (data: RegistryData, cwd: string) =>
  data.workspaces.some((workspace) => workspace.path === cwd);
const listed = (data: RegistryData, cwd: string, sessionId: string) =>
  registered(data, cwd) && data.sessions.some((entry) => sameSession(entry, { cwd, sessionId }));

/** Inline remote images stay forbidden: ClientDispatch resolves prepared references after this check. */
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

/**
 * A new session starts where it is asked, as this machine's own browser would start it, but adds
 * nothing else here: no worktree, project membership, name, ancestry or inline attachments.
 */
function creationAllowed({ projectId, inheritProject, worktree, attachments, options }: Create) {
  return (
    projectId === undefined &&
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
  selection: PeerSelection | undefined,
): PeerVerdict {
  switch (request._tag) {
    case "ping":
    case "registry":
      return "admit";
    case "models":
    case "trust":
      return registered(data, request.cwd) ? "admit" : "skip";
    case "select":
      return request.sessionId !== null && listed(data, request.cwd, request.sessionId)
        ? "admit"
        : "refuse";
    case "create_session":
      return registered(data, request.cwd) && creationAllowed(request) ? "admit" : "refuse";
    case "act":
      return selection?.selectionId === request.selectionId &&
        (selection.sessionId === null
          ? registered(data, selection.cwd)
          : listed(data, selection.cwd, selection.sessionId)) &&
        actionAllowed(request)
        ? "admit"
        : "refuse";
    default:
      return "refuse";
  }
}
