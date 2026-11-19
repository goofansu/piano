import type { ClientCommand, ServerMessage } from "@shared/wire";
import { refusedAttempt } from "../../../shared/creationVerdict.ts";
import { closureNeedsAttention } from "../../../shared/sessionStatus.ts";
import { type Action, type AppState, reduce, sessionDelivery } from "../store.ts";
import { QUEUE_IMAGES_REMOVED_NOTICE, QUEUE_RESTORED_NOTICE } from "./composerControl.ts";
import { browserTimers, type RequestTimers } from "./correlatedRequest.ts";
import { machineMemory } from "./machineMemory.ts";
import type { MachineOffers } from "./machineOffers.ts";
import { restoredQueueText } from "./messageDraft.ts";
import { projectStartDirectory } from "./projectHome.ts";
import { focusedDirectory, sessionReady } from "./sessionContext.ts";
import { startPage } from "./startPage.ts";
import { createTrustDecisions, trustNotice } from "./trustDecision.ts";
import type { Connection, ConnectionHandlers, DisconnectReason, SendDisposition } from "./ws.ts";

export type NotifyLevel = "success" | "info" | "warning" | "error";
export type Notify = (message: string, level?: NotifyLevel) => void;

export type LocalAction = Exclude<
  Action,
  { type: "connected" | "server" | "selecting" | "trust_decision" | "trust_settled" }
>;

export interface LastDirectory {
  read: () => string | null;
  write: (cwd: string) => void;
}

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

export function storedLastDirectory(machineId: string): LastDirectory {
  const memory = machineMemory(machineId, "lastDir");
  return { read: memory.read, write: memory.write };
}

export interface ClientOptions {
  initial: AppState;
  connect: (handlers: ConnectionHandlers) => Connection;
  notify: Notify;
  newSelectionId?: () => string;
  lastDirectory?: LastDirectory;
  startsSessionIn: MachineOffers["startsSessionIn"];
  timers?: RequestTimers;
}

export type ClientUpdate = "live" | "immediate";

export interface CapturedSend {
  send: (command: ClientCommand, preview?: ReturnType<typeof firstMessage>) => SendDisposition;
  signal: AbortSignal;
}

export interface Client {
  getState: () => AppState;
  subscribe: (listener: (update: ClientUpdate) => void) => () => void;
  start: () => () => void;
  send: (command: ClientCommand) => SendDisposition;
  decideTrust: (path: string, trusted: boolean) => void;
  captureSend: () => CapturedSend;
  select: (cwd: string, sessionId: string | null) => void;
  dispatch: (action: LocalAction) => void;
  listen: (listener: (message: ServerMessage) => void) => () => void;
}

export function createClient({
  initial,
  connect,
  notify,
  newSelectionId = () => crypto.randomUUID(),
  lastDirectory = { read: () => null, write: () => {} },
  startsSessionIn,
  timers = browserTimers,
}: ClientOptions): Client {
  let unverifiedDefault: string | undefined;
  const withNewPageDirectory = (s: AppState) => {
    const page = startPage(s.view);
    const unverified = !!page?.cwd && page.cwd === unverifiedDefault;
    if (s.registryLoaded) unverifiedDefault = undefined;
    if (!page) return s;
    const startable = (cwd: string) => !s.registryLoaded || startsSessionIn(s, cwd);
    if (page.cwd && !(unverified && !startable(page.cwd))) return s;
    const cwd =
      page.kind === "project"
        ? projectStartDirectory(s, page.projectId, startable)
        : page.projectId
          ? undefined
          : [lastDirectory.read(), ...s.folders.map((f) => f.path)].find(
              (c): c is string => !!c && startable(c),
            );
    if (!cwd) return s;
    if (!s.registryLoaded) unverifiedDefault = cwd;
    return reduce(s, { type: "new_directory", cwd });
  };

  let state = withNewPageDirectory(initial);
  let connection: Connection | null = null;
  let epoch = new AbortController();
  const advanceEpoch = () => {
    epoch.abort();
    epoch = new AbortController();
  };
  let asked: string | null = null;
  let observing: string | null = null;
  const listeners = new Set<(update: ClientUpdate) => void>();
  const messageListeners = new Set<(message: ServerMessage) => void>();

  const askAboutFocus = () => {
    if (!state.connected) {
      asked = null;
      observing = null;
      return;
    }
    if (observing || !state.registryLoaded) return;
    const focus = focusedDirectory(state);
    if (!focus || focus.checkoutMissing) return;
    const key = `${focus.cwd}\0${state.catalogRevision}`;
    if (key === asked) return;
    asked = key;
    const requestId = crypto.randomUUID();
    observing = requestId;
    const disposition =
      connection?.send({ _tag: "directory", cwd: focus.cwd, requestId }) ?? "not-sent";
    if (disposition === "not-sent" && observing === requestId) observing = null;
  };

  const apply = (action: Action) => {
    const next = withNewPageDirectory(reduce(state, action));
    if (next === state) return;
    if (
      next.selectionId !== state.selectionId ||
      next.view.kind !== state.view.kind ||
      focusedDirectory(next)?.cwd !== focusedDirectory(state)?.cwd ||
      startPage(next.view)?.projectId !== startPage(state.view)?.projectId ||
      next.connected !== state.connected
    )
      advanceEpoch();
    state = next;
    askAboutFocus();
    for (const listener of listeners) listener(action.type === "server" ? "live" : "immediate");
  };

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
      if (m._tag === "select") {
        selecting();
        return connection?.send({ ...m, selectionId }) ?? "not-sent";
      }
      const disposition = connection?.send({ ...m, selectionId }) ?? "not-sent";
      if (disposition === "not-sent") {
        if (firstMessage(m)) notify(notSent(), "warning");
      } else {
        lastDirectory.write(m.cwd);
        selecting();
      }
      return disposition;
    } else if (m._tag === "act") {
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
    } else return connection?.send(m) ?? "not-sent";
  };

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
    if (m._tag === "directory") {
      if (m.requestId !== observing) return;
      if (m.result.status === "ready") {
        const trust = { _tag: "trust" as const, cwd: m.cwd, trust: m.result.trust };
        const notice = trustNotice(state, focusedDirectory(state)?.cwd, trust);
        apply({ type: "server", message: { _tag: "models", catalog: m.result.catalog } });
        apply({ type: "server", message: trust });
        if (notice) notify(notice, "info");
      } else notify(m.result.message, "error");
      if (observing === m.requestId) {
        observing = null;
        askAboutFocus();
      }
    }
    const notifySession = m._tag === "session" && sessionDelivery(state, m) === "apply";
    const wasResync = state.resync;
    const elsewhere =
      m._tag === "selection_rejected" &&
      refusedAttempt(m) !== undefined &&
      m.selectionId !== state.selectionId;
    const notice =
      m._tag === "trust" ? trustNotice(state, focusedDirectory(state)?.cwd, m) : undefined;
    apply({ type: "server", message: m });
    if (notice) notify(notice, "info");
    if (!wasResync && state.resync && state.connected) reselect(state.session);
    if (m._tag === "error") notify(m.message, "error");
    else if (elsewhere) notify(`Could not start session: ${m.message}`, "error");
    else if (m._tag === "toast") notify(m.message, m.level);
    else if (m._tag === "action_result" && m.result._tag === "queue_restored") {
      if (m.result.messages.length)
        notify(
          restoredQueueText(m.result.messages)
            ? QUEUE_RESTORED_NOTICE
            : QUEUE_IMAGES_REMOVED_NOTICE,
          "info",
        );
      if (m.result.stopError) notify(m.result.stopError, "error");
    } else if (m._tag === "worktree_result" && m.result.status === "ready" && m.result.creation)
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

  const subscribe = (listener: (update: ClientUpdate) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const listen = (listener: (message: ServerMessage) => void) => {
    messageListeners.add(listener);
    return () => {
      messageListeners.delete(listener);
    };
  };
  const decideTrust = createTrustDecisions({
    client: {
      getState: () => state,
      subscribe,
      listen,
      send,
    },
    timers,
    notify,
    dispatch: apply,
  });

  return {
    getState: () => state,
    subscribe,
    start: () => {
      const opened = connect({ onMessage, onStatus });
      connection = opened;
      advanceEpoch();
      return () => {
        opened.close();
        if (connection !== opened) return;
        connection = null;
        advanceEpoch();
      };
    },
    send,
    decideTrust,
    captureSend: () => {
      const { signal } = epoch;
      return {
        signal,
        send: (command, preview) =>
          !signal.aborted && state.connected ? send(command, preview) : "not-sent",
      };
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
    listen,
  };
}
