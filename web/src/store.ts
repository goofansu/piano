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
import { applySessionEvent } from "../../shared/sessionProjection.ts";
import * as FirstMessage from "./lib/firstMessage.ts";
import { appendParagraph, type DraftKey, sessionDraftKey } from "./lib/messageDraft.ts";

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
  session: SessionView | null;
  /** Awaiting a correlated snapshot; a same-session refresh retains the visible projection. */
  selecting: { cwd: string; sessionId: string | null } | null;
  selectionFailure: { cwd: string; sessionId: string | null; message: string } | null;
  pendingCreate: FirstMessage.PendingCreate | null;
  /** Sessions whose turn finished while another one was on screen; cleared when opened. */
  done: string[];
  /** Unsent editor text belongs to this browser; see lib/messageDraft for keys and images. */
  drafts: Record<DraftKey, string>;
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
  session: null,
  selecting: null,
  selectionFailure: null,
  pendingCreate: null,
  done: [],
  drafts: {},
};

export type Action =
  | { type: "connected"; connected: boolean }
  | { type: "server"; message: ServerMessage }
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
  | { type: "missing-session"; sessionId: string }
  | { type: "draft_changed"; key: DraftKey; text: string }
  /** Typed characters, appended as they are. */
  | { type: "draft_appended"; key: DraftKey; text: string }
  /** Text added from elsewhere (Changes, an extension, the restored queue), as a new paragraph. */
  | { type: "draft_paragraph_appended"; key: DraftKey; text: string };

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
        selectionId: a.connected ? s.selectionId : null,
        selecting: !a.connected && s.pendingCreate ? null : s.selecting,
        pendingCreate: a.connected ? s.pendingCreate : FirstMessage.connectionLost(s.pendingCreate),
      };
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
    case "draft_changed":
      return { ...s, drafts: { ...s.drafts, [a.key]: a.text } };
    case "draft_appended":
      return { ...s, drafts: { ...s.drafts, [a.key]: (s.drafts[a.key] ?? "") + a.text } };
    case "draft_paragraph_appended":
      return {
        ...s,
        drafts: { ...s.drafts, [a.key]: appendParagraph(s.drafts[a.key] ?? "", a.text) },
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
  if (!t.cursor || m.cursor.generation !== t.cursor.generation) return "resync";
  if (m.cursor.sequence <= t.cursor.sequence) return "ignore";
  return m.cursor.sequence === t.cursor.sequence + 1 ? "apply" : "resync";
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
      return { ...s, trusts: { ...s.trusts, [m.cwd]: m.trust } };
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
        if (m.cursor.generation !== s.session.cursor.generation) return { ...s, resync: true };
        if (m.cursor.sequence <= s.session.cursor.sequence) return s;
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
      if (!m.selectionId || m.selectionId !== s.selectionId || !s.pendingCreate) return s;
      return {
        ...s,
        selecting: null,
        pendingCreate: FirstMessage.failed(s.pendingCreate, m.message),
      };
    case "action_result": {
      if (m.result._tag !== "queue_restored") return s;
      const restored = m.result.messages.map((message) => message.text).join("\n\n");
      if (!restored) return s;
      return reduceAction(s, {
        type: "draft_paragraph_appended",
        key: sessionDraftKey(m),
        text: restored,
      });
    }
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
