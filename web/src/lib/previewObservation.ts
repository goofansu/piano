import type { ClientCommand, ServerMessage, SessionPreview } from "../../../shared/wire.ts";
import { type AppState, isSession } from "../store.ts";
import { browserEnvironment, type ObservationEnvironment } from "./observation.ts";
import { sessionReady } from "./sessionContext.ts";
import {
  hostedPreview,
  type PreviewClaim,
  previewClaimHolds,
  previewStatus,
} from "./sessionPreview.ts";
import type { SendDisposition } from "./ws.ts";

export interface PreviewDetails {
  cwd: string;
  sessionId: string;
  instanceId: string | null;
  logs: string;
  error?: string;
}

export interface PreviewObservationState {
  refreshing: boolean;
  details: PreviewDetails | null;
  unconfirmed: string | null;
}

export function seenPreview(
  page: AppState,
  observed: Pick<PreviewObservationState, "unconfirmed">,
): SessionPreview | undefined {
  const preview = hostedPreview(page);
  if (!preview || (sessionReady(page) && preview.instanceId !== observed.unconfirmed))
    return preview;
  return { ...preview, state: "unknown", ready: false, warming: false, url: null, detail: "" };
}

export function claimedPreview(
  page: AppState,
  observed: Pick<PreviewObservationState, "unconfirmed">,
  claim: PreviewClaim | null,
): SessionPreview | undefined {
  return claim && previewClaimHolds(page, claim) ? seenPreview(page, observed) : undefined;
}

const ofSession = (page: AppState, record: { cwd: string; sessionId: string }) =>
  record.cwd === page.session?.cwd && record.sessionId === page.session?.sessionId;

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
  refresh: () => void;
  follow: (source: PreviewObservationSource, notify: PreviewNotify) => () => void;
}

const FOCUS_MS = 10_000;
const empty = (): PreviewObservationState => ({
  refreshing: false,
  details: null,
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
          pending = null;
          set(empty());
        }
        const nextInstance = attachment ? (hostedPreview(page)?.instanceId ?? null) : null;
        if (nextInstance !== instanceId) {
          changed = true;
          instanceId = nextInstance;
          pending = null;
          set(empty());
        }
        return changed;
      };
      const read = () => {
        reconcile();
        if (!attachment || !instanceId || pending) return;
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
