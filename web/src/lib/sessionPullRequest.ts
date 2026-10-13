/**
 * The selected session's pull request link: one live observation of it plus the surface that
 * shows it. Reads are silent; only an explicit change blocks the controls or reports. The surface
 * follows the link: opening while unlinked offers the link form, a link that appears (found in the
 * background or saved here) closes it so the header shows it, and background reads never reset an
 * edit in progress. Nothing here depends on React.
 */
import type { SessionPullRequest, SessionPullRequestAction } from "@shared/wire";
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
  | { _tag: "superseded" };

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
}

export interface SessionPullRequestLink {
  getState: () => SessionPullRequestState;
  subscribe: (listener: () => void) => () => void;
  /** Resumes reading; returns the stop function, which aborts all work. */
  start: () => () => void;
  /** Follows a session; a different one closes the surface and starts from nothing. */
  observe: (workspaceId: string | undefined, sessionId: string | null | undefined) => void;
  /** Reads soon, e.g. when the session's work starts or stops. */
  refreshSoon: (ms: number) => void;
  /** Shows the details when linked (reading them afresh), else the link form. */
  open: () => void;
  /** Hides the surface without reporting it through `closed`. */
  close: () => void;
  edit: () => void;
  /** Leaves an edit for the details; leaves the link form altogether. */
  cancel: () => void;
  link: (url: string) => Promise<PullRequestOutcome>;
  discover: () => Promise<PullRequestOutcome>;
  remove: () => Promise<PullRequestOutcome>;
}

const POLL_MS = 60_000;
const NOT_FOUND = "No open PR found for this branch.";
const failure = (error: unknown) =>
  error instanceof Error ? error.message : "Could not load the pull request.";
/** An unreadable pull request keeps the session's saved link and discovery choice, with the reason. */
const fallback = (previous: SessionPullRequest | undefined, error: string): SessionPullRequest => ({
  link: previous?.link ?? null,
  pullRequest: null,
  discovery: previous?.discovery ?? true,
  error,
});
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
}: SessionPullRequestOptions): SessionPullRequestLink {
  const target = (key: string) => JSON.parse(key) as [string, string];
  const observation = createObservation<SessionPullRequest>({
    load: (signal, key) => api(...target(key), undefined, { signal }),
    interval: () => POLL_MS,
    focus: true,
    environment,
  });
  let surface: PullRequestSurface = "closed",
    finding = false,
    /** One of this module's changes is in flight; it decides the surface when it settles. */
    changing = false;
  const listeners = new Set<() => void>();
  const derive = (): SessionPullRequestState => {
    const { key, value, error, mutating } = observation.getState();
    return {
      key,
      value: error ? fallback(value, error) : value,
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
    publish();
  };
  const closeItself = () => {
    show("closed");
    closed?.();
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
          const body = await api(...target(key), action, { signal });
          // A saved association can succeed even when its live GitHub status is unavailable.
          if (body.error) notify.error(body.error);
          return body;
        } catch (error) {
          if (signal.aborted) throw error;
          failed = failure(error);
          notify.error(failed);
          return fallback(previous, failed);
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
    start: observation.start,
    observe: (workspaceId, sessionId) => {
      const key = pullRequestKey(workspaceId, sessionId);
      if (key !== observation.getState().key) {
        surface = "closed";
        finding = false;
      }
      observation.observe(key);
    },
    refreshSoon: observation.refreshSoon,
    open: () => {
      if (surface !== "closed") return;
      if (state.value?.link) {
        show("details");
        void observation.refresh();
      } else show("link-form");
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
