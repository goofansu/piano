/** Client state: one reducer over ServerMessages plus local UI actions. */
import type { Dialog, HostInfo, ModelCatalog, ProjectView, RenderMsg, ServerMessage, SessionState } from "@shared/wire";

export interface SessionView {
  cwd: string;
  sessionId: string | null;
  hosted: boolean;
  state: SessionState;
  messages: RenderMsg[];
  pending: RenderMsg | null;
  dialogs: Dialog[];
  activeTools: Record<string, string>;
  closedReason?: string;
}

export interface AppState {
  connected: boolean;
  /** What the main pane shows. */
  view: { kind: "session" } | { kind: "new"; cwd?: string };
  projects: ProjectView[];
  hosts: HostInfo[];
  catalog: ModelCatalog | null;
  session: SessionView | null;
  /** Last worktree created from this client, so the New page can select it. */
  lastWorktree: { project: string; path: string; branch: string } | null;
  /** Local selection while the server's `selected` answer is in flight. */
  selecting: { cwd: string; sessionId: string | null } | null;
}

export const initialState: AppState = {
  connected: false,
  view: { kind: "new" },
  projects: [],
  hosts: [],
  catalog: null,
  session: null,
  lastWorktree: null,
  selecting: null,
};

export type Action =
  | { type: "connected"; connected: boolean }
  | { type: "server"; message: ServerMessage }
  | { type: "selecting"; cwd: string; sessionId: string | null }
  | { type: "new"; cwd?: string };

export function reduce(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "connected":
      return { ...s, connected: a.connected };
    case "selecting":
      return { ...s, view: { kind: "session" }, selecting: { cwd: a.cwd, sessionId: a.sessionId }, session: null };
    case "new":
      return { ...s, view: { kind: "new", cwd: a.cwd }, selecting: null, session: null };
    case "server":
      return applyServer(s, a.message);
  }
}

function applyServer(s: AppState, m: ServerMessage): AppState {
  switch (m._tag) {
    case "projects":
      return { ...s, projects: [...m.projects] };
    case "hosts":
      return { ...s, hosts: [...m.hosts] };
    case "models":
      return { ...s, catalog: m.catalog };
    case "worktree_created":
      return { ...s, lastWorktree: { project: m.project, path: m.path, branch: m.branch } };
    case "selected":
      return {
        ...s,
        view: { kind: "session" },
        selecting: null,
        session: {
          cwd: m.cwd,
          sessionId: m.sessionId,
          hosted: m.hosted,
          state: m.snapshot.state,
          messages: [...m.snapshot.messages],
          pending: null,
          dialogs: [...m.snapshot.dialogs],
          activeTools: {},
        },
      };
    case "session": {
      const t = s.session;
      if (!t) return s;
      const e = m.event;
      switch (e._tag) {
        case "snapshot":
          return { ...s, session: { ...t, hosted: true, state: e.snapshot.state, messages: [...e.snapshot.messages], dialogs: [...e.snapshot.dialogs], pending: null, activeTools: {} } };
        case "state":
          return { ...s, session: { ...t, state: e.state, pending: e.state.isStreaming ? t.pending : null, activeTools: e.state.isStreaming ? t.activeTools : {} } };
        case "message_update":
          return { ...s, session: { ...t, pending: e.message } };
        case "message_end":
          return { ...s, session: { ...t, messages: [...t.messages, e.message], pending: null } };
        case "tool_start":
          return { ...s, session: { ...t, activeTools: { ...t.activeTools, [e.toolCallId]: e.toolName } } };
        case "tool_end": {
          const activeTools = { ...t.activeTools };
          delete activeTools[e.toolCallId];
          return { ...s, session: { ...t, activeTools } };
        }
        case "dialog":
          return t.dialogs.some((d) => d.id === e.dialog.id) ? s : { ...s, session: { ...t, dialogs: [...t.dialogs, e.dialog] } };
        case "dialog_resolved":
          return { ...s, session: { ...t, dialogs: t.dialogs.filter((d) => d.id !== e.id) } };
        case "closed":
          return { ...s, session: { ...t, hosted: false, state: { ...t.state, isStreaming: false }, pending: null, activeTools: {}, dialogs: [], closedReason: e.reason } };
        case "notice":
          return s;
      }
      return s;
    }
    default:
      return s;
  }
}
