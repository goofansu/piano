/**
 * The selected session's pull request link: one live observation of it plus the surface that
 * shows it. The registry decides whether a session is linked, and the session catalog carries its
 * link, so only a linked session is read: on selection, focus, work edges and stale opens.
 * Only open/draft PR details poll while shown; selecting an unlinked session costs no GitHub call.
 * Work starting or stopping means a change within the observed session, never the
 * selection of one mid-turn. When the work of a session never searched for a pull request
 * stops, it is searched once in the background; the registry keeps what that finds and the
 * catalog reports it. Reads are silent; only an explicit
 * change blocks the controls or reports. The surface follows the link: opening while unlinked
 * offers the link form, a link that appears (found in the background or saved here) closes it so
 * the header shows it, and background reads never reset an edit in progress. Nothing here depends
 * on React.
 */
import type {
  SessionPullRequestLink as RegistryLink,
  SessionPullRequest,
  SessionPullRequestAction,
} from "@shared/wire";
import { createObservation, type ObservationEnvironment } from "./observation.ts";

/** Where the link is shown: nowhere, the form to link one, its details, or the form to change it. */
export type PullRequestSurface = "closed" | "link-form" | "details" | "editing";

export interface SessionPullRequestState {
  /** The session this state belongs to, as `JSON.stringify([workspaceId, sessionId])`; `null` while idle. */
  key: string | null;
  /** The last read or change, keeping the saved link with the reason when GitHub is unreadable. */
  value: SessionPullRequest | undefined;
  /** An explicit change is in flight. */
  busy: boolean;
  /** "Find from branch" is in flight. */
  finding: boolean;
  surface: PullRequestSurface;
}

export type PullRequestOutcome =
  | { _tag: "saved"; value: SessionPullRequest }
  /** Discovery ran and found no open PR for the branch. */
  | { _tag: "not-found" }
  | { _tag: "failed"; reason: string }
  /** The session changed, or another change started, before this one settled. */
  | { _tag: "superseded" }
  /** Nothing was sent: the URL is blank or another change is in flight. */
  | { _tag: "refused" };

export interface SessionPullRequestOptions {
  /** Reads with no action; changes with one. */
  api: (
    workspaceId: string,
    sessionId: string,
    action: SessionPullRequestAction | undefined,
    options: { signal: AbortSignal },
  ) => Promise<SessionPullRequest>;
  notify: { error: (message: string) => void; info: (message: string) => void };
  /** Called when the surface closes itself, so whoever owns "open" can follow. */
  closed?: () => void;
  environment?: ObservationEnvironment;
  /** Clock for the freshness of the last completed read or change. */
  now?: () => number;
}

export interface SessionPullRequestLink {
  getState: () => SessionPullRequestState;
  subscribe: (listener: () => void) => () => void;
  /** Resumes reading; returns the stop function, which aborts all work. */
  start: () => () => void;
  /**
   * Follows a session, the registry's link for it as the catalog reports it (a link, null once
   * removed, undefined when never searched) and whether its work is going. Only a linked session
   * is read; a different session closes the surface and starts from nothing, and its `working`
   * is recorded, not acted on. When the observed session's work starts or stops, a linked
   * session's facts are read again, and the work of a session never searched for a pull request
   * stopping searches it once in the background.
   */
  observe: (
    workspaceId: string | undefined,
    sessionId: string | null | undefined,
    link: RegistryLink | null | undefined,
    working: boolean,
  ) => void;
  /** Shows linked details immediately, refreshing only if stale and no read is in flight; else the link form. */
  open: () => void;
  /** Hides the surface without reporting it through `closed`. */
  close: () => void;
  edit: () => void;
  /** Leaves an edit for the details; leaves the link form altogether. */
  cancel: () => void;
  /** Sends nothing, answering `refused`, unless `canLink` allows it. */
  link: (url: string) => Promise<PullRequestOutcome>;
  discover: () => Promise<PullRequestOutcome>;
  remove: () => Promise<PullRequestOutcome>;
}

const POLL_MS = 60_000;
const NOT_FOUND = "No open PR found for this branch.";
const failure = (error: unknown) =>
  error instanceof Error ? error.message : "Could not load the pull request.";
/** An unreadable pull request keeps the session's saved link, with the reason. */
const fallback = (
  previous: SessionPullRequest | undefined,
  link: RegistryLink | null | undefined,
  error: string,
): SessionPullRequest => ({
  link: previous?.link ?? link ?? null,
  pullRequest: null,
  error,
});
/** A link change needs a URL and no other change in flight; the form's submit follows this rule. */
export const canLink = (url: string, busy: boolean) => !busy && url.trim() !== "";

/** The identity a session's pull request state belongs to. */
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
    // An aborted response belongs to superseded work and must not make current facts fresh.
    if (!signal.aborted) readAt = now();
    return value;
  };
  const observation = createObservation<SessionPullRequest>({
    load: (signal, key) => request(key, undefined, signal),
    interval: (value) => {
      const active = value?.pullRequest?.state;
      return surface === "details" && (active === "open" || active === "draft")
        ? POLL_MS
        : undefined;
    },
    focus: true,
    environment,
  });
  /** The registry's link for the observed session, as the catalog last reported it. */
  let link: RegistryLink | null | undefined;
  /** The background search in flight; its answer reaches the registry, never this state. */
  let search: AbortController | undefined;
  /** Whether the observed session's work is going, so the next `observe` can tell an edge. */
  let working = false;
  let surface: PullRequestSurface = "closed",
    finding = false,
    /** One of this module's changes is in flight; it decides the surface when it settles. */
    changing = false;
  const listeners = new Set<() => void>();
  const derive = (): SessionPullRequestState => {
    const { key, value, error, mutating } = observation.getState();
    const read = error ? fallback(value, link, error) : value;
    // The registry says whether the session is linked; a read adds GitHub's facts to that link.
    // A value read for another link (changed or removed elsewhere) is not shown; a change in
    // flight keeps what it applies to until it settles.
    const current = mutating || read?.link?.url === link?.url;
    return { key, value: current ? read : undefined, busy: mutating, finding, surface };
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
  const closeItself = () => {
    show("closed");
    closed?.();
  };
  const endSearch = () => {
    search?.abort();
    search = undefined;
  };

  observation.subscribe(() => {
    state = derive();
    // A read moves the surface only when the link itself appeared or disappeared.
    if (!changing) {
      const linked = !!state.value?.link;
      if (surface === "link-form" && linked) return closeItself();
      if ((surface === "details" || surface === "editing") && !linked) surface = "link-form";
    }
    publish();
  });

  const change = async (action: SessionPullRequestAction): Promise<PullRequestOutcome> => {
    const key = observation.getState().key;
    if (key === null) return { _tag: "superseded" };
    let failed: string | undefined;
    changing = true;
    try {
      const value = await observation.mutate(async (signal, previous) => {
        try {
          const body = await request(key, action, signal);
          // A saved association can succeed even when its live GitHub status is unavailable.
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
    observe: (workspaceId, sessionId, next, nextWorking) => {
      const key = pullRequestKey(workspaceId, sessionId);
      const { key: previous, value } = observation.getState();
      // Work starting or stopping is an edge only within one session: a selection arriving
      // mid-turn is not a start, so it is read once, by the observation, not twice.
      const edge = key !== null && key === previous && nextWorking !== working;
      working = nextWorking;
      if (key !== previous) {
        readAt = undefined;
        surface = "closed";
        finding = false;
        endSearch();
      }
      link = next;
      // A newly linked session, or a new session, reads on its own; a link that changed
      // elsewhere is read afresh so GitHub's facts match it.
      observation.observe(key, !!next);
      const reread = !!next && value !== undefined && value.link?.url !== next.url;
      if (reread) observation.refreshSoon(0);
      publish();
      if (!edge || key === null) return;
      if (link) {
        if (!reread) observation.refreshSoon(0);
        return;
      }
      if (link !== undefined || working) return;
      endSearch();
      const controller = new AbortController();
      search = controller;
      api(...target(key), undefined, { signal: controller.signal })
        .catch(() => undefined)
        .finally(() => {
          if (search === controller) search = undefined;
        });
    },
    open: () => {
      if (surface !== "closed") return;
      show(state.value?.link ? "details" : "link-form");
      const { loading, mutating } = observation.getState();
      // A focus read may already be running or just finished when the user clicks the PR.
      if (
        state.value?.link &&
        !loading &&
        !mutating &&
        (readAt === undefined || now() - readAt >= POLL_MS)
      ) {
        void observation.refresh();
      }
    },
    close: () => show("closed"),
    edit: () => {
      if (surface === "details") show("editing");
    },
    cancel: () => {
      if (surface === "editing") show("details");
      else if (surface === "link-form") closeItself();
    },
    link: async (url) => {
      if (!canLink(url, observation.getState().mutating)) return { _tag: "refused" };
      const outcome = await change({ action: "link", url });
      if (outcome._tag === "saved") closeItself();
      return outcome;
    },
    discover: async () => {
      finding = true;
      publish();
      try {
        const outcome = await change({ action: "discover" });
        if (outcome._tag !== "saved") return outcome;
        if (outcome.value.link) {
          closeItself();
          return outcome;
        }
        // Only the explicit search reports absence; polling stays silent. An unreadable
        // GitHub was already reported as itself.
        if (!outcome.value.error) notify.info(NOT_FOUND);
        return outcome.value.error ? outcome : { _tag: "not-found" };
      } finally {
        finding = false;
        publish();
      }
    },
    remove: async () => {
      const outcome = await change({ action: "remove" });
      if (outcome._tag === "saved") closeItself();
      return outcome;
    },
  };
}
