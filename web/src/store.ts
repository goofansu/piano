/** Client state: one reducer over ServerMessages plus local UI actions. */
import type { Dialog, HostInfo, ModelCatalog, OutcomeProject, ProjectTrust, ProjectView, RenderMsg, ServerMessage, SessionCursor, SessionReference, SessionState, ToolExecution, Workspace, WorktreeDiscovery } from "@shared/wire";

export interface SessionView {
  cwd: string;
  sessionId: string | null;
  hosted: boolean;
  cursor: SessionCursor | null;
  state: SessionState;
  messages: RenderMsg[];
  pending: RenderMsg | null;
  dialogs: Dialog[];
  tools: Record<string, ToolExecution>;
  closedReason?: string;
}

/** Browser-only submitted input, never part of Pi's transcript or registry. */
export interface PendingCreate {
  cwd: string;
  text: string;
  attachments?: RenderMsg["attachments"];
  outcome: "starting" | "submitted" | "handled" | "rejected" | "uncertain";
  /** First observed Pi submission; later input supersedes this local receipt. */
  submissionId?: number;
  detail?: string;
}

export interface AppState {
  connected: boolean;
  selectionId: string | null;
  resync: boolean;
  /** What the main pane shows. */
  view: { kind: "session" } | { kind: "new"; cwd?: string; outcomeProjectId?: string } | { kind: "missing-session"; sessionId: string };
  projects: ProjectView[];
  outcomeProjects: OutcomeProject[];
  sessionReferences: SessionReference[];
  workspaces: Workspace[];
  /** The server has sent the project list at least once since connecting. */
  projectsLoaded: boolean;
  hosts: HostInfo[];
  catalogs: Record<string, ModelCatalog>;
  catalogRevision: number;
  /** Pi's trust outcome per directory asked about, including directories that are not registered yet. */
  trusts: Record<string, ProjectTrust>;
  session: SessionView | null;
  /** Correlated result; only the requesting directory picker may change its selection. */
  worktreeResult: Extract<ServerMessage, { _tag: "worktree_result" }> | null;
  /** The picker's latest discovery per project; requested by this client, never broadcast. */
  worktrees: Record<string, WorktreeDiscovery>;
  /** Awaiting a correlated snapshot; a same-session refresh retains the visible projection. */
  selecting: { cwd: string; sessionId: string | null } | null;
  pendingCreate: PendingCreate | null;
  /** Sessions whose turn finished while another one was on screen; cleared when opened. */
  done: string[];
  /** Unsent editor text belongs to this browser, keyed by session identity. */
  drafts: Record<string, string>;
}

export const sessionKey = (s: { cwd: string; sessionId: string | null }) => `${s.cwd}\n${s.sessionId ?? ""}`;

export const initialState: AppState = {
  connected: false,
  selectionId: null,
  resync: false,
  view: { kind: "new" },
  projects: [],
  outcomeProjects: [],
  sessionReferences: [],
  workspaces: [],
  projectsLoaded: false,
  hosts: [],
  catalogs: {},
  catalogRevision: 0,
  trusts: {},
  session: null,
  worktreeResult: null,
  worktrees: {},
  selecting: null,
  pendingCreate: null,
  done: [],
  drafts: {},
};

export type Action =
  | { type: "connected"; connected: boolean }
  | { type: "server"; message: ServerMessage }
  | { type: "selecting"; selectionId: string; cwd: string; sessionId: string | null; firstMessage?: Pick<PendingCreate, "text" | "attachments"> }
  | { type: "new"; cwd?: string; outcomeProjectId?: string }
  | { type: "missing-session"; sessionId: string }
  | { type: "draft_changed"; key: string; text: string }
  | { type: "draft_appended"; key: string; text: string };

export function reduce(s: AppState, a: Action): AppState {
  let next = reduceAction(s, a);
  if (next === s) return s;
  let input = next.pendingCreate;
  const t = next.session;
  if (!input || !t) return next;
  // Pi may expand slash commands, so reconcile by the new session's first user
  // message, not text equality. Never insert the local input into history.
  if (t.messages.some(m => m.role === "user") || t.pending?.role === "user") return { ...next, pendingCreate: null };
  const submission = t.state.submission;
  if (submission) {
    if (input.submissionId !== undefined && submission.id > input.submissionId) return { ...next, pendingCreate: null };
    if (input.submissionId === undefined) {
      input = { ...input, submissionId: submission.id };
      next = { ...next, pendingCreate: input };
    }
  }
  if (submission && (submission.outcome === "handled" || submission.outcome === "rejected" || submission.outcome === "uncertain")) {
    return { ...next, pendingCreate: { ...input, outcome: submission.outcome, detail: submission.detail } };
  }
  if (submission?.outcome === "started" || submission?.outcome === "queued") return { ...next, pendingCreate: { ...input, outcome: "submitted", detail: undefined } };
  if (t.closedReason && input.outcome !== "submitted") return { ...next, pendingCreate: { ...input, outcome: "uncertain", detail: t.closedReason } };
  return next;
}

function reduceAction(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "connected":
      // A reopened socket is not attached until it receives a new selection snapshot.
      return { ...s, connected: a.connected, selectionId: a.connected ? s.selectionId : null,
        selecting: !a.connected && s.pendingCreate ? null : s.selecting,
        pendingCreate: !a.connected && s.pendingCreate?.outcome === "starting"
          ? { ...s.pendingCreate, outcome: "uncertain", detail: "Connection lost before delivery was confirmed." } : s.pendingCreate };
    case "selecting":
      return { ...s, selectionId: a.selectionId, resync: false, view: { kind: "session" }, selecting: { cwd: a.cwd, sessionId: a.sessionId },
        pendingCreate: a.firstMessage ? { cwd: a.cwd, ...a.firstMessage, outcome: "starting" }
          : s.session && sessionKey(s.session) === sessionKey(a) ? s.pendingCreate : null,
        session: s.session && sessionKey(s.session) === sessionKey(a) ? s.session : null,
        done: s.done.filter((k) => k !== sessionKey(a)) };
    case "new":
      return { ...s, selectionId: null, resync: false, view: { kind: "new", cwd: a.cwd, outcomeProjectId: a.outcomeProjectId }, selecting: null, session: null, pendingCreate: null };
    case "missing-session":
      return { ...s, selectionId: null, resync: false, view: { kind: "missing-session", sessionId: a.sessionId }, selecting: null, session: null, pendingCreate: null };
    case "draft_changed":
      return { ...s, drafts: { ...s.drafts, [a.key]: a.text } };
    case "draft_appended":
      return { ...s, drafts: { ...s.drafts, [a.key]: (s.drafts[a.key] ?? "") + a.text } };
    case "server":
      return applyServer(s, a.message);
  }
}

/** Shared by projection and notifications: rejected frames cannot toast either. */
export function sessionDelivery(s: AppState, m: Extract<ServerMessage, { _tag: "session" }>): "apply" | "ignore" | "resync" {
  const t = s.session;
  if (!t || !s.connected || s.resync || s.selecting || m.selectionId !== s.selectionId || m.cursor.cwd !== t.cwd || m.cursor.sessionId !== t.sessionId) return "ignore";
  if (!t.cursor || m.cursor.generation !== t.cursor.generation) return "resync";
  if (m.cursor.sequence <= t.cursor.sequence) return "ignore";
  return m.cursor.sequence === t.cursor.sequence + 1 ? "apply" : "resync";
}

function applyServer(s: AppState, m: ServerMessage): AppState {
  switch (m._tag) {
    case "projects":
      return { ...s, projects: [...m.projects], outcomeProjects: [...m.outcomeProjects ?? []], sessionReferences: [...m.sessionReferences ?? []], workspaces: [...m.workspaces ?? []], projectsLoaded: true };
    case "hosts": {
      // A host that was working and no longer is has finished a turn. Unless it is on screen, remember that.
      const viewing = s.session ? sessionKey(s.session) : s.selecting ? sessionKey(s.selecting) : null;
      const done = new Set(s.done);
      for (const prev of s.hosts) {
        if (!prev.streaming) continue;
        const now = m.hosts.find((h) => h.cwd === prev.cwd && h.sessionId === prev.sessionId);
        const k = sessionKey(prev);
        if (now && !now.streaming && k !== viewing) done.add(k);
      }
      return { ...s, hosts: [...m.hosts], done: [...done] };
    }
    case "models":
      return { ...s, catalogs: { ...s.catalogs, [m.catalog.cwd]: m.catalog } };
    case "catalogs_invalidated":
      return { ...s, catalogs: {}, catalogRevision: s.catalogRevision + 1 };
    case "trust":
      return { ...s, trusts: { ...s.trusts, [m.cwd]: m.trust } };
    case "worktree_result":
      return { ...s, worktreeResult: m };
    case "worktrees":
      return { ...s, worktrees: { ...s.worktrees, [m.project]: m.discovery } };
    case "selected":
      if (m.selectionId !== s.selectionId || s.resync) return s;
      if (m.cursor && (m.cursor.cwd !== m.cwd || m.cursor.sessionId !== m.sessionId || m.snapshot.state.sessionId !== m.sessionId)) return { ...s, resync: true };
      // The first snapshot for a new attachment may have the same sequence or
      // a new host generation. Only compare cursors within an established attachment.
      if (!s.selecting && s.session?.cursor && m.cursor) {
        if (m.cursor.generation !== s.session.cursor.generation) return { ...s, resync: true };
        if (m.cursor.sequence <= s.session.cursor.sequence) return s;
      }
      // A selection without a session (what the server answers after archiving the one
      // being viewed) has nothing to show; sessions start from the New page.
      if (m.sessionId === null) return { ...s, view: { kind: "new", cwd: m.cwd }, selecting: null, session: null, pendingCreate: null };
      return {
        ...s,
        view: { kind: "session" },
        selecting: null,
        done: s.done.filter((k) => k !== sessionKey(m)),
        session: {
          cwd: m.cwd,
          sessionId: m.sessionId,
          hosted: m.hosted,
          cursor: m.cursor,
          state: m.snapshot.state,
          closedReason: m.snapshot.state.closedReason,
          messages: [...m.snapshot.messages],
          pending: m.snapshot.pending ?? null,
          dialogs: [...m.snapshot.dialogs],
          tools: Object.fromEntries((m.snapshot.tools ?? []).map(tool => [tool.id, tool])),
        },
      };
    case "error":
      if (!m.selectionId || m.selectionId !== s.selectionId || !s.pendingCreate) return s;
      return { ...s, selecting: null, pendingCreate: { ...s.pendingCreate, outcome: "uncertain", detail: m.message } };
    case "action_result": {
      if (m.result._tag !== "queue_restored") return s;
      const restored = m.result.messages.map((message) => message.text).join("\n\n");
      if (!restored) return s;
      const key = sessionKey(m);
      const existing = s.drafts[key] ?? "";
      return { ...s, drafts: { ...s.drafts, [key]: existing ? `${existing}\n\n${restored}` : restored } };
    }
    case "session": {
      const disposition = sessionDelivery(s, m);
      if (disposition === "ignore") return s;
      if (disposition === "resync") return { ...s, resync: true };
      const t = { ...s.session!, cursor: m.cursor };
      // Advance the cursor even for a notice or an intentionally ignored fact.
      s = { ...s, session: t };
      const e = m.event;
      switch (e._tag) {
        case "snapshot":
          return { ...s, session: { ...t, hosted: true, state: e.snapshot.state, messages: [...e.snapshot.messages], dialogs: [...e.snapshot.dialogs], pending: e.snapshot.pending ?? null, tools: Object.fromEntries((e.snapshot.tools ?? []).map(tool => [tool.id, tool])) } };
        case "state":
          return { ...s, session: { ...t, state: e.state, pending: e.state.isStreaming ? t.pending : null } };
        case "queue_update":
          return { ...s, session: { ...t, state: { ...t.state, queuedMessages: [...e.messages] } } };
        case "submission":
          if (t.state.submission && e.submission.id < t.state.submission.id) return s;
          return { ...s, session: { ...t, state: { ...t.state, submission: e.submission } } };
        case "message_update":
          return { ...s, session: { ...t, pending: e.message } };
        case "message_end":
          return { ...s, session: { ...t, messages: [...t.messages, e.message], pending: e.message.role === "assistant" ? null : t.pending } };
        case "context":
          return { ...s, session: { ...t, messages: [...e.messages] } };
        case "tool_update":
          return { ...s, session: { ...t, tools: { ...t.tools, [e.tool.id]: e.tool } } };
        case "dialog":
          return t.dialogs.some((d) => d.id === e.dialog.id && d.generation === e.dialog.generation) ? s : { ...s, session: { ...t, dialogs: [...t.dialogs, e.dialog] } };
        case "dialog_resolved":
          return { ...s, session: { ...t, dialogs: t.dialogs.filter((d) => d.id !== e.resolution.id || d.generation !== e.resolution.generation) } };
        case "closed":
          return { ...s, session: { ...t, hosted: false, state: { ...t.state, isStreaming: false, isCompacting: false, isRetrying: false, isStopping: false, queuedMessages: [] }, pending: null, dialogs: [], closedReason: e.reason } };
        case "notice":
          return s;
      }
      return s;
    }
    default:
      return s;
  }
}
