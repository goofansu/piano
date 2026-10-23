/**
 * Keeps the selected session's preview honest without polling: Piano re-observes the app once for
 * each attachment to a session that owns one, when the person comes back to the page, and when
 * they open the preview's details. Each read is one bounded status of that session's own app; it
 * never starts Pi or launches anything. The last answer's logs are kept for the details view.
 * Nothing here depends on React.
 */
// Relative, not @shared: module tests load this file directly in Node.
import type { ClientCommand, ServerMessage } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";
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

export interface PreviewObservationState {
  /** A re-observation of the session on screen is in flight. */
  refreshing: boolean;
  details: PreviewDetails | null;
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
  /** Re-observe the selected session's app now, if it owns one. */
  refresh: () => void;
  /** Follows `source`; returns the stop function. */
  follow: (source: PreviewObservationSource, notify: PreviewNotify) => () => void;
}

/** Returning to the page re-observes at most this often. */
const FOCUS_MS = 10_000;

export function createPreviewObservation({
  environment = browserEnvironment,
  now = () => Date.now(),
}: {
  environment?: Pick<ObservationEnvironment, "onFocus">;
  now?: () => number;
} = {}) {
  let state: PreviewObservationState = { refreshing: false, details: null };
  const listeners = new Set<() => void>();
  const set = (next: PreviewObservationState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  let source: PreviewObservationSource | undefined;

  const refresh = () => {
    const page = source?.getState();
    if (!source || !page || !sessionReady(page) || !selectedPreview(page)) return;
    if (source.send(PREVIEW_STATUS) !== "not-sent" && !state.refreshing)
      set({ ...state, refreshing: true });
  };

  const observation: PreviewObservation = {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    follow: (followed, notify) => {
      source = followed;
      /** The attachment already re-observed; a reconnect or another session is a new one. */
      let observed: string | null = null;
      let focusedAt = Number.NEGATIVE_INFINITY;
      const update = () => {
        const page = followed.getState();
        if (state.refreshing && !page.connected) set({ ...state, refreshing: false });
        if (!sessionReady(page) || page.selectionId === observed || !selectedPreview(page)) return;
        observed = page.selectionId;
        refresh();
      };
      const unfocus = environment.onFocus(() => {
        if (now() - focusedAt < FOCUS_MS) return;
        focusedAt = now();
        refresh();
      });
      const unlisten = followed.listen((m) => {
        if (m._tag !== "action_result") return;
        const page = followed.getState().session;
        const onScreen = page?.cwd === m.cwd && page.sessionId === m.sessionId;
        if (m.result._tag === "preview_observed") {
          if (!onScreen) return;
          const { instanceId, logs, error } = m.result;
          set({
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
          if (m.result.outcome === "not-current")
            notify("That preview had already stopped or been replaced.", "info");
          else notify("Preview stopped", "success");
        }
      });
      update();
      const unsubscribe = followed.subscribe(update);
      return () => {
        unsubscribe();
        unlisten();
        unfocus();
        if (source === followed) source = undefined;
      };
    },
  };
  return observation;
}

/** The page's one preview observation; App follows the client with it. */
export const previewObservation = createPreviewObservation();
