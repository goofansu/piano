/**
 * Re-observes the selected session's own app on attachment, focus and explicit refresh, never by
 * polling or launching anything. Details and terminal UI state are disposable projections, not
 * another authority for app lifetime. Nothing here depends on React.
 */
// Relative, not @shared: module tests load this file directly in Node.
import type { ClientCommand, ServerMessage } from "../../../shared/wire.ts";
import { type AppState, isSession } from "../store.ts";
import { browserEnvironment, type ObservationEnvironment } from "./observation.ts";
import { sessionReady } from "./sessionContext.ts";
import { PREVIEW_STATUS, selectedPreview } from "./sessionPreview.ts";
import type { SendDisposition } from "./ws.ts";

/** The last details answer for one session's app. */
export interface PreviewDetails {
  cwd: string;
  sessionId: string;
  instanceId: string | null;
  logs: string;
  error?: string;
}

/** A confirmed stop for an already-open view, never a replacement app or a launch affordance. */
export interface PreviewTerminal {
  cwd: string;
  sessionId: string;
  instanceId: string;
  state: "stopped";
}

export interface PreviewObservationState {
  /** A re-observation of the session on screen is in flight. */
  refreshing: boolean;
  details: PreviewDetails | null;
  /** Discarded on attachment/owner loss or replacement, including disconnect and unfollow. */
  terminal: PreviewTerminal | null;
}

/** The client to follow; the page's `Client` is one. */
export interface PreviewObservationSource {
  getState: () => AppState;
  subscribe: (listener: () => void) => () => void;
  send: (command: ClientCommand) => SendDisposition;
  listen: (listener: (message: ServerMessage) => void) => () => void;
}

export type PreviewNotify = (message: string, level: "success" | "info") => void;

export interface PreviewObservation {
  getState: () => PreviewObservationState;
  subscribe: (listener: () => void) => () => void;
  /** Re-observe the selected session's app now, sharing any outstanding read. */
  refresh: () => void;
  /** Follows `source`; returns the stop function. */
  follow: (source: PreviewObservationSource, notify: PreviewNotify) => () => void;
}

/** Returning to the page re-observes at most this often. */
const FOCUS_MS = 10_000;
const empty = (): PreviewObservationState => ({ refreshing: false, details: null, terminal: null });

export function createPreviewObservation({
  environment = browserEnvironment,
  now = () => Date.now(),
}: {
  environment?: Pick<ObservationEnvironment, "onFocus">;
  now?: () => number;
} = {}): PreviewObservation {
  let state = empty();
  const listeners = new Set<() => void>();
  const set = (next: PreviewObservationState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  let refresh = () => {};
  let stopFollowing = () => {};

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: () => refresh(),
    follow: (followed, notify) => {
      stopFollowing();
      let active = true;
      let attachment: string | null = null;
      let instanceId: string | null = null;
      // A stop publishes the preview-less session state before its caller-only result arrives.
      let lastInstance: string | null = null;
      let pending: object | null = null;
      let focusedAt = Number.NEGATIVE_INFINITY;
      const notified = new Set<string>();

      const reconcile = () => {
        const page = followed.getState();
        const session = page.session;
        const nextAttachment =
          active &&
          page.view.kind === "session" &&
          sessionReady(page) &&
          session?.hosted &&
          session.sessionId &&
          !session.state.closure
            ? JSON.stringify([
                page.selectionId,
                session.cwd,
                session.sessionId,
                session.cursor?.generation,
              ])
            : null;
        let changed = nextAttachment !== attachment;
        if (changed) {
          attachment = nextAttachment;
          instanceId = null;
          lastInstance = null;
          pending = null;
          set(empty());
        }
        const nextInstance = attachment ? (selectedPreview(page)?.instanceId ?? null) : null;
        if (nextInstance !== instanceId) {
          changed = true;
          instanceId = nextInstance;
          pending = null;
          if (instanceId) lastInstance = instanceId;
          set({ ...empty(), terminal: instanceId ? null : state.terminal });
        }
        return changed;
      };
      const read = () => {
        reconcile();
        if (!attachment || !instanceId || pending || state.terminal) return;
        // Claim before sending: send may synchronously disconnect or deliver its answer.
        const request = {};
        pending = request;
        set({ ...state, refreshing: true });
        if (followed.send(PREVIEW_STATUS) === "not-sent" && pending === request) {
          pending = null;
          set({ ...state, refreshing: false });
        }
      };
      refresh = read;
      const update = () => {
        if (reconcile()) read();
      };
      const unfocus = environment.onFocus(() => {
        if (now() - focusedAt < FOCUS_MS) return;
        focusedAt = now();
        read();
      });
      const unlisten = followed.listen((m) => {
        if (!active || m._tag !== "action_result") return;
        reconcile();
        const onScreen = attachment !== null && isSession(followed.getState().session, m);
        if (m.result._tag === "preview_observed") {
          // Results carry no selection, generation or request ID. Exact current app identity and
          // an outstanding read are necessary; same-instance replies across reattachment remain
          // indistinguishable until the wire carries the originating attachment/request identity.
          if (!onScreen || !pending || !instanceId || m.result.instanceId !== instanceId) return;
          pending = null;
          const { logs, error } = m.result;
          set({
            ...state,
            refreshing: false,
            details: {
              cwd: m.cwd,
              sessionId: m.sessionId,
              instanceId,
              logs,
              ...(error && { error }),
            },
          });
        } else if (m.result._tag === "preview_stopped") {
          const stopped = m.result.outcome !== "not-current";
          const key = JSON.stringify([m.cwd, m.sessionId, m.result.instanceId, stopped]);
          if (!notified.has(key)) {
            notified.add(key);
            if (stopped) notify("Preview stopped", "success");
            else notify("That preview had already stopped or been replaced.", "info");
          }
          if (stopped && onScreen && lastInstance === m.result.instanceId) {
            pending = null;
            set({
              ...empty(),
              terminal: {
                cwd: m.cwd,
                sessionId: m.sessionId,
                instanceId: m.result.instanceId,
                state: "stopped",
              },
            });
          }
        }
      });
      const unsubscribe = followed.subscribe(update);
      const stop = () => {
        if (!active) return;
        active = false;
        unsubscribe();
        unlisten();
        unfocus();
        refresh = () => {};
        pending = null;
        set(empty());
      };
      stopFollowing = stop;
      update();
      return stop;
    },
  };
}

/** The page's one preview observation; App follows the client with it. */
export const previewObservation = createPreviewObservation();
