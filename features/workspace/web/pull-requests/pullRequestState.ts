import type {
  SessionPullRequestLink as RegistryLink,
  SessionPullRequest,
  SessionPullRequestAction,
} from "@shared/wire";
import {
  createObservation,
  type ObservationEnvironment,
} from "../../../../web/src/shared/lib/observation.ts";

export type PullRequestSurface = "closed" | "link-form" | "details" | "editing";

export interface SessionPullRequestState {
  key: string | null;
  value: SessionPullRequest | undefined;
  linked: boolean;
  link: RegistryLink | null | undefined;
  loading: boolean;
  busy: boolean;
  finding: boolean;
  surface: PullRequestSurface;
}

export type PullRequestOutcome =
  | { _tag: "saved"; value: SessionPullRequest }
  | { _tag: "not-found" }
  | { _tag: "failed"; reason: string }
  | { _tag: "superseded" }
  | { _tag: "refused" };

export interface SessionPullRequestOptions {
  api: (
    workspaceId: string,
    sessionId: string,
    action: SessionPullRequestAction | undefined,
    options: { signal: AbortSignal },
  ) => Promise<SessionPullRequest>;
  notify: {
    error: (message: string) => void;
    info: (message: string) => void;
    success: (message: string) => void;
  };
  closed?: () => void;
  environment?: ObservationEnvironment;
  now?: () => number;
}

export interface SessionPullRequestLink {
  getState: () => SessionPullRequestState;
  subscribe: (listener: () => void) => () => void;
  start: () => () => void;
  observe: (
    workspaceId: string | undefined,
    sessionId: string | null | undefined,
    link: RegistryLink | null | undefined,
    working: boolean,
    view: { visible: boolean; dialog: boolean },
  ) => void;
  link: (url: string) => Promise<PullRequestOutcome>;
  discover: () => Promise<PullRequestOutcome>;
  remove: () => Promise<PullRequestOutcome>;
}

const sameLink = (a: RegistryLink | null | undefined, b: RegistryLink | null | undefined) =>
  a === b || (!!a && !!b && a.url === b.url && a.apiHost === b.apiHost && a.source === b.source);

const POLL_MS = 60_000;
const NOT_FOUND = "No open PR found for this branch.";
const LINKED = "Pull request linked";
const REMOVED = "Pull request link removed";
const failure = (error: unknown) =>
  error instanceof Error ? error.message : "Could not load the pull request.";
const fallback = (
  previous: SessionPullRequest | undefined,
  link: RegistryLink | null | undefined,
  error: string,
): SessionPullRequest => ({
  link: previous?.link ?? link ?? null,
  pullRequest: null,
  error,
});
export const canLink = (url: string, busy: boolean) => !busy && url.trim() !== "";

export const pullRequestKey = (
  workspaceId: string | undefined,
  sessionId: string | null | undefined,
) => (workspaceId && sessionId ? JSON.stringify([workspaceId, sessionId]) : null);

export function createSessionPullRequest({
  api,
  notify,
  closed,
  environment,
  now = Date.now,
}: SessionPullRequestOptions): SessionPullRequestLink {
  const target = (key: string) => JSON.parse(key) as [string, string];
  let readAt: number | undefined;
  const request = async (
    key: string,
    action: SessionPullRequestAction | undefined,
    signal: AbortSignal,
  ) => {
    const value = await api(...target(key), action, { signal });
    if (!signal.aborted) readAt = now();
    return value;
  };
  const observation = createObservation<SessionPullRequest>({
    load: (signal, key) => request(key, undefined, signal),
    interval: (value) => {
      const status = sameLink(value?.link, link) ? value?.pullRequest?.state : undefined;
      return surface === "details" && link && status !== "closed" && status !== "merged"
        ? POLL_MS
        : undefined;
    },
    focus: true,
    environment,
  });
  let link: RegistryLink | null | undefined;
  let associationRevision = 0;
  let search: AbortController | undefined;
  const linked = () => !!link;
  let working = false;
  let visible = false,
    dialog = false;
  let surface: PullRequestSurface = "closed",
    finding = false,
    changing = false;
  const listeners = new Set<() => void>();
  const derive = (): SessionPullRequestState => {
    const { key, value, error, loading, mutating } = observation.getState();
    const read = error
      ? fallback(sameLink(value?.link, link) ? value : undefined, link, error)
      : value;
    const current = mutating || sameLink(read?.link, link);
    return {
      key,
      value: current ? read : undefined,
      linked: linked(),
      link,
      loading,
      busy: mutating,
      finding,
      surface,
    };
  };
  let state = derive();
  const publish = () => {
    state = derive();
    for (const listener of listeners) listener();
  };
  const show = (next: PullRequestSurface) => {
    if (surface === next) return;
    surface = next;
    observation.reschedule();
    publish();
  };
  const reconcileSurface = () => {
    const next =
      observation.getState().key === null
        ? "closed"
        : dialog
          ? linked()
            ? "editing"
            : "link-form"
          : visible && linked()
            ? "details"
            : "closed";
    show(next);
  };
  const closeItself = () => {
    dialog = false;
    reconcileSurface();
    closed?.();
  };
  const endSearch = () => {
    search?.abort();
    search = undefined;
  };

  observation.subscribe(() => {
    state = derive();
    reconcileSurface();
    publish();
  });

  const startSearch = () => {
    const key = observation.getState().key;
    if (key === null) return;
    endSearch();
    const controller = new AbortController();
    search = controller;
    api(...target(key), undefined, { signal: controller.signal })
      .catch(() => undefined)
      .finally(() => {
        if (search === controller) search = undefined;
      });
  };

  const change = async (action: SessionPullRequestAction): Promise<PullRequestOutcome> => {
    const key = observation.getState().key;
    if (key === null) return { _tag: "superseded" };
    let failed: string | undefined;
    const revision = associationRevision;
    changing = true;
    try {
      const value = await observation.mutate(async (signal, previous) => {
        try {
          const body = await request(key, action, signal);
          if (body.error) notify.error(body.error);
          return body;
        } catch (error) {
          if (signal.aborted) throw error;
          failed = failure(error);
          notify.error(failed);
          return fallback(previous, link, failed);
        }
      });
      if (value === undefined) return { _tag: "superseded" };
      return failed === undefined ? { _tag: "saved", value } : { _tag: "failed", reason: failed };
    } catch {
      return { _tag: "superseded" };
    } finally {
      changing = false;
      const current = observation.getState();
      if (
        current.key === key &&
        associationRevision !== revision &&
        !sameLink(current.value?.link, link)
      ) {
        observation.refreshSoon(0);
      }
    }
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
      const stop = observation.start();
      return () => {
        endSearch();
        stop();
      };
    },
    observe: (workspaceId, sessionId, next, nextWorking, view) => {
      const key = pullRequestKey(workspaceId, sessionId);
      const { key: previous } = observation.getState();
      const revealed = view.visible && !visible;
      const previousSurface = surface;
      visible = view.visible;
      dialog = view.dialog;
      const previousLink = link;
      const associationChanged = !sameLink(previousLink, next);
      const closing =
        dialog && (key === null || (key === previous && !changing && linked() !== !!next));
      if (closing) dialog = false;
      if (key !== previous || associationChanged) associationRevision++;
      const edge = key !== null && key === previous && nextWorking !== working;
      working = nextWorking;
      if (key !== previous) {
        readAt = undefined;
        surface = "closed";
        finding = false;
        endSearch();
      }
      link = next;
      observation.observe(key, !!next);
      const alreadyReading = key !== previous || !previousLink;
      if (next && !alreadyReading && (associationChanged || edge)) observation.refreshSoon(0);
      reconcileSurface();
      publish();
      if (closing) closed?.();
      const { loading, mutating } = observation.getState();
      if (
        surface === "details" &&
        previousSurface !== "details" &&
        !loading &&
        !mutating &&
        (readAt === undefined || now() - readAt >= POLL_MS)
      ) {
        void observation.refresh();
      }
      if (key === null || link !== undefined || working || search) return;
      if (edge || revealed || (key !== previous && visible)) startSearch();
    },
    link: async (url) => {
      if (!canLink(url, observation.getState().mutating)) return { _tag: "refused" };
      const outcome = await change({ action: "link", url });
      if (outcome._tag === "saved") {
        notify.success(LINKED);
        closeItself();
      }
      return outcome;
    },
    discover: async () => {
      finding = true;
      publish();
      try {
        const outcome = await change({ action: "discover" });
        if (outcome._tag !== "saved") return outcome;
        if (outcome.value.error) return { _tag: "failed", reason: outcome.value.error };
        if (outcome.value.link) {
          notify.success(LINKED);
          closeItself();
          return outcome;
        }
        notify.info(NOT_FOUND);
        return { _tag: "not-found" };
      } finally {
        finding = false;
        publish();
      }
    },
    remove: async () => {
      const outcome = await change({ action: "remove" });
      if (outcome._tag === "saved") {
        notify.success(REMOVED);
        closeItself();
      }
      return outcome;
    },
  };
}
