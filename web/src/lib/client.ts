/**
 * The browser's side of the wire: one client per page owns the projected state, the connection,
 * selection correlation, re-selection after reconnect or resync (INV-02/05), which server
 * messages and connection losses become notifications, the New page's and project home's default
 * directory, and
 * asking Pi about the focused directory's models and trust. React only subscribes and sends;
 * nothing here depends on render timing.
 */
import type { ClientCommand, ServerMessage } from "@shared/wire";
// Relative, not @shared: module tests load this file directly in Node.
import { refusedAttempt } from "../../../shared/creationVerdict.ts";
import { closureNeedsAttention } from "../../../shared/sessionStatus.ts";
import { type Action, type AppState, reduce, sessionDelivery } from "../store.ts";
import { canDecideTrust, trustNotice } from "./directoryTrust.ts";
import { LOCAL } from "./machine.ts";
import { machineKey } from "./machineMemory.ts";
import { projectStartDirectory } from "./projectHome.ts";
import { folderFor } from "./sessionCatalog.ts";
import { focusedDirectory, sessionReady } from "./sessionContext.ts";
import { startPage } from "./startPage.ts";
import { readStorage, writeStorage } from "./storage.ts";
import type { Connection, ConnectionHandlers, DisconnectReason, SendDisposition } from "./ws.ts";

export type NotifyLevel = "success" | "info" | "warning" | "error";
export type Notify = (message: string, level?: NotifyLevel) => void;

/** Browser-local changes; connection status, server frames and selection correlation stay with the client. */
export type LocalAction = Exclude<
  Action,
  { type: "connected" | "server" | "selecting" | "trust_pending" }
>;

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

const NOT_SENT = "Message not sent. Your draft is kept; retry when the session reconnects.";
const TOO_LARGE = "Message too large to send to this machine. Your draft is kept.";

/** The input a creation carries, shown as the new session's first message until Pi records it. */
const firstMessage = (m: Extract<ClientCommand, { _tag: "create_session" }>) =>
  m.text?.trim() || m.attachments?.length
    ? {
        text: m.text ?? "",
        attachments: m.attachments?.map((a) => ({
          kind: "image" as const,
          url: `data:${a.mimeType};base64,${a.data}`,
        })),
      }
    : undefined;

/** The last directory a session started in on one machine, in this browser's storage. */
export function storedLastDirectory(machineId: string): LastDirectory {
  const key = machineKey(machineId, "lastDir");
  return { read: () => readStorage(key), write: (cwd) => writeStorage(key, cwd) };
}

export interface ClientOptions {
  initial: AppState;
  /** Opens the auto-reconnecting transport (`openConnection` in the browser). */
  connect: (handlers: ConnectionHandlers) => Connection;
  notify: Notify;
  newSelectionId?: () => string;
  /** Defaults to this browser's storage for Local. */
  lastDirectory?: LastDirectory;
  /**
   * The New page starts only in a folder open on this machine or one of its worktrees (a remote,
   * where nothing else can be chosen): a remembered directory that is no longer one gives way to
   * the first folder once the registry says so.
   */
  openFoldersOnly?: boolean;
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
  send: (command: ClientCommand) => SendDisposition;
  /** Capture navigation and connection identity before async preparation; never retarget a late send. */
  captureSend: () => (
    command: ClientCommand,
    preview?: ReturnType<typeof firstMessage>,
  ) => SendDisposition;
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
  lastDirectory = storedLastDirectory(LOCAL.id),
  openFoldersOnly = false,
}: ClientOptions): Client {
  /**
   * A New page opened without a directory or project starts in the last one used, else the first
   * folder; a project's home starts in its most recent member's folder once the registry says which.
   */
  const withNewPageDirectory = (s: AppState) => {
    const page = startPage(s.view);
    if (!page) return s;
    const closed = openFoldersOnly && s.registryLoaded && !!page.cwd && !folderFor(s, page.cwd);
    if (page.cwd && !closed) return s;
    const remembered = closed ? undefined : lastDirectory.read();
    const cwd =
      page.kind === "project"
        ? projectStartDirectory(s, page.projectId)
        : page.projectId
          ? undefined
          : remembered || s.folders[0]?.path;
    return cwd ? reduce(s, { type: "new_directory", cwd }) : s;
  };

  let state = withNewPageDirectory(initial);
  let connection: Connection | null = null;
  let navigationEpoch = 0;
  /** The focused directory and catalog revision last asked about on this connection. */
  let asked: string | null = null;
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
    if (
      next.selectionId !== state.selectionId ||
      next.view.kind !== state.view.kind ||
      focusedDirectory(next)?.cwd !== focusedDirectory(state)?.cwd ||
      next.connected !== state.connected
    )
      navigationEpoch++;
    state = next;
    askAboutFocus();
    for (const listener of listeners) listener(action.type === "server" ? "live" : "immediate");
  };

  /** Why a send the connection declined was not sent. A lost socket reports itself before `send`
   * returns, so one still connected afterwards refused the message itself: it can never fit. */
  const notSent = () => (state.connected ? TOO_LARGE : NOT_SENT);

  const send = (m: ClientCommand, preview?: ReturnType<typeof firstMessage>): SendDisposition => {
    if (m._tag === "select" || m._tag === "create_session") {
      const selectionId = newSelectionId();
      const selecting = () =>
        apply({
          type: "selecting",
          selectionId,
          cwd: m.cwd,
          sessionId: m._tag === "select" ? m.sessionId : null,
          firstMessage: m._tag === "create_session" ? (preview ?? firstMessage(m)) : undefined,
          attemptId: m.attemptId,
          projectId: m._tag === "create_session" ? m.projectId : undefined,
          options: m._tag === "create_session" ? m.options : undefined,
          reconciling: m._tag === "select" && !!m.attemptId,
        });
      // A select is navigation: the pane switches at once and a reconnect re-sends it (INV-02/05).
      if (m._tag === "select") {
        selecting();
        return connection?.send({ ...m, selectionId }) ?? "not-sent";
      }
      // A creation carries the person's input and never replays, so one known not sent leaves them
      // on the New page with their draft. Any other outcome opens the session; a connection lost
      // during the send has already been applied, so its first message shows as uncertain.
      const disposition = connection?.send({ ...m, selectionId }) ?? "not-sent";
      if (disposition === "not-sent") {
        if (firstMessage(m)) notify(notSent(), "warning");
      } else {
        lastDirectory.write(m.cwd);
        selecting();
      }
      return disposition;
    } else if (m._tag === "act") {
      // An action belongs to the attachment it was aimed at; never send it on a stale or pending one.
      const ready = sessionReady(state) && state.selectionId;
      const disposition = ready
        ? (connection?.send({ ...m, selectionId: state.selectionId! }) ?? "not-sent")
        : "not-sent";
      if (m.action._tag === "prompt" || m.action._tag === "steer") {
        if (disposition === "not-sent") notify(ready ? notSent() : NOT_SENT, "warning");
        else if (disposition === "uncertain")
          notify(
            "Message delivery is uncertain. Check the conversation before sending again.",
            "warning",
          );
      }
      return disposition;
    } else {
      if (m._tag === "set_trust") {
        if (!canDecideTrust(state, m.path)) return "not-sent";
        apply({ type: "trust_pending", cwd: m.path });
      }
      return connection?.send(m) ?? "not-sent";
    }
  };

  /** A fresh attachment for the session on screen, so the server re-attaches this socket. */
  const reselect = (current: { cwd: string; sessionId: string | null } | null) => {
    if (current) send({ _tag: "select", cwd: current.cwd, sessionId: current.sessionId });
  };

  const onStatus = (connected: boolean, reason?: DisconnectReason) => {
    apply({ type: "connected", connected, lost: !connected });
    if (connected) {
      const pending = state.pendingCreate;
      if (pending && pending.outcome === "uncertain" && !state.session?.sessionId)
        send({ _tag: "select", cwd: pending.cwd, sessionId: null, attemptId: pending.attemptId });
      else reselect(state.session ?? state.selecting);
    } else if (reason) notify(...disconnectNotices[reason]);
  };

  const onMessage = (m: ServerMessage) => {
    // Decide before applying: a frame the projection rejects must not notify either.
    const notifySession = m._tag === "session" && sessionDelivery(state, m) === "apply";
    const wasResync = state.resync;
    // A creation's verdict arriving after the person moved on changes nothing on screen.
    const elsewhere =
      m._tag === "selection_rejected" &&
      refusedAttempt(m) !== undefined &&
      m.selectionId !== state.selectionId;
    const notice =
      m._tag === "trust" ? trustNotice(state, focusedDirectory(state)?.cwd, m) : undefined;
    apply({ type: "server", message: m });
    if (notice) notify(notice, "info");
    if (!wasResync && state.resync && state.connected) reselect(state.session);
    if (m._tag === "error" || m._tag === "trust_failed") notify(m.message, "error");
    else if (elsewhere) notify(`Could not start session: ${m.message}`, "error");
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
    captureSend: () => {
      const epoch = navigationEpoch;
      const socket = connection;
      return (command, preview) =>
        epoch === navigationEpoch && socket === connection && state.connected
          ? send(command, preview)
          : "not-sent";
    },
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
