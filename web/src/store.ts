/** Client state: one reducer over ServerMessages plus local UI actions. */
import type {
  FolderView,
  HostInfo,
  ModelCatalog,
  Project,
  ProjectTrust,
  ServerMessage,
  SessionCursor,
  SessionReference,
  Snapshot,
  Workspace,
} from "@shared/wire";
// Relative, not @shared: module tests load this file directly in Node.
import { applySessionEvent, cursorStep } from "../../shared/sessionProjection.ts";
import * as FirstMessage from "./lib/firstMessage.ts";

export type { PendingCreate } from "./lib/firstMessage.ts";

/** The selected session: the server's snapshot folded forward by its live events, plus where it came from. */
export interface SessionView extends Snapshot {
  cwd: string;
  sessionId: string | null;
  hosted: boolean;
  cursor: SessionCursor | null;
}

export interface AppState {
  connected: boolean;
  selectionId: string | null;
  resync: boolean;
  /** What the main pane shows. The New page's `cwd` is the directory a session started there runs in; it has no other owner. */
  view:
    | { kind: "session" }
    | { kind: "new"; cwd?: string; projectId?: string }
    | { kind: "missing-session"; sessionId: string };
  folders: FolderView[];
  projects: Project[];
  sessionReferences: SessionReference[];
  workspaces: Workspace[];
  /** The server has sent the registry at least once since connecting. */
  registryLoaded: boolean;
  hosts: HostInfo[];
  catalogs: Record<string, ModelCatalog>;
  catalogRevision: number;
  /** Pi's trust outcome per directory asked about, including directories that are not registered yet. */
  trusts: Record<string, ProjectTrust>;
  /** Directories with a trust decision in flight on this connection; probes cannot settle them. */
  pendingTrust: readonly string[];
  session: SessionView | null;
  /** Awaiting a correlated snapshot; a same-session refresh retains the visible projection. */
  selecting: { cwd: string; sessionId: string | null } | null;
  selectionFailure: { cwd: string; sessionId: string | null; message: string } | null;
  pendingCreate: FirstMessage.PendingCreate | null;
  /** Sessions whose turn finished while another one was on screen; cleared when opened. */
  done: string[];
}

export const sessionKey = (s: { cwd: string; sessionId: string | null }) =>
  `${s.cwd}\n${s.sessionId ?? ""}`;

export const initialState: AppState = {
  connected: false,
  selectionId: null,
  resync: false,
  view: { kind: "new" },
  folders: [],
  projects: [],
  sessionReferences: [],
  workspaces: [],
  registryLoaded: false,
  hosts: [],
  catalogs: {},
  catalogRevision: 0,
  trusts: {},
  pendingTrust: [],
  session: null,
  selecting: null,
  selectionFailure: null,
  pendingCreate: null,
  done: [],
};

export type Action =
  | { type: "connected"; connected: boolean }
  | { type: "server"; message: ServerMessage }
  | { type: "trust_pending"; cwd: string }
  | {
      type: "selecting";
      selectionId: string;
      cwd: string;
      sessionId: string | null;
      firstMessage?: Pick<FirstMessage.PendingCreate, "text" | "attachments">;
    }
  /** Opens the New page; without a directory it keeps the one already chosen there. */
  | { type: "new"; cwd?: string; projectId?: string }
  /** Picks the New page's directory; ignored on any other view. */
  | { type: "new_directory"; cwd: string }
  | { type: "missing-session"; sessionId: string };

export function reduce(s: AppState, a: Action): AppState {
  const next = reduceAction(s, a);
  if (next === s) return s;
  const pendingCreate = FirstMessage.reconcile(next.pendingCreate, next.session);
  return pendingCreate === next.pendingCreate ? next : { ...next, pendingCreate };
}

function reduceAction(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "connected":
      // A reopened socket is not attached until it receives a new selection snapshot.
      return {
        ...s,
        connected: a.connected,
        pendingTrust: a.connected ? s.pendingTrust : [],
        selectionId: a.connected ? s.selectionId : null,
        selecting: !a.connected && s.pendingCreate ? null : s.selecting,
        pendingCreate: a.connected ? s.pendingCreate : FirstMessage.connectionLost(s.pendingCreate),
      };
    case "trust_pending":
      return { ...s, pendingTrust: [...s.pendingTrust, a.cwd] };
    case "selecting":
      return {
        ...s,
        selectionId: a.selectionId,
        resync: false,
        view: { kind: "session" },
        selecting: { cwd: a.cwd, sessionId: a.sessionId },
        selectionFailure: null,
        pendingCreate: a.firstMessage
          ? FirstMessage.started(a.selectionId, a.cwd, a.firstMessage)
          : s.session && sessionKey(s.session) === sessionKey(a)
            ? s.pendingCreate
            : null,
        session: s.session && sessionKey(s.session) === sessionKey(a) ? s.session : null,
        done: s.done.filter((k) => k !== sessionKey(a)),
      };
    case "new":
      // Picking a project, or New session again, on the New page keeps the directory chosen there.
      return {
        ...s,
        selectionId: null,
        resync: false,
        selectionFailure: null,
        view: {
          kind: "new",
          cwd: a.cwd ?? (s.view.kind === "new" ? s.view.cwd : undefined),
          projectId: a.projectId,
        },
        selecting: null,
        session: null,
        pendingCreate: null,
      };
    case "new_directory":
      return s.view.kind === "new" && s.view.cwd !== a.cwd
        ? { ...s, view: { ...s.view, cwd: a.cwd } }
        : s;
    case "missing-session":
      return {
        ...s,
        selectionId: null,
        resync: false,
        view: { kind: "missing-session", sessionId: a.sessionId },
        selectionFailure: null,
        selecting: null,
        session: null,
        pendingCreate: null,
      };
    case "server":
      return applyServer(s, a.message);
  }
}

/** Shared by projection and notifications: rejected frames cannot toast either. */
export function sessionDelivery(
  s: AppState,
  m: Extract<ServerMessage, { _tag: "session" }>,
): "apply" | "ignore" | "resync" {
  const t = s.session;
  if (
    !t ||
    !s.connected ||
    s.resync ||
    s.selecting ||
    m.selectionId !== s.selectionId ||
    m.cursor.cwd !== t.cwd ||
    m.cursor.sessionId !== t.sessionId
  )
    return "ignore";
  switch (cursorStep(t.cursor, m.cursor)) {
    case "next":
      return "apply";
    case "duplicate":
      return "ignore";
    default:
      return "resync";
  }
}

function applyServer(s: AppState, m: ServerMessage): AppState {
  switch (m._tag) {
    case "registry":
      return {
        ...s,
        folders: [...m.folders],
        projects: [...(m.projects ?? [])],
        sessionReferences: [...(m.sessionReferences ?? [])],
        workspaces: [...(m.workspaces ?? [])],
        registryLoaded: true,
      };
    case "hosts": {
      // A host that was working and no longer is has finished a turn. Unless it is on screen, remember that.
      const viewing = s.session
        ? sessionKey(s.session)
        : s.selecting
          ? sessionKey(s.selecting)
          : null;
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
      // The client re-asks for the focused directory on the revision; the old catalog stays until its replacement arrives, so open pickers do not flash empty.
      return { ...s, catalogRevision: s.catalogRevision + 1 };
    case "trust":
      return {
        ...s,
        trusts: { ...s.trusts, [m.cwd]: m.trust },
        pendingTrust:
          m.requested === undefined
            ? s.pendingTrust
            : s.pendingTrust.filter((cwd) => cwd !== m.cwd),
      };
    case "selected":
      if (m.selectionId !== s.selectionId || s.resync) return s;
      if (
        m.cursor &&
        (m.cursor.cwd !== m.cwd ||
          m.cursor.sessionId !== m.sessionId ||
          m.snapshot.state.sessionId !== m.sessionId)
      )
        return { ...s, resync: true };
      // The first snapshot for a new attachment may have the same sequence or
      // a new host generation. Only compare cursors within an established attachment.
      if (!s.selecting && s.session?.cursor && m.cursor) {
        const step = cursorStep(s.session.cursor, m.cursor);
        if (step === "other-generation") return { ...s, resync: true };
        if (step === "duplicate") return s;
      }
      // A selection without a session (what the server answers after archiving the one
      // being viewed) has nothing to show; sessions start from the New page.
      if (m.sessionId === null)
        return {
          ...s,
          view: { kind: "new", cwd: m.cwd },
          selecting: null,
          session: null,
          pendingCreate: null,
        };
      return {
        ...s,
        view: { kind: "session" },
        selecting: null,
        done: s.done.filter((k) => k !== sessionKey(m)),
        session: {
          ...m.snapshot,
          cwd: m.cwd,
          sessionId: m.sessionId,
          hosted: m.hosted,
          cursor: m.cursor,
        },
      };
    case "selection_failed":
    case "selection_rejected":
      if (m.selectionId !== s.selectionId || !s.selecting) return s;
      return {
        ...s,
        selectionId: null,
        selectionFailure: { ...s.selecting, message: m.message },
        selecting: null,
        pendingCreate:
          m._tag === "selection_rejected"
            ? FirstMessage.rejected(s.pendingCreate, m.selectionId, m.message)
            : s.pendingCreate,
      };
    case "error":
      // Trust failures have no selection correlation; don't leave their controls pending forever.
      if (!m.selectionId) return s.pendingTrust.length ? { ...s, pendingTrust: [] } : s;
      if (m.selectionId !== s.selectionId || !s.pendingCreate) return s;
      return {
        ...s,
        selecting: null,
        pendingCreate: FirstMessage.failed(s.pendingCreate, m.message),
      };
    // A restored queue goes to its session's draft, which lib/messageDraft keeps (`drafts.follow`).
    case "session": {
      const disposition = sessionDelivery(s, m);
      if (disposition === "ignore") return s;
      if (disposition === "resync") return { ...s, resync: true };
      const t = s.session!;
      const e = m.event;
      // Advance the cursor even for a notice or an intentionally ignored fact.
      const hosted = e._tag === "snapshot" ? true : e._tag === "closed" ? false : t.hosted;
      return {
        ...s,
        session: {
          ...applySessionEvent(t, e),
          cwd: t.cwd,
          sessionId: t.sessionId,
          hosted,
          cursor: m.cursor,
        },
      };
    }
    default:
      return s;
  }
}
