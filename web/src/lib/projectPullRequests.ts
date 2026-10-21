/**
 * Live pull request states for a project's home, read after the page has drawn. Only a saved link
 * is read: asking for a session without one would make the server discover a pull request (Git
 * and a GitHub search), which the home never pays for. Reads run a few at a time, each with a
 * deadline, and are kept for as long as the page is open; a failed or late read leaves the number
 * without a state.
 */
import type { PullRequest, SessionPullRequest, SessionPullRequestLink } from "@shared/wire";
import type { RequestOptions } from "./api.ts";

/** A linked pull request's live state, or `unavailable` when GitHub could not be read in time. */
export type PullRequestState = PullRequest["state"] | "unavailable";

export interface PullRequestTarget {
  workspaceId: string;
  sessionId: string;
  link: SessionPullRequestLink;
}

export interface ProjectPullRequestsOptions {
  /** The session pull request read: GET, never a change. */
  read: (
    workspaceId: string,
    sessionId: string,
    action: undefined,
    options: RequestOptions,
  ) => Promise<SessionPullRequest>;
  /** Reads in flight at once. */
  limit?: number;
  /** How long one read may take before its state is unavailable. */
  timeoutMs?: number;
}

export interface ProjectPullRequests {
  /** Starts reading; returns the stop function, which abandons queued reads and aborts the ones in flight. */
  start: () => () => void;
  /** Reads each target's link once for this page view; links already read or queued are skipped. */
  want: (targets: readonly PullRequestTarget[]) => void;
  /** States by link URL; a link absent here has not been read yet. */
  getState: () => ReadonlyMap<string, PullRequestState>;
  subscribe: (listener: () => void) => () => void;
}

export function createProjectPullRequests({
  read,
  limit = 4,
  timeoutMs = 5000,
}: ProjectPullRequestsOptions): ProjectPullRequests {
  let states: ReadonlyMap<string, PullRequestState> = new Map();
  const seen = new Set<string>();
  const queue: PullRequestTarget[] = [];
  /** Reads in flight, by the link each one reads. */
  const running = new Map<AbortController, string>();
  const listeners = new Set<() => void>();
  let started = false;

  const settle = (url: string, state: PullRequestState) => {
    if (!started) return;
    states = new Map(states).set(url, state);
    for (const listener of listeners) listener();
  };

  const pump = () => {
    while (started && running.size < limit && queue.length > 0) {
      const target = queue.shift()!;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      running.set(controller, target.link.url);
      read(target.workspaceId, target.sessionId, undefined, { signal: controller.signal })
        .then(
          (result) => settle(target.link.url, result.pullRequest?.state ?? "unavailable"),
          () => settle(target.link.url, "unavailable"),
        )
        .finally(() => {
          clearTimeout(timer);
          running.delete(controller);
          pump();
        });
    }
  };

  return {
    start: () => {
      started = true;
      pump();
      return () => {
        started = false;
        // An abandoned or aborted read leaves its link unread, so a later start reads it again.
        for (const [controller, url] of running) {
          controller.abort();
          seen.delete(url);
        }
        for (const target of queue) seen.delete(target.link.url);
        queue.length = 0;
      };
    },
    want: (targets) => {
      for (const target of targets) {
        if (seen.has(target.link.url)) continue;
        seen.add(target.link.url);
        queue.push(target);
      }
      pump();
    },
    getState: () => states,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
