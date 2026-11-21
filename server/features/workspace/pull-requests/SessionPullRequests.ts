import { Context, Effect, Layer } from "effect";
import {
  type PullRequestBranches,
  pullRequestBranches,
  pullRequestBranchesKey,
} from "../../../../shared/features/workspace/pull-requests/pullRequestBranches.ts";
import {
  PULL_REQUEST_TIMEOUT_MS,
  type PullRequest,
  type SessionPullRequest,
  type SessionPullRequestAction,
  type SessionPullRequestLink,
} from "../../../../shared/wire.ts";
import {
  Registry,
  type RegistryError,
  type SessionEntry,
} from "../../../shared/registry/Registry.ts";
import { GitHubPullRequests, observeBranchRemote, PullRequestError } from "./GitHubPullRequests.ts";

export { PullRequestError };

const failure = (detail: string) => new PullRequestError({ detail });

export const PullRequestTimeoutMs = Context.Reference<number>("piano/PullRequestTimeoutMs", {
  defaultValue: () => PULL_REQUEST_TIMEOUT_MS,
});

const bounded = <A, E, R>(answer: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const ms = yield* PullRequestTimeoutMs;
    return yield* Effect.timeoutOrElse(answer, {
      duration: ms,
      orElse: () =>
        Effect.fail(
          failure(
            `Could not look up the pull request within ${Math.ceil(ms / 1000)} seconds. Retry.`,
          ),
        ),
    });
  });

const checkout = Effect.fn("SessionPullRequests.checkout")(function* (cwd: string) {
  const remote = yield* observeBranchRemote(cwd);
  if (!remote || remote.on === "none") return null;
  if (remote.on === "other")
    return yield* failure(
      "Branch discovery needs a GitHub or exe.dev GitHub integration remote. Link a pull request explicitly for this checkout.",
    );
  return remote.head && { ...remote.head, apiHost: remote.apiHost };
});

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
    const save = Effect.fn("SessionPullRequests.save")(function* (
      expected: SessionEntry,
      link: SessionEntry["pullRequest"],
    ) {
      const saved = yield* Effect.uninterruptible(
        registry.setSessionLink(expected, "pullRequest", link),
      );
      if (!saved)
        return yield* failure(
          "The session's pull request changed during lookup. Refresh and try again.",
        );
      return saved;
    });
    const branchesOf = (pr: PullRequest): PullRequestBranches =>
      pr.head && pr.base
        ? { head: pr.head, base: pr.base, headRepo: pr.headRepo, baseRepo: pr.baseRepo }
        : {};
    const recordBranches = Effect.fn("SessionPullRequests.recordBranches")(function* (
      s: SessionEntry,
      pr: PullRequest,
    ): Effect.fn.Return<SessionPullRequestLink, RegistryError> {
      const link = s.pullRequest!;
      const branches = pullRequestBranches(branchesOf(pr));
      if (pullRequestBranchesKey(link) === pullRequestBranchesKey(branches)) return link;
      const saved = yield* Effect.uninterruptible(
        registry.setSessionLink(s, "pullRequest", { ...link, ...branches }),
      );
      return saved?.pullRequest ?? link;
    });
    const result: (
      s: SessionEntry,
      forceDiscovery?: boolean,
    ) => Effect.Effect<SessionPullRequest, PullRequestError | RegistryError> = Effect.fn(
      "SessionPullRequests.result",
    )(function* (s: SessionEntry, forceDiscovery = false) {
      if (!forceDiscovery && s.pullRequest === null) return { link: null, pullRequest: null };
      if (!forceDiscovery && s.pullRequest) {
        const pullRequest = yield* github.view(s.pullRequest, s.cwd).pipe(Effect.result);
        if (pullRequest._tag === "Failure")
          return { link: s.pullRequest, pullRequest: null, error: pullRequest.failure.detail };
        return {
          link: yield* recordBranches(s, pullRequest.success),
          pullRequest: pullRequest.success,
        };
      }
      const discover = Effect.gen(function* () {
        const before = yield* checkout(s.cwd);
        if (!before) return null;
        const matches = yield* github.openForHead(s.cwd, before.name, before.repo, before.apiHost);
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
          error: found.failure.detail,
        };
      if (!found.success) {
        if (s.pullRequest)
          return {
            ...(yield* result(s)),
            error: "No matching open pull request for the current branch.",
          };
        if (forceDiscovery) yield* save(s, undefined);
        return { link: null, pullRequest: null };
      }
      const link: SessionPullRequestLink = {
        ...found.success.link,
        source: "branch",
        ...branchesOf(found.success.pullRequest),
      };
      yield* save(s, link);
      return { link, pullRequest: found.success.pullRequest };
    });
    return SessionPullRequests.of({
      get: (s) => bounded(result(s)),
      change: Effect.fn("SessionPullRequests.change")(function* (s, action) {
        if (action.action === "link") {
          const link: SessionPullRequestLink = {
            ...(yield* github.link(action.url, s.cwd)),
            source: "manual",
          };
          return yield* result(yield* save(s, link));
        }
        if (action.action === "discover") return yield* result(s, true);
        yield* save(s, null);
        return { link: null, pullRequest: null };
      }, bounded),
    });
  }),
);
