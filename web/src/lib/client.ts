/**
 * The browser's side of the wire: one client per page owns the projected state, the connection,
 * selection correlation, re-selection after reconnect or resync (INV-02/05) and which server
 * messages become notifications. React only subscribes and sends; nothing here depends on render timing.
 */
import type { ClientCommand, ServerMessage } from "@shared/wire";
import { type Action, type AppState, reduce, sessionDelivery } from "../store.ts";
import { sessionReady } from "./sessionContext.ts";
import type { Connection, ConnectionHandlers } from "./ws.ts";

export type NotifyLevel = "success" | "info" | "warning" | "error";
export type Notify = (message: string, level?: NotifyLevel) => void;

/** Browser-local changes; connection status, server frames and selection correlation stay with the client. */
export type LocalAction = Exclude<Action, { type: "connected" | "server" | "selecting" }>;

export interface ClientOptions {
  initial: AppState;
  /** Opens the auto-reconnecting transport (`openConnection` in the browser). */
  connect: (handlers: ConnectionHandlers) => Connection;
  notify: Notify;
  newSelectionId?: () => string;
}

export interface Client {
  getState: () => AppState;
  subscribe: (listener: () => void) => () => void;
  /** Opens the connection; the returned function closes it. */
  start: () => () => void;
  /** Sends a command, correlating `select`, `create_session` and `act` with the current attachment. */
  send: (command: ClientCommand) => void;
  /** Selects a session unless it is already the one on screen or being fetched. */
  select: (cwd: string, sessionId: string | null) => void;
  dispatch: (action: LocalAction) => void;
}

export function createClient({ initial, connect, notify, newSelectionId = () => crypto.randomUUID() }: ClientOptions): Client {
  let state = initial;
  let connection: Connection | null = null;
  const listeners = new Set<() => void>();

  const apply = (action: Action) => {
    const next = reduce(state, action);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  };

  const send = (m: ClientCommand) => {
    if (m._tag === "select" || m._tag === "create_session") {
      const selectionId = newSelectionId();
      apply({ type: "selecting", selectionId, cwd: m.cwd, sessionId: m._tag === "select" ? m.sessionId : null,
        firstMessage: m._tag === "create_session" && (m.text?.trim() || m.attachments?.length)
          ? { text: m.text ?? "", attachments: m.attachments?.map(a => ({ kind: "image" as const, url: `data:${a.mimeType};base64,${a.data}` })) } : undefined });
      connection?.send({ ...m, selectionId });
    } else if (m._tag === "act") {
      // An action belongs to the attachment it was aimed at; never send it on a stale or pending one.
      if (sessionReady(state) && state.selectionId) connection?.send({ ...m, selectionId: state.selectionId });
    } else connection?.send(m);
  };

  /** A fresh attachment for the session on screen, so the server re-attaches this socket. */
  const reselect = (current: { cwd: string; sessionId: string | null } | null) => {
    if (current) send({ _tag: "select", cwd: current.cwd, sessionId: current.sessionId });
  };

  const onStatus = (connected: boolean) => {
    apply({ type: "connected", connected });
    if (connected) reselect(state.session ?? state.selecting);
  };

  const onMessage = (m: ServerMessage) => {
    // Decide before applying: a frame the projection rejects must not notify either.
    const notifySession = m._tag === "session" && sessionDelivery(state, m) === "apply";
    const wasResync = state.resync;
    apply({ type: "server", message: m });
    if (!wasResync && state.resync && state.connected) reselect(state.session);
    if (m._tag === "error") notify(m.message, "error");
    else if (m._tag === "toast") notify(m.message, m.level);
    else if (m._tag === "action_result" && m.result._tag === "queue_restored" && m.result.stopError) notify(m.result.stopError, "error");
    else if (m._tag === "worktree_result" && m.result.status === "ready" && m.result.creation) notify(`Created ${m.result.branch} from ${m.result.creation.baseBranch} · hooks ${m.result.creation.hooks}`, "success");
    else if (notifySession && m._tag === "session" && m.event._tag === "notice") notify(m.event.message, m.event.level);
    else if (notifySession && m._tag === "session" && m.event._tag === "closed" && !/released|code 0\b/.test(m.event.reason)) notify(`Pi stopped: ${m.event.reason}`, "warning");
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start: () => {
      const opened = connect({ onMessage, onStatus });
      connection = opened;
      return () => {
        opened.close();
        if (connection === opened) connection = null;
      };
    },
    send,
    select: (cwd, sessionId) => {
      const current = state.session ?? state.selecting;
      if (current && current.cwd === cwd && current.sessionId === sessionId && state.view.kind === "session") return;
      send({ _tag: "select", cwd, sessionId });
    },
    dispatch: apply,
  };
}
