/**
 * What another machine's Piano may ask of this one through `/ws/peer` (ADR 0004). This Piano owns
 * the sessions, so it decides here, and answers a refusal with the request's ordinary reply in
 * the delivery sequence: the gateway in front stays a pipe that never injects or renumbers frames.
 *
 * The slice lists registered sessions, opens them, sends text, answers dialogs and stops. Remote
 * creation, files, worktrees and settings (trust included: trusting a folder runs its project
 * extensions here) are not offered.
 */
import { type ClientMessage, sameSession } from "../shared/wire.ts";
import type { RegistryData } from "./Registry.ts";

type Request = Exclude<ClientMessage, { _tag: "ack" }>;
type Act = Extract<Request, { _tag: "act" }>;

/** The session a peer connection last selected, for checking its actions. */
export interface PeerSelection {
  readonly selectionId: string;
  readonly cwd: string;
  readonly sessionId: string;
}

/**
 * - `admit`: run as for a browser on this machine;
 * - `skip`: drop silently: a read about a folder no longer registered here, which a reconnecting
 *   browser may still ask about before the fresh registry refocuses it;
 * - `refuse`: answer with the request's ordinary unanswered reply.
 */
export type PeerVerdict = "admit" | "skip" | "refuse";

const registered = (data: RegistryData, cwd: string) =>
  data.workspaces.some((workspace) => workspace.path === cwd);
const listed = (data: RegistryData, cwd: string, sessionId: string) =>
  registered(data, cwd) && data.sessions.some((entry) => sameSession(entry, { cwd, sessionId }));

/** Restarting a listed session is allowed; renaming it, inventing ancestry or attaching files is not. */
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
    case "act":
      return selection?.selectionId === request.selectionId &&
        listed(data, selection.cwd, selection.sessionId) &&
        actionAllowed(request)
        ? "admit"
        : "refuse";
    default:
      return "refuse";
  }
}
