/** Client state: one reducer over ServerMessages plus local UI actions. */
import type { Dialog, HostInfo, ModelCatalog, ProjectView, RenderMsg, ServerMessage, ThreadState } from "@shared/wire";

export interface ThreadView {
  cwd: string;
  sessionId: string | null;
  hosted: boolean;
  state: ThreadState;
  messages: RenderMsg[];
  pending: RenderMsg | null;
  dialogs: Dialog[];
  activeTools: Record<string, string>;
  closedReason?: string;
}

export interface AppState {
  connected: boolean;
  projects: ProjectView[];
  hosts: HostInfo[];
  catalog: ModelCatalog | null;
  thread: ThreadView | null;
  /** Local selection while the server's `selected` answer is in flight. */
  selecting: { cwd: string; sessionId: string | null } | null;
}

export const initialState: AppState = {
  connected: false,
  projects: [],
  hosts: [],
  catalog: null,
  thread: null,
  selecting: null,
};

export type Action =
  | { type: "connected"; connected: boolean }
  | { type: "server"; message: ServerMessage }
  | { type: "selecting"; cwd: string; sessionId: string | null };

export function reduce(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "connected":
      return { ...s, connected: a.connected };
    case "selecting":
      return { ...s, selecting: { cwd: a.cwd, sessionId: a.sessionId }, thread: null };
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
    case "selected":
      return {
        ...s,
        selecting: null,
        thread: {
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
    case "thread": {
      const t = s.thread;
      if (!t) return s;
      const e = m.event;
      switch (e._tag) {
        case "snapshot":
          return { ...s, thread: { ...t, hosted: true, state: e.snapshot.state, messages: [...e.snapshot.messages], dialogs: [...e.snapshot.dialogs], pending: null, activeTools: {} } };
        case "state":
          return { ...s, thread: { ...t, state: e.state, pending: e.state.isStreaming ? t.pending : null, activeTools: e.state.isStreaming ? t.activeTools : {} } };
        case "message_update":
          return { ...s, thread: { ...t, pending: e.message } };
        case "message_end":
          return { ...s, thread: { ...t, messages: [...t.messages, e.message], pending: null } };
        case "tool_start":
          return { ...s, thread: { ...t, activeTools: { ...t.activeTools, [e.toolCallId]: e.toolName } } };
        case "tool_end": {
          const activeTools = { ...t.activeTools };
          delete activeTools[e.toolCallId];
          return { ...s, thread: { ...t, activeTools } };
        }
        case "dialog":
          return t.dialogs.some((d) => d.id === e.dialog.id) ? s : { ...s, thread: { ...t, dialogs: [...t.dialogs, e.dialog] } };
        case "dialog_resolved":
          return { ...s, thread: { ...t, dialogs: t.dialogs.filter((d) => d.id !== e.id) } };
        case "closed":
          return { ...s, thread: { ...t, hosted: false, state: { ...t.state, isStreaming: false }, pending: null, activeTools: {}, dialogs: [], closedReason: e.reason } };
        case "notice":
          return s;
      }
      return s;
    }
    default:
      return s;
  }
}
