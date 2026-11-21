import {
  type RenderMsg,
  type StartOptions,
  type DisconnectReason,
  type FolderView,
  type HostInfo,
  type ModelCatalog,
  type Project,
  type ProjectTrust,
  type ServerMessage,
  type SessionCursor,
  type SessionReference,
  type Snapshot,
  type Workspace,
  sameSession,
  sessionKey as wireSessionKey,
} from "../../../../shared/wire.ts";

export type SubmissionPhase =
  | "starting"
  | "submitting"
  | "submitted"
  | "handled"
  | "rejected"
  | "not_sent"
  | "uncertain";

export interface TrustDecision {
  cwd: string;
  requestId: string;
  trusted: boolean;
  shown: ProjectTrust | undefined;
  status: "pending" | "unconfirmed";
}

export type TrustDecisionAction =
  | { type: "trust_decision"; cwd: string; requestId: string; trusted: boolean }
  | { type: "trust_settled"; requestId: string; unconfirmed: boolean };

export type UnavailableSessionReason = "missing" | "history" | "archived";

export interface PendingCreate {
  attemptId: string;
  cwd: string;
  projectId?: string;
  options?: StartOptions;
  text: string;
  attachments?: RenderMsg["attachments"];
  outcome: Exclude<SubmissionPhase, "submitting">;
  submissionId?: number;
  detail?: string;
}

export interface SessionView extends Snapshot {
  cwd: string;
  sessionId: string | null;
  hosted: boolean;
  cursor: SessionCursor | null;
}

export interface AppState {
  connected: boolean;
  reconnecting: boolean;
  selectionId: string | null;
  resync: boolean;
  view: { kind: "session" } | Page;
  folders: FolderView[];
  projects: Project[];
  sessionReferences: SessionReference[];
  workspaces: Workspace[];
  registryLoaded: boolean;
  hosts: HostInfo[];
  hostsCurrent: boolean;
  catalogs: Record<string, ModelCatalog>;
  catalogRevision: number;
  trusts: Record<string, ProjectTrust>;
  trustDecisions: readonly TrustDecision[];
  session: SessionView | null;
  selecting: { cwd: string; sessionId: string | null } | null;
  selectionFailure: { cwd: string; sessionId: string | null; message: string } | null;
  pendingCreate: PendingCreate | null;
  done: string[];
}

export type Page =
  | { kind: "new"; cwd?: string; projectId?: string }
  | { kind: "projects" }
  | { kind: "project"; projectId: string; cwd?: string }
  | { kind: "missing-session"; sessionId: string; reason: UnavailableSessionReason };

export const sessionKey = (s: { cwd: string; sessionId: string | null }) =>
  wireSessionKey(s.cwd, s.sessionId ?? "");

export const isSession = (
  current: { cwd: string; sessionId: string | null } | null | undefined,
  target: { cwd: string; sessionId: string },
) =>
  !!current &&
  current.sessionId !== null &&
  sameSession({ ...current, sessionId: current.sessionId }, target);

export const initialState: AppState = {
  connected: false,
  reconnecting: false,
  selectionId: null,
  resync: false,
  view: { kind: "new" },
  folders: [],
  projects: [],
  sessionReferences: [],
  workspaces: [],
  registryLoaded: false,
  hosts: [],
  hostsCurrent: false,
  catalogs: {},
  catalogRevision: 0,
  trusts: {},
  trustDecisions: [],
  session: null,
  selecting: null,
  selectionFailure: null,
  pendingCreate: null,
  done: [],
};

export type Action =
  | { type: "dismiss_creation" }
  | { type: "connected"; connected: boolean; reason?: DisconnectReason }
  | { type: "server"; message: ServerMessage }
  | TrustDecisionAction
  | {
      type: "selecting";
      selectionId: string;
      cwd: string;
      sessionId: string | null;
      firstMessage?: Pick<PendingCreate, "text" | "attachments">;
      attemptId?: string;
      projectId?: string;
      options?: PendingCreate["options"];
      reconciling?: boolean;
    }
  | { type: "open"; page: Page }
  | { type: "new_directory"; cwd: string };
