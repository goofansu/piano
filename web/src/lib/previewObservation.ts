/**
 * Re-observes the selected session's own app on attachment, focus and explicit refresh, never by
 * polling or launching anything. Details and terminal UI state are disposable projections, not
 * another authority for app lifetime. Nothing here depends on React.
 */
// Relative, not @shared: module tests load this file directly in Node.
import type { ClientCommand, ServerMessage, SessionPreview } from "../../../shared/wire.ts";
import { type AppState, isSession } from "../store.ts";
import { browserEnvironment, type ObservationEnvironment } from "./observation.ts";
import { sessionReady } from "./sessionContext.ts";
import { hostedPreview, previewStatus } from "./sessionPreview.ts";
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
  /** The app whose last read ended unanswered, so its status is unknown until a read answers. */
  unconfirmed: string | null;
}

/**
 * The selected session's app as this page sees it, which the session rail, Preview, Details and
 * palette all show. The store's app, unless this page cannot vouch for its status: without an
 * attachment (`sessionReady`), or after its last status read went unanswered (`unconfirmed`), it
 * is unknown, without its frame or link, until a read answers. Neither says anything about the
 * server-owned app's lifetime: it is not stopped.
 */
export function seenPreview(
  page: AppState,
  observed: Pick<PreviewObservationState, "unconfirmed">,
): SessionPreview | undefined {
  const preview = hostedPreview(page);
  if (!preview || (sessionReady(page) && preview.instanceId !== observed.unconfirmed))
    return preview;
  return { ...preview, state: "unknown", ready: false, warming: false, url: null, detail: "" };
}

/** Whether a record was taken for the session the page shows now: same checkout, same session. */
const ofSession = (page: AppState, record: { cwd: string; sessionId: string }) =>
  record.cwd === page.session?.cwd && record.sessionId === page.session?.sessionId;

/**
 * The details answer for the app `seenPreview` shows, or undefined when the last answer belongs to
 * another session, checkout or app instance, or there is no app to inspect.
 */
export function seenDetails(
  page: AppState,
  observed: Pick<PreviewObservationState, "details" | "unconfirmed">,
): PreviewDetails | undefined {
  const preview = seenPreview(page, observed);
  const details = observed.details;
  return preview && details && ofSession(page, details) && details.instanceId === preview.instanceId
    ? details
    : undefined;
}

/**
 * Whether a view that inspected `viewedInstance` shows its app as stopped: the session has no app
 * now, and the confirmed stop is of that very instance in this session. Only a view that actually
 * inspected the app can keep its stop; a view opened after it shows no app at all.
 */
export function seenStop(
  page: AppState,
  observed: Pick<PreviewObservationState, "terminal">,
  viewedInstance: string | null,
): boolean {
  const terminal = observed.terminal;
  return (
    !hostedPreview(page) &&
    !!terminal &&
    terminal.instanceId === viewedInstance &&
    ofSession(page, terminal)
  );
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
const empty = (): PreviewObservationState => ({
  refreshing: false,
  details: null,
  terminal: null,
  unconfirmed: null,
});

export function createPreviewObservation({
  environment = browserEnvironment,
  now = () => Date.now(),
  newRequestId = () => crypto.randomUUID(),
}: {
  environment?: Pick<ObservationEnvironment, "onFocus">;
  now?: () => number;
  newRequestId?: () => string;
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
      let pending: string | null = null;
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
        const nextInstance = attachment ? (hostedPreview(page)?.instanceId ?? null) : null;
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
        const request = newRequestId();
        pending = request;
        set({ ...state, refreshing: true });
        if (followed.send(previewStatus(request)) === "not-sent" && pending === request) {
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
        if (!active) return;
        if (m._tag === "preview_unobserved") {
          reconcile();
          const page = followed.getState();
          // Only this attachment's outstanding read: an unrelated error or a late refusal of an
          // earlier read leaves it pending.
          if (
            !attachment ||
            !pending ||
            m.requestId !== pending ||
            m.selectionId !== page.selectionId ||
            !instanceId ||
            !page.session?.sessionId
          )
            return;
          pending = null;
          set({
            ...state,
            refreshing: false,
            unconfirmed: instanceId,
            details: {
              cwd: page.session.cwd,
              sessionId: page.session.sessionId,
              instanceId,
              logs: state.details?.logs ?? "",
              error: m.message,
            },
          });
          return;
        }
        if (m._tag !== "action_result") return;
        reconcile();
        const onScreen = attachment !== null && isSession(followed.getState().session, m);
        if (m.result._tag === "preview_observed") {
          // Both the exact app and the outstanding read must match: a same-instance answer
          // from an earlier attachment must not settle this attachment's newer read.
          if (
            !onScreen ||
            !pending ||
            m.result.requestId !== pending ||
            !instanceId ||
            m.result.instanceId !== instanceId
          )
            return;
          pending = null;
          const { logs, error } = m.result;
          set({
            ...state,
            refreshing: false,
            unconfirmed: null,
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
