/**
 * The browser's side of the wire: one client per page owns the projected state, the connection,
 * selection correlation, re-selection after reconnect or resync (INV-02/05), which server
 * messages and connection losses become notifications, the New page's default directory, and
 * asking Pi about the focused directory's models and trust. React only subscribes and sends;
 * nothing here depends on render timing.
 */
import type { ClientCommand, ServerMessage } from "@shared/wire";
import { type Action, type AppState, reduce, sessionDelivery } from "../store.ts";
import {
  closureNeedsAttention,
  directoryTrust,
  focusedDirectory,
  sessionReady,
} from "./sessionContext.ts";
import { readStorage, writeStorage } from "./storage.ts";
import type { Connection, ConnectionHandlers, DisconnectReason } from "./ws.ts";

export type NotifyLevel = "success" | "info" | "warning" | "error";
export type Notify = (message: string, level?: NotifyLevel) => void;

/** Browser-local changes; connection status, server frames and selection correlation stay with the client. */
export type LocalAction = Exclude<Action, { type: "connected" | "server" | "selecting" }>;

/** The directory the last session was created in, offered first on a fresh New page. */
export interface LastDirectory {
  read: () => string | null;
  write: (cwd: string) => void;
}

/** What the person is told when the connection closes for a reason they should know. */
const disconnectNotices: Record<DisconnectReason, [string, NotifyLevel]> = {
  behind: [
    "Connection fell behind. Reconnecting for a current view; some live notices may have been missed.",
    "warning",
  ],
  "too-large": [
    "Session view exceeds the delivery limit. Reduce its context before reloading.",
    "error",
  ],
};

const LAST_DIR = "piano.lastDir";
const storedLastDirectory: LastDirectory = {
  read: () => readStorage(LAST_DIR),
  write: (cwd) => writeStorage(LAST_DIR, cwd),
};

export interface ClientOptions {
  initial: AppState;
  /** Opens the auto-reconnecting transport (`openConnection` in the browser). */
  connect: (handlers: ConnectionHandlers) => Connection;
  notify: Notify;
  newSelectionId?: () => string;
  /** Defaults to this browser's storage. */
  lastDirectory?: LastDirectory;
}

/** Live projections may share a paint; input and connection changes must render immediately. */
export type ClientUpdate = "live" | "immediate";

export interface Client {
  getState: () => AppState;
  /** Called synchronously after projection; render subscribers may defer only live updates. */
  subscribe: (listener: (update: ClientUpdate) => void) => () => void;
  /** Opens the connection; the returned function closes it. */
  start: () => () => void;
  /** Sends a command, correlating `select`, `create_session` and `act` with the current attachment. */
  send: (command: ClientCommand) => void;
  /** Selects a session unless it is already the one on screen or being fetched. */
  select: (cwd: string, sessionId: string | null) => void;
  dispatch: (action: LocalAction) => void;
  /** Hears each server frame after it is projected, for a caller correlating its own requests; returns the unsubscribe function. */
  listen: (listener: (message: ServerMessage) => void) => () => void;
}

export function createClient({
  initial,
  connect,
  notify,
  newSelectionId = () => crypto.randomUUID(),
  lastDirectory = storedLastDirectory,
}: ClientOptions): Client {
  /** A New page opened without a directory or project starts in the last one used, else the first folder. */
  const withNewPageDirectory = (s: AppState) => {
    if (s.view.kind !== "new" || s.view.cwd || s.view.projectId) return s;
    const cwd = lastDirectory.read() || s.folders[0]?.path;
    return cwd ? reduce(s, { type: "new_directory", cwd }) : s;
  };

  let state = withNewPageDirectory(initial);
  let connection: Connection | null = null;
  /** The focused directory and catalog revision last asked about on this connection. */
  let asked: string | null = null;
  const manualTrust = new Set<string>();
  const listeners = new Set<(update: ClientUpdate) => void>();
  const messageListeners = new Set<(message: ServerMessage) => void>();

  /**
   * One models and trust request per focused directory, catalog revision and connection: a
   * reconnect or `catalogs_invalidated` asks again, and only for the directory on screen.
   * A removed checkout has nothing to ask about.
   */
  const askAboutFocus = () => {
    if (!state.connected) {
      asked = null;
      return;
    }
    const focus = focusedDirectory(state);
    if (!focus || focus.checkoutMissing) return;
    const key = `${focus.cwd}\0${state.catalogRevision}`;
    if (key === asked) return;
    asked = key;
    connection?.send({ _tag: "models", cwd: focus.cwd });
    connection?.send({ _tag: "trust", cwd: focus.cwd });
  };

  const apply = (action: Action) => {
    const next = withNewPageDirectory(reduce(state, action));
    if (next === state) return;
    state = next;
    askAboutFocus();
    for (const listener of listeners) listener(action.type === "server" ? "live" : "immediate");
  };

  const send = (m: ClientCommand) => {
    if (m._tag === "select" || m._tag === "create_session") {
      if (m._tag === "create_session") lastDirectory.write(m.cwd);
      const selectionId = newSelectionId();
      apply({
        type: "selecting",
        selectionId,
        cwd: m.cwd,
        sessionId: m._tag === "select" ? m.sessionId : null,
        firstMessage:
          m._tag === "create_session" && (m.text?.trim() || m.attachments?.length)
            ? {
                text: m.text ?? "",
                attachments: m.attachments?.map((a) => ({
                  kind: "image" as const,
                  url: `data:${a.mimeType};base64,${a.data}`,
                })),
              }
            : undefined,
      });
      connection?.send({ ...m, selectionId });
    } else if (m._tag === "act") {
      // An action belongs to the attachment it was aimed at; never send it on a stale or pending one.
      if (sessionReady(state) && state.selectionId)
        connection?.send({ ...m, selectionId: state.selectionId });
    } else {
      if (m._tag === "set_trust") manualTrust.add(m.path);
      connection?.send(m);
    }
  };

  /** A fresh attachment for the session on screen, so the server re-attaches this socket. */
  const reselect = (current: { cwd: string; sessionId: string | null } | null) => {
    if (current) send({ _tag: "select", cwd: current.cwd, sessionId: current.sessionId });
  };

  const onStatus = (connected: boolean, reason?: DisconnectReason) => {
    if (!connected) manualTrust.clear();
    apply({ type: "connected", connected });
    if (connected) reselect(state.session ?? state.selecting);
    else if (reason) notify(...disconnectNotices[reason]);
  };

  const onMessage = (m: ServerMessage) => {
    // Decide before applying: a frame the projection rejects must not notify either.
    const notifySession = m._tag === "session" && sessionDelivery(state, m) === "apply";
    const wasResync = state.resync;
    let trustNotice: string | undefined;
    if (m._tag === "trust") {
      const displayed = directoryTrust(state, m.cwd);
      if (
        m.cwd === focusedDirectory(state)?.cwd &&
        m.trust.required &&
        displayed?.required &&
        displayed.trusted !== m.trust.trusted &&
        m.requested === undefined &&
        !manualTrust.has(m.cwd)
      )
        trustNotice = `Pi marked this folder as ${m.trust.trusted ? "trusted" : "untrusted"}.`;
      // A decision can finish with the opposite outcome if a Pi extension saves trust on reload.
      // Only its explicit reply settles it; a concurrent probe is not an acknowledgement.
      if (m.requested !== undefined) manualTrust.delete(m.cwd);
    }
    // Trust failures use the uncorrelated error reply; don't leave future changes suppressed.
    if (m._tag === "error" && !m.selectionId) manualTrust.clear();
    apply({ type: "server", message: m });
    if (trustNotice) notify(trustNotice, "info");
    if (!wasResync && state.resync && state.connected) reselect(state.session);
    if (m._tag === "error") notify(m.message, "error");
    else if (m._tag === "toast") notify(m.message, m.level);
    else if (m._tag === "action_result" && m.result._tag === "queue_restored" && m.result.stopError)
      notify(m.result.stopError, "error");
    else if (m._tag === "worktree_result" && m.result.status === "ready" && m.result.creation)
      notify(
        `Created ${m.result.branch} from ${m.result.creation.baseBranch} · hooks ${m.result.creation.hooks}`,
        "success",
      );
    else if (notifySession && m._tag === "session" && m.event._tag === "notice")
      notify(m.event.message, m.event.level);
    else if (
      notifySession &&
      m._tag === "session" &&
      m.event._tag === "closed" &&
      closureNeedsAttention(m.event.closure)
    )
      notify(`Pi stopped: ${m.event.closure.detail}`, "warning");
    for (const listener of messageListeners) listener(m);
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
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
      if (
        (state.selecting || sessionReady(state)) &&
        current &&
        current.cwd === cwd &&
        current.sessionId === sessionId &&
        state.view.kind === "session"
      )
        return;
      send({ _tag: "select", cwd, sessionId });
    },
    dispatch: apply,
    listen: (listener) => {
      messageListeners.add(listener);
      return () => {
        messageListeners.delete(listener);
      };
    },
  };
}
