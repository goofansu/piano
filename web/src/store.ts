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
import { type CreationContext, creationVerdictOf } from "../../shared/creationVerdict.ts";
import { applySessionEvent, cursorStep } from "../../shared/sessionProjection.ts";
import { sameSession, sessionKey as wireSessionKey } from "../../shared/wire.ts";
import {
  applyTrustFrame,
  beginTrustDecision,
  dropTrustDecisions,
  type PendingTrust,
} from "./lib/directoryTrust.ts";
import * as FirstMessage from "./lib/firstMessage.ts";
import type { UnavailableSessionReason } from "./lib/sessionCatalog.ts";
import { startPage } from "./lib/startPage.ts";

export type { PendingCreate } from "./lib/firstMessage.ts";

export interface SessionView extends Snapshot {
  cwd: string;
  sessionId: string | null;
  hosted: boolean;
  cursor: SessionCursor | null;
}

export interface AppState {
  connected: boolean;
  unreachable: boolean;
  selectionId: string | null;
  resync: boolean;
  view: { kind: "session" } | Page;
  folders: FolderView[];
  projects: Project[];
  sessionReferences: SessionReference[];
  workspaces: Workspace[];
  registryLoaded: boolean;
  hosts: HostInfo[];
  catalogs: Record<string, ModelCatalog>;
  catalogRevision: number;
  trusts: Record<string, ProjectTrust>;
  pendingTrust: readonly PendingTrust[];
  session: SessionView | null;
  selecting: { cwd: string; sessionId: string | null } | null;
  selectionFailure: { cwd: string; sessionId: string | null; message: string } | null;
  pendingCreate: FirstMessage.PendingCreate | null;
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
  unreachable: false,
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
  | { type: "dismiss_creation" }
  | { type: "connected"; connected: boolean; lost?: boolean }
  | { type: "server"; message: ServerMessage }
  | { type: "trust_pending"; cwd: string }
  | {
      type: "selecting";
      selectionId: string;
      cwd: string;
      sessionId: string | null;
      firstMessage?: Pick<FirstMessage.PendingCreate, "text" | "attachments">;
      attemptId?: string;
      projectId?: string;
      options?: FirstMessage.PendingCreate["options"];
      reconciling?: boolean;
    }
  | { type: "open"; page: Page }
  | { type: "new_directory"; cwd: string };

export function reduce(s: AppState, a: Action): AppState {
  const next = reduceAction(s, a);
  if (next === s) return s;
  const pendingCreate = FirstMessage.reconcile(next.pendingCreate, next.session);
  return pendingCreate === next.pendingCreate ? next : { ...next, pendingCreate };
}

const creationContext = (s: AppState, pending: FirstMessage.PendingCreate): CreationContext => ({
  attemptId: pending.attemptId,
  sessionNamed: !!s.session,
});

function reduceAction(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "connected":
      return {
        ...(a.connected ? s : dropTrustDecisions(s)),
        connected: a.connected,
        unreachable: a.connected ? false : (a.lost ?? s.unreachable),
        selectionId: a.connected ? s.selectionId : null,
        selecting: !a.connected && s.pendingCreate ? null : s.selecting,
        pendingCreate: a.connected ? s.pendingCreate : FirstMessage.connectionLost(s.pendingCreate),
      };
    case "dismiss_creation":
      return { ...s, selectionFailure: null, pendingCreate: null };
    case "trust_pending":
      return beginTrustDecision(s, a.cwd);
    case "selecting": {
      const next: AppState = {
        ...s,
        selectionId: a.selectionId,
        resync: false,
        view: { kind: "session" },
        selecting: { cwd: a.cwd, sessionId: a.sessionId },
        selectionFailure: null,
        pendingCreate: a.reconciling
          ? s.pendingCreate
          : a.firstMessage
            ? {
                ...FirstMessage.started(a.attemptId ?? a.selectionId, a.cwd, a.firstMessage),
                ...(a.projectId === undefined ? {} : { projectId: a.projectId }),
                ...(a.options === undefined ? {} : { options: a.options }),
              }
            : s.session && sessionKey(s.session) === sessionKey(a)
              ? s.pendingCreate
              : null,
        session: s.session && sessionKey(s.session) === sessionKey(a) ? s.session : null,
        done: s.done.filter((k) => k !== sessionKey(a)),
      };
      return s.connected ? next : reduceAction(next, { type: "connected", connected: false });
    }
    case "open":
      return {
        ...s,
        selectionId: null,
        resync: false,
        selectionFailure: null,
        view: opened(s.view, a.page),
        selecting: null,
        session: null,
        pendingCreate: null,
      };
    case "new_directory": {
      const page = startPage(s.view);
      return page && page.cwd !== a.cwd ? { ...s, view: { ...page, cwd: a.cwd } } : s;
    }
    case "server":
      return applyServer(s, a.message);
  }
}

function opened(view: AppState["view"], page: Page): Page {
  if (page.kind === "new")
    return {
      kind: "new",
      cwd: page.cwd ?? (view.kind === "new" ? view.cwd : undefined),
      projectId: page.projectId,
    };
  if (page.kind === "project" && view.kind === "project" && view.projectId === page.projectId)
    return view;
  return page;
}

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
      const viewing = s.session
        ? sessionKey(s.session)
        : s.selecting
          ? sessionKey(s.selecting)
          : null;
      const done = new Set(s.done);
      for (const prev of s.hosts) {
        if (!prev.working) continue;
        const now = m.hosts.find((h) => sameSession(h, prev));
        const k = sessionKey(prev);
        if (now && !now.working && k !== viewing) done.add(k);
      }
      return { ...s, hosts: [...m.hosts], done: [...done] };
    }
    case "models":
      return { ...s, catalogs: { ...s.catalogs, [m.catalog.cwd]: m.catalog } };
    case "catalogs_invalidated":
      return { ...s, catalogRevision: s.catalogRevision + 1 };
    case "trust":
    case "trust_failed":
      return applyTrustFrame(s, m);
    case "selected":
      if (m.selectionId !== s.selectionId || s.resync) return s;
      if (
        m.cursor &&
        (m.cursor.cwd !== m.cwd ||
          m.cursor.sessionId !== m.sessionId ||
          m.snapshot.state.sessionId !== m.sessionId)
      )
        return { ...s, resync: true };
      if (!s.selecting && s.session?.cursor && m.cursor) {
        const step = cursorStep(s.session.cursor, m.cursor);
        if (step === "other-generation") return { ...s, resync: true };
        if (step === "duplicate") return s;
      }
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
    case "selection_rejected": {
      if (m.selectionId !== s.selectionId || !s.selecting) return s;
      const pending = s.pendingCreate;
      const verdict =
        pending && m._tag === "selection_rejected"
          ? creationVerdictOf(m, creationContext(s, pending))
          : undefined;
      return {
        ...s,
        selectionId: null,
        selectionFailure: { ...s.selecting, message: m.message },
        ...(pending && verdict?.kind === "refused"
          ? {
              view: { kind: "new" as const, cwd: pending.cwd, projectId: pending.projectId },
              session: null,
            }
          : {}),
        selecting: null,
        pendingCreate: !pending
          ? s.pendingCreate
          : verdict?.kind === "refused"
            ? FirstMessage.rejected(pending, verdict.detail)
            : verdict?.kind === "uncertain" && pending.outcome === "starting"
              ? FirstMessage.failed(pending, verdict)
              : pending,
      };
    }
    case "error":
      if (!m.selectionId || m.selectionId !== s.selectionId || !s.pendingCreate) return s;
      return {
        ...s,
        selecting: null,
        pendingCreate: FirstMessage.failed(
          s.pendingCreate,
          creationVerdictOf(m, creationContext(s, s.pendingCreate)),
        ),
      };
    case "session": {
      const disposition = sessionDelivery(s, m);
      if (disposition === "ignore") return s;
      if (disposition === "resync") return { ...s, resync: true };
      const t = s.session!;
      const e = m.event;
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
