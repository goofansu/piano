/**
 * The selected session's pull request link: one live observation of it plus the surface that
 * shows it. The registry decides whether a session is linked, and the session catalog carries its
 * link, so only a linked session is read: on selection, focus, work edges and stale opens.
 * Linked PR details poll while shown until definitively closed/merged, including recovery from
 * unavailable status; selecting an unlinked session costs no GitHub call.
 * Work starting or stopping means a change within the observed session, never the
 * selection of one mid-turn. When the work of a session never searched for a pull request
 * stops, it is searched once in the background; the registry keeps what that finds and the
 * catalog reports it. Reads are silent; only an explicit
 * change blocks the controls or reports. The caller supplies Changes visibility and link-dialog
 * intent; this module owns the surface they imply, across selections and completed actions.
 * A link that appears closes the link form, not the visible row's polling; background reads never
 * reset an edit in progress. Nothing here depends on React.
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
  /** The registry links the session; its details may show before the first read lands. */
  linked: boolean;
  /** The registry's link, as the catalog reports it: the trigger names it before the first read lands. */
  link: RegistryLink | null | undefined;
  /** A read is in flight; with no `value` yet it is the first, which the trigger shows. */
  loading: boolean;
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
   * removed, undefined when never searched), whether its work is going, and what is on screen.
   * Only a linked session is read; a different session starts from nothing using its own view,
   * and its `working` is recorded, not acted on. When the observed session's work starts or
   * stops, a linked session's facts are read again. A never-searched session is searched once
   * when its work stops or its Changes first shows.
   */
  observe: (
    workspaceId: string | undefined,
    sessionId: string | null | undefined,
    link: RegistryLink | null | undefined,
    working: boolean,
    /** Visibility and dialog intent belong to this same selection, never the previous one. */
    view: { visible: boolean; dialog: boolean },
  ) => void;
  /** Sends nothing, answering `refused`, unless `canLink` allows it. */
  link: (url: string) => Promise<PullRequestOutcome>;
  discover: () => Promise<PullRequestOutcome>;
  remove: () => Promise<PullRequestOutcome>;
}

const sameLink = (a: RegistryLink | null | undefined, b: RegistryLink | null | undefined) =>
  a === b || (!!a && !!b && a.url === b.url && a.apiHost === b.apiHost && a.source === b.source);

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
      // Unavailable facts still need a recovery read. Only terminal facts for the current
      // association stop polling; a superseded link's state says nothing about this one.
      const status = sameLink(value?.link, link) ? value?.pullRequest?.state : undefined;
      return surface === "details" && link && status !== "closed" && status !== "merged"
        ? POLL_MS
        : undefined;
    },
    focus: true,
    environment,
  });
  /** The registry's link for the observed session, as the catalog last reported it. */
  let link: RegistryLink | null | undefined;
  let associationRevision = 0;
  /** The background search in flight; its answer reaches the registry, never this state. */
  let search: AbortController | undefined;
  /** The one answer to "is this session linked?": the registry's, never GitHub's read. */
  const linked = () => !!link;
  /** Whether the observed session's work is going, so the next `observe` can tell an edge. */
  let working = false;
  let visible = false,
    dialog = false;
  let surface: PullRequestSurface = "closed",
    finding = false,
    /** One of this module's changes is in flight; it decides the surface when it settles. */
    changing = false;
  const listeners = new Set<() => void>();
  const derive = (): SessionPullRequestState => {
    const { key, value, error, loading, mutating } = observation.getState();
    const read = error
      ? fallback(sameLink(value?.link, link) ? value : undefined, link, error)
      : value;
    // The registry says whether the session is linked; a read adds GitHub's facts to that link.
    // A value read for another link (changed or removed elsewhere) is not shown; a change in
    // flight keeps what it applies to until it settles.
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
    const next = dialog
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
    // The surface moves only when the registry's link itself appeared or disappeared: a link
    // found closes the form; a link removed elsewhere takes its details (or edit) with it.
    if (!changing) {
      if (surface === "link-form" && linked()) return closeItself();
      if (surface === "editing" && !linked()) return closeItself();
    }
    reconcileSurface();
    publish();
  });

  /** One background search for a never-searched session; its answer reaches the registry. */
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
      // A registry acknowledgement must not cancel the mutation. If the registry instead
      // reported a conflicting association while it ran, reconcile after it settles.
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
      if (key !== previous || associationChanged) associationRevision++;
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
      const alreadyReading = key !== previous || !previousLink;
      if (next && !alreadyReading && (associationChanged || edge)) observation.refreshSoon(0);
      reconcileSurface();
      publish();
      const { loading, mutating } = observation.getState();
      // Reuse a recent read and never replace one in flight just because the row appeared.
      if (
        surface === "details" &&
        previousSurface !== "details" &&
        !loading &&
        !mutating &&
        (readAt === undefined || now() - readAt >= POLL_MS)
      ) {
        void observation.refresh();
      }
      // Only a never-searched session at rest is searched; a removed link stays removed.
      if (key === null || link !== undefined || working || search) return;
      if (edge || revealed || (key !== previous && visible)) startSearch();
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
