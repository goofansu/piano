/** Session-owned PR associations. Git discovers candidates; GitHub owns live facts, read only
 * through the GitHubPullRequests adapter. This module keeps the link policy. Transcript contents never participate. Registry retains only identity and user preference.
 */
import { Context, Effect, Layer } from "effect";
import type {
  SessionPullRequest,
  SessionPullRequestAction,
  SessionPullRequestLink,
} from "../shared/wire.ts";
import { observeGit } from "./GitCheckout.ts";
import { GitHubPullRequests, githubRemote, PullRequestError } from "./GitHubPullRequests.ts";
import { Registry, type RegistryError, type SessionEntry } from "./Registry.ts";

export { PullRequestError };

const failure = (detail: string) => new PullRequestError({ detail });

/** Observe both branch and head repository through GitCheckout's observation (INV-06):
 * inherited GIT_* state cannot redirect discovery; the remote is the tracking remote's URL. */
const checkout = Effect.fn("SessionPullRequests.checkout")(function* (cwd: string) {
  const observed = yield* observeGit(cwd, { remote: true });
  if (observed.status === "broken") return yield* failure(observed.detail);
  if (observed.status === "non-git") return null;
  const branch = observed.branch ?? "",
    remote = observed.remote ?? "";
  if (!remote) return null;
  const github = githubRemote(remote);
  if (!github)
    return yield* failure(
      "Branch discovery needs a GitHub or exe.dev GitHub integration remote. Link a pull request explicitly for this checkout.",
    );
  return { branch, remote, ...github };
});

/** Callers pass the session entry they resolved by ID; this module never looks a session up by path. */
export class SessionPullRequests extends Context.Service<
  SessionPullRequests,
  {
    readonly get: (
      session: SessionEntry,
    ) => Effect.Effect<SessionPullRequest, PullRequestError | RegistryError>;
    readonly change: (
      session: SessionEntry,
      action: SessionPullRequestAction,
    ) => Effect.Effect<SessionPullRequest, PullRequestError | RegistryError>;
  }
>()("piano/SessionPullRequests") {}

export const SessionPullRequestsLive = Layer.effect(
  SessionPullRequests,
  Effect.gen(function* () {
    const registry = yield* Registry;
    const github = yield* GitHubPullRequests;
    // Returns the saved entry, so an answer reflects what the registry now holds.
    const save = Effect.fn("SessionPullRequests.save")(function* (
      expected: SessionEntry,
      link: SessionEntry["pullRequest"],
    ) {
      const saved = yield* registry.setSessionLink(expected, "pullRequest", link);
      if (!saved)
        return yield* failure(
          "The session's pull request changed during lookup. Refresh and try again.",
        );
      return saved;
    });
    const result: (
      s: SessionEntry,
      forceDiscovery?: boolean,
    ) => Effect.Effect<SessionPullRequest, PullRequestError | RegistryError> = Effect.fn(
      "SessionPullRequests.result",
    )(function* (s: SessionEntry, forceDiscovery = false) {
      if (!forceDiscovery && s.pullRequest === null)
        return { link: null, pullRequest: null, discovery: false };
      if (!forceDiscovery && s.pullRequest) {
        const pullRequest = yield* github.view(s.pullRequest, s.cwd).pipe(Effect.result);
        // A failed lookup retains the association, not stale success/checks.
        return pullRequest._tag === "Success"
          ? { link: s.pullRequest, pullRequest: pullRequest.success, discovery: false }
          : {
              link: s.pullRequest,
              pullRequest: null,
              discovery: false,
              error: pullRequest.failure.detail,
            };
      }
      const discover = Effect.gen(function* () {
        const before = yield* checkout(s.cwd);
        if (!before?.branch) return null;
        const matches = yield* github.openForHead(
          s.cwd,
          before.branch,
          before.repo,
          before.apiHost,
        );
        if (matches.length > 1)
          return yield* failure(
            "Several pull requests match this branch. Link the intended pull request explicitly.",
          );
        if (!matches.length) return null;
        const after = yield* checkout(s.cwd);
        if (JSON.stringify(before) !== JSON.stringify(after))
          return yield* failure("The checkout changed during lookup. Retry discovery.");
        return matches[0]!;
      });
      const found = yield* discover.pipe(Effect.result);
      if (found._tag === "Failure")
        return {
          link: s.pullRequest ?? null,
          pullRequest: null,
          discovery: s.pullRequest === undefined,
          error: found.failure.detail,
        };
      if (!found.success) {
        if (s.pullRequest)
          return {
            ...(yield* result(s)),
            error: "No matching open pull request for the current branch.",
          };
        if (forceDiscovery) yield* save(s, undefined);
        return { link: null, pullRequest: null, discovery: true };
      }
      const link: SessionPullRequestLink = { ...found.success.link, source: "branch" };
      yield* save(s, link);
      return { link, pullRequest: found.success.pullRequest, discovery: false };
    });
    return SessionPullRequests.of({
      get: (s) => result(s),
      change: Effect.fn("SessionPullRequests.change")(function* (s, action) {
        if (action.action === "link") {
          // Explicit association is the user's choice, not a claim that GitHub is reachable.
          // A new explicit choice follows its URL/workspace route, not a previous link's route.
          const link: SessionPullRequestLink = {
            ...(yield* github.link(action.url, s.cwd)),
            source: "manual",
          };
          return yield* result(yield* save(s, link));
        }
        if (action.action === "discover") return yield* result(s, true);
        yield* save(s, null);
        return { link: null, pullRequest: null, discovery: false };
      }),
    });
  }),
);
