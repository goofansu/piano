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
  view: { kind: "session" } | { kind: "new"; cwd?: string } | { kind: "missing-session"; sessionId: string };
  projects: ProjectView[];
  /** The server has sent the project list at least once since connecting. */
  projectsLoaded: boolean;
  hosts: HostInfo[];
  catalog: ModelCatalog | null;
  session: SessionView | null;
  /** Last worktree created from this client, so the New page can select it. */
  lastWorktree: { project: string; path: string; branch: string } | null;
  /** Local selection while the server's `selected` answer is in flight. */
  selecting: { cwd: string; sessionId: string | null } | null;
  /** Sessions whose turn finished while another one was on screen; cleared when opened. */
  done: string[];
  /** Unsent editor text belongs to this browser, keyed by session identity. */
  drafts: Record<string, string>;
}

export const sessionKey = (s: { cwd: string; sessionId: string | null }) => `${s.cwd}\n${s.sessionId ?? ""}`;

export const initialState: AppState = {
  connected: false,
  view: { kind: "new" },
  projects: [],
  projectsLoaded: false,
  hosts: [],
  catalog: null,
  session: null,
  lastWorktree: null,
  selecting: null,
  done: [],
  drafts: {},
};

export type Action =
  | { type: "connected"; connected: boolean }
  | { type: "server"; message: ServerMessage }
  | { type: "selecting"; cwd: string; sessionId: string | null }
  | { type: "new"; cwd?: string }
  | { type: "missing-session"; sessionId: string }
  | { type: "draft_changed"; key: string; text: string }
  | { type: "draft_appended"; key: string; text: string };

export function reduce(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "connected":
      return { ...s, connected: a.connected };
    case "selecting":
      return { ...s, view: { kind: "session" }, selecting: { cwd: a.cwd, sessionId: a.sessionId }, session: null, done: s.done.filter((k) => k !== sessionKey(a)) };
    case "new":
      return { ...s, view: { kind: "new", cwd: a.cwd }, selecting: null, session: null };
    case "missing-session":
      return { ...s, view: { kind: "missing-session", sessionId: a.sessionId }, selecting: null, session: null };
    case "draft_changed":
      return { ...s, drafts: { ...s.drafts, [a.key]: a.text } };
    case "draft_appended":
      return { ...s, drafts: { ...s.drafts, [a.key]: (s.drafts[a.key] ?? "") + a.text } };
    case "server":
      return applyServer(s, a.message);
  }
}

function applyServer(s: AppState, m: ServerMessage): AppState {
  switch (m._tag) {
    case "projects":
      return { ...s, projects: [...m.projects], projectsLoaded: true };
    case "hosts": {
      // A host that was working and no longer is has finished a turn. Unless it is on screen, remember that.
      const viewing = s.session ? sessionKey(s.session) : s.selecting ? sessionKey(s.selecting) : null;
      const done = new Set(s.done);
      for (const prev of s.hosts) {
        if (!prev.streaming) continue;
        const now = m.hosts.find((h) => h.cwd === prev.cwd && h.sessionId === prev.sessionId);
        const k = sessionKey(prev);
        if (!now?.streaming && k !== viewing) done.add(k);
      }
      return { ...s, hosts: [...m.hosts], done: [...done] };
    }
    case "models":
      return { ...s, catalog: m.catalog };
    case "worktree_created":
      return { ...s, lastWorktree: { project: m.project, path: m.path, branch: m.branch } };
    case "selected":
      // A selection without a session (what the server answers after archiving the one
      // being viewed) has nothing to show; sessions start from the New page.
      if (m.sessionId === null) return { ...s, view: { kind: "new", cwd: m.cwd }, selecting: null, session: null };
      return {
        ...s,
        view: { kind: "session" },
        selecting: null,
        done: s.done.filter((k) => k !== sessionKey(m)),
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
    case "action_result": {
      const restored = m.result.messages.map((message) => message.text).join("\n\n");
      if (!restored) return s;
      const key = sessionKey(m);
      const existing = s.drafts[key] ?? "";
      return { ...s, drafts: { ...s.drafts, [key]: existing ? `${existing}\n\n${restored}` : restored } };
    }
    case "session": {
      const t = s.session;
      if (!t) return s;
      const e = m.event;
      switch (e._tag) {
        case "snapshot":
          return { ...s, session: { ...t, hosted: true, state: e.snapshot.state, messages: [...e.snapshot.messages], dialogs: [...e.snapshot.dialogs], pending: null, activeTools: {} } };
        case "state":
          return { ...s, session: { ...t, state: e.state, pending: e.state.isStreaming ? t.pending : null, activeTools: e.state.isStreaming ? t.activeTools : {} } };
        case "queue_update":
          return { ...s, session: { ...t, state: { ...t.state, queuedMessages: [...e.messages] } } };
        case "submission":
          if (t.state.submission && e.submission.id < t.state.submission.id) return s;
          return { ...s, session: { ...t, state: { ...t.state, submission: e.submission } } };
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
          return t.dialogs.some((d) => d.id === e.dialog.id && d.generation === e.dialog.generation) ? s : { ...s, session: { ...t, dialogs: [...t.dialogs, e.dialog] } };
        case "dialog_resolved":
          return { ...s, session: { ...t, dialogs: t.dialogs.filter((d) => d.id !== e.resolution.id || d.generation !== e.resolution.generation) } };
        case "closed":
          return { ...s, session: { ...t, hosted: false, state: { ...t.state, isStreaming: false, isCompacting: false, isRetrying: false, queuedMessages: [] }, pending: null, activeTools: {}, dialogs: [], closedReason: e.reason } };
        case "notice":
          return s;
      }
      return s;
    }
    default:
      return s;
  }
}
