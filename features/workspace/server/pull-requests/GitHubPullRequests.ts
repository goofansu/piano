import { Context, Data, Effect, Layer, Schema } from "effect";
import { childEnvironment } from "../../../../server/shared/ChildEnvironment.ts";
import {
  GhCommand,
  run as runProcess,
  type SubprocessError,
} from "../../../../server/shared/Subprocess.ts";
import {
  EXE_GITHUB,
  type GitHubHost,
  pullRequestIdentity,
} from "../../../../shared/git/pullRequestIdentity.ts";
import type { PullRequest } from "../../contracts/pull-requests/http.ts";
import type { PullRequestBranches } from "../../contracts/pull-requests/pullRequestBranches.ts";
import { type BranchHome, gitText, observeGit } from "../GitCheckout.ts";

export class PullRequestError extends Data.TaggedError("PullRequestError")<{
  readonly detail: string;
}> {
  override get message() {
    return this.detail;
  }
}
const failure = (detail: string) => new PullRequestError({ detail });

export interface PullRequestLink {
  readonly url: string;
  readonly apiHost?: typeof EXE_GITHUB;
}

export function githubRemote(remote: string): { repo: string; apiHost: GitHubHost } | null {
  const proxy = remote.match(
    /^https:\/\/github\.int\.exe\.xyz\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i,
  );
  const match =
    proxy ??
    remote.match(
      /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i,
    );
  if (!match) return null;
  return { repo: match[1]!.toLowerCase(), apiHost: proxy ? EXE_GITHUB : "github.com" };
}

export interface BranchHead {
  readonly name: string;
  readonly repo: string;
}

export type BranchRemote =
  | { readonly on: "none" }
  | { readonly on: "other" }
  | { readonly on: "github"; readonly apiHost: GitHubHost; readonly head: BranchHead | null };

export function branchRemote({ upstream, url }: BranchHome): BranchRemote {
  if (!url) return { on: "none" };
  const github = githubRemote(url);
  if (!github) return { on: "other" };
  return {
    on: "github",
    apiHost: github.apiHost,
    head: upstream ? { name: upstream.name, repo: github.repo } : null,
  };
}

export const observeBranchRemote = Effect.fn("GitHubPullRequests.observeBranchRemote")(function* (
  cwd: string,
): Effect.fn.Return<BranchRemote | null, PullRequestError> {
  const observed = yield* observeGit(cwd, { home: true });
  if (observed.status === "broken") return yield* failure(observed.detail);
  if (observed.status === "non-git" || !observed.home) return null;
  return branchRemote(observed.home);
});

const remoteRepos = Effect.fn("GitHubPullRequests.remoteRepos")(function* (
  cwd: string,
  host: GitHubHost,
): Effect.fn.Return<
  { readonly repo: string; readonly resolved: string | null }[],
  PullRequestError
> {
  const read = (args: string[]) =>
    gitText(cwd, args, { userConfig: true }).pipe(
      Effect.map((text) => text.trim()),
      Effect.mapError((e) => failure(e.detail)),
    );
  const names = (yield* read(["remote"])).split("\n").filter(Boolean);
  const remotes = yield* Effect.forEach(
    names,
    (name) =>
      Effect.all([
        read(["remote", "get-url", "--", name]),
        read(["config", "--default", "", "--get", `remote.${name}.gh-resolved`]),
      ]),
    { concurrency: "unbounded" },
  );
  return remotes.flatMap(([url, resolved]) => {
    const github = githubRemote(url);
    if (github?.apiHost !== host) return [];
    const chosen = /^[\w.-]+\/[\w.-]+$/.test(resolved) ? resolved.toLowerCase() : null;
    return [{ repo: github.repo, resolved: chosen }];
  });
});

const searchRepos = Effect.fn("GitHubPullRequests.searchRepos")(function* (
  cwd: string,
  host: GitHubHost,
  headRepo: string,
): Effect.fn.Return<string[], PullRequestError> {
  const repos = (yield* remoteRepos(cwd, host)).flatMap(({ repo, resolved }) =>
    resolved ? [repo, resolved] : [repo],
  );
  return [...new Set([headRepo, ...repos])];
});

export const isFromBranch = (
  pr: { readonly head?: string | undefined; readonly headRepo?: string | undefined },
  branch: BranchHead,
): boolean => pr.head === branch.name && pr.headRepo === branch.repo;

export const GitHubPullRequest = Schema.Struct({
  url: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  state: Schema.Literals(["OPEN", "MERGED", "CLOSED"]),
  isDraft: Schema.Boolean,
  reviewDecision: Schema.NullOr(Schema.String),
  statusCheckRollup: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          __typename: Schema.optional(Schema.String),
          status: Schema.optional(Schema.String),
          conclusion: Schema.optional(Schema.NullOr(Schema.String)),
          state: Schema.optional(Schema.String),
        }),
      ),
    ),
  ),
  author: Schema.optional(Schema.NullOr(Schema.Struct({ login: Schema.String }))),
  headRefName: Schema.optional(Schema.String),
  baseRefName: Schema.optional(Schema.String),
  headRepository: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
  headRepositoryOwner: Schema.optional(Schema.NullOr(Schema.Struct({ login: Schema.String }))),
  additions: Schema.optional(Schema.Number),
  deletions: Schema.optional(Schema.Number),
  changedFiles: Schema.optional(Schema.Number),
  updatedAt: Schema.optional(Schema.String),
  closedAt: Schema.optional(Schema.NullOr(Schema.String)),
});
export type GitHubPullRequest = typeof GitHubPullRequest.Type;
const RepositoryName = Schema.Struct({ nameWithOwner: Schema.String });
const fieldsWithoutChecks =
  "url,number,title,state,isDraft,reviewDecision,author,headRefName,baseRefName,headRepository,headRepositoryOwner,additions,deletions,changedFiles,updatedAt,closedAt";
const fields = `${fieldsWithoutChecks},statusCheckRollup`;

function graphqlErrors(stderr: string): { message: string; path: string }[] {
  const body = stderr.match(/GraphQL: (.*)/)?.[1] ?? "";
  return [...body.matchAll(/\s*([^,(]+?)\s*\(([\w.]+)\)/g)].map((m) => ({
    message: m[1]!,
    path: m[2]!,
  }));
}
const refused = (message: string) => /^Resource not accessible by /i.test(message);

export function onlyChecksRefused(stderr: string): boolean {
  const errors = graphqlErrors(stderr);
  return (
    errors.length > 0 &&
    errors.every((e) => refused(e.message) && e.path.split(".").includes("statusCheckRollup"))
  );
}

const onlyRepositoryUnresolved = (stderr: string) => {
  const errors = graphqlErrors(stderr);
  return (
    errors.length > 0 &&
    errors.every(
      (e) => e.path === "repository" && e.message.startsWith("Could not resolve to a Repository "),
    )
  );
};

export function ghFailureDetail(
  error: Pick<SubprocessError, "reason" | "stderr">,
  host: GitHubHost,
): string {
  const exe = host === EXE_GITHUB;
  if (error.reason === "timeout") return "GitHub did not answer within 15 seconds. Retry.";
  if (error.reason === "start") return "Could not run gh. Check that the GitHub CLI is installed.";
  const stderr = error.stderr;
  const denied = graphqlErrors(stderr).filter((e) => refused(e.message));
  if (denied.length || /Resource not accessible by /i.test(stderr)) {
    const names = [
      ...new Set(
        denied.map((e) => e.path.split(".").findLast((p) => !/^\d+$/.test(p) && p !== "nodes")!),
      ),
    ];
    const what = names.length ? names.join(", ") : "this resource";
    return exe
      ? `GitHub refused this VM's GitHub integration access to ${what}. Grant it access, then retry.`
      : `GitHub refused the gh token access to ${what}. Grant the token that permission, then retry.`;
  }
  if (/gh auth login|not logged in|HTTP 401|Bad credentials|authentication required/i.test(stderr))
    return exe
      ? "GitHub did not accept this VM's GitHub integration. Check the integration, then retry."
      : `gh is not logged in to ${host}. Run gh auth login, then retry.`;
  if (/Could not resolve to a (Repository|PullRequest)|HTTP 404/i.test(stderr))
    return "GitHub found no such repository or pull request, or this token cannot see it.";
  if (/HTTP 403|rate limit/i.test(stderr))
    return /rate limit/i.test(stderr)
      ? "GitHub's rate limit was reached. Retry later."
      : "GitHub refused the request. Check the token's repository access, then retry.";
  if (
    /could not connect|dial tcp|no such host|connection refused|ETIMEDOUT|EAI_AGAIN/i.test(stderr)
  )
    return `Could not reach ${host}. Check the network, then retry.`;
  return exe
    ? "Could not read GitHub through exe.dev. Check that this VM's GitHub integration can access the repository, then retry."
    : "Could not read GitHub. Check gh authentication and repository access, then retry.";
}

export function facts(raw: GitHubPullRequest): PullRequest {
  const checks = raw.statusCheckRollup ?? [];
  const unread = raw.statusCheckRollup === undefined;
  const failed = checks.some((c) =>
    c.__typename === "StatusContext"
      ? c.state === "FAILURE" || c.state === "ERROR"
      : c.status === "COMPLETED" &&
        !!c.conclusion &&
        !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(c.conclusion),
  );
  const pending = checks.some((c) =>
    c.__typename === "StatusContext" ? c.state !== "SUCCESS" : c.status !== "COMPLETED",
  );
  const key = pullRequestIdentity(raw.url);
  if (!key) throw new Error("Invalid pull request URL.");
  if (key.number !== raw.number) throw new Error("Mismatched pull request identity.");
  const headRepo =
    raw.headRepositoryOwner && raw.headRepository
      ? githubRemote(
          `https://github.com/${raw.headRepositoryOwner.login}/${raw.headRepository.name}`,
        )?.repo
      : undefined;
  return {
    url: key.url,
    repo: key.repo,
    number: key.number,
    title: raw.title,
    state:
      raw.state === "MERGED"
        ? "merged"
        : raw.state === "CLOSED"
          ? "closed"
          : raw.isDraft
            ? "draft"
            : "open",
    checks: unread
      ? "unknown"
      : failed
        ? "failure"
        : pending
          ? "pending"
          : checks.length
            ? "success"
            : "none",
    review:
      raw.reviewDecision === "APPROVED"
        ? "approved"
        : raw.reviewDecision === "CHANGES_REQUESTED"
          ? "changes_requested"
          : raw.reviewDecision === "REVIEW_REQUIRED"
            ? "review_required"
            : "none",
    ...(raw.author ? { author: raw.author.login } : {}),
    ...(headRepo ? { headRepo } : {}),
    baseRepo: key.repo,
    ...(raw.headRefName && raw.baseRefName ? { head: raw.headRefName, base: raw.baseRefName } : {}),
    ...(raw.additions !== undefined && raw.deletions !== undefined && raw.changedFiles !== undefined
      ? { additions: raw.additions, deletions: raw.deletions, changedFiles: raw.changedFiles }
      : {}),
    ...(raw.state !== "OPEN" && raw.closedAt
      ? { at: raw.closedAt }
      : raw.updatedAt
        ? { at: raw.updatedAt }
        : {}),
  };
}

const linkFor = (url: string, host: GitHubHost): PullRequestLink =>
  host === EXE_GITHUB ? { url, apiHost: EXE_GITHUB } : { url };

const parse = (url: string) => {
  const identity = pullRequestIdentity(url);
  return identity
    ? Effect.succeed(identity)
    : Effect.fail(failure("Enter a GitHub pull request URL."));
};

const checkoutHost = (cwd: string): Effect.Effect<GitHubHost> =>
  observeBranchRemote(cwd).pipe(
    Effect.map((remote) => (remote?.on === "github" ? remote.apiHost : "github.com")),
    Effect.orElseSucceed(() => "github.com" as const),
  );

export class GitHubPullRequests extends Context.Service<
  GitHubPullRequests,
  {
    readonly link: (url: string, cwd: string) => Effect.Effect<PullRequestLink, PullRequestError>;
    readonly view: (
      link: PullRequestLink,
      cwd: string,
    ) => Effect.Effect<PullRequest, PullRequestError>;
    readonly openForHead: (
      cwd: string,
      branch: string,
      repo: string,
      host: GitHubHost,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly link: PullRequestLink; readonly pullRequest: PullRequest }>,
      PullRequestError
    >;
    readonly checkoutNames: (
      cwd: string,
      branch: BranchHead | null,
      host: GitHubHost,
      branches: PullRequestBranches,
    ) => Effect.Effect<PullRequestBranches, PullRequestError>;
  }
>()("piano/GitHubPullRequests") {}

export const GitHubPullRequestsLive = Layer.effect(
  GitHubPullRequests,
  Effect.gen(function* () {
    const ghCli = yield* GhCommand;
    const gh = (cwd: string, args: string[], host: GitHubHost) =>
      runProcess({
        command: ghCli,
        args,
        cwd,
        env: { ...childEnvironment(), GH_HOST: host, GH_REPO: undefined },
        timeout: 15000,
        limit: 4 * 1024 * 1024,
      }).pipe(Effect.map((result) => result.stdout.toString().trim()));
    const ghJsonOutput = (cwd: string, args: string[], host: GitHubHost) =>
      gh(cwd, [...args, fields], host).pipe(
        Effect.catchIf(
          (error) => error.reason === "exit" && onlyChecksRefused(error.stderr),
          () => gh(cwd, [...args, fieldsWithoutChecks], host),
        ),
      );
    const ghJson = (cwd: string, args: string[], host: GitHubHost) =>
      ghJsonOutput(cwd, args, host).pipe(
        Effect.mapError((error) => failure(ghFailureDetail(error, host))),
      );
    const currentName = (cwd: string, repo: string, host: GitHubHost) =>
      gh(cwd, ["repo", "view", `${host}/${repo}`, "--json", "nameWithOwner"], host).pipe(
        Effect.mapError((error) => failure(ghFailureDetail(error, host))),
        Effect.flatMap((output) =>
          Effect.try({
            try: () =>
              githubRemote(
                `https://github.com/${Schema.decodeUnknownSync(Schema.fromJsonString(RepositoryName))(output).nameWithOwner}`,
              )!.repo,
            catch: () => failure("GitHub returned an invalid repository response."),
          }),
        ),
      );
    const currentNames = (cwd: string, host: GitHubHost) => {
      const known = new Map<string, string>();
      return (repo: string) => {
        const name = known.get(repo);
        return name !== undefined
          ? Effect.succeed(name)
          : currentName(cwd, repo, host).pipe(
              Effect.tap((current) => Effect.sync(() => known.set(repo, current))),
            );
      };
    };
    const trackedHeadRepo = (
      current: (repo: string) => Effect.Effect<string, PullRequestError>,
      branch: BranchHead,
      pr: { readonly head?: string | undefined; readonly headRepo?: string | undefined },
    ): Effect.Effect<string | undefined, PullRequestError> =>
      pr.head === branch.name && pr.headRepo && pr.headRepo !== branch.repo
        ? current(branch.repo).pipe(
            Effect.map((name) => (name === pr.headRepo ? branch.repo : pr.headRepo)),
          )
        : Effect.succeed(pr.headRepo);
    return GitHubPullRequests.of({
      link: Effect.fn("GitHubPullRequests.link")(function* (url, cwd) {
        const identity = yield* parse(url);
        return linkFor(
          identity.url,
          identity.host === EXE_GITHUB ? EXE_GITHUB : yield* checkoutHost(cwd),
        );
      }),
      view: Effect.fn("GitHubPullRequests.view")(function* (link, cwd) {
        const identity = yield* parse(link.url);
        const host = link.apiHost ?? (yield* checkoutHost(cwd));
        const output = yield* ghJson(
          process.cwd(),
          ["pr", "view", String(identity.number), "--repo", `${host}/${identity.repo}`, "--json"],
          host,
        );
        return yield* Effect.try({
          try: () =>
            facts(Schema.decodeUnknownSync(Schema.fromJsonString(GitHubPullRequest))(output)),
          catch: () => failure("GitHub returned an invalid pull request response."),
        });
      }),
      openForHead: Effect.fn("GitHubPullRequests.openForHead")(function* (cwd, branch, repo, host) {
        const repos = yield* searchRepos(cwd, host, repo);
        const lists = yield* Effect.forEach(
          repos,
          (searched) =>
            ghJsonOutput(
              cwd,
              [
                "pr",
                "list",
                "--head",
                branch,
                "--state",
                "open",
                "--limit",
                "100",
                "--repo",
                `${host}/${searched}`,
                "--json",
              ],
              host,
            ).pipe(
              Effect.catchIf(
                (error) =>
                  searched !== repo &&
                  error.reason === "exit" &&
                  onlyRepositoryUnresolved(error.stderr),
                () => Effect.succeed("[]"),
              ),
              Effect.mapError((error) => failure(ghFailureDetail(error, host))),
              Effect.flatMap((output) =>
                Effect.try({
                  try: () =>
                    Schema.decodeUnknownSync(
                      Schema.fromJsonString(Schema.Array(GitHubPullRequest)),
                    )(output).map((raw) => ({ head: raw.headRefName, pullRequest: facts(raw) })),
                  catch: () => failure("GitHub returned an invalid pull request response."),
                }),
              ),
            ),
          { concurrency: "unbounded" },
        );
        const current = currentNames(cwd, host);
        const tracked = { name: branch, repo };
        const matches = new Map<string, PullRequest>();
        for (const { head, pullRequest } of lists.flat()) {
          const headRepo = yield* trackedHeadRepo(current, tracked, {
            head,
            headRepo: pullRequest.headRepo,
          });
          if (isFromBranch({ head, headRepo }, tracked))
            matches.set(pullRequestIdentity(pullRequest.url)?.url ?? pullRequest.url, pullRequest);
        }
        return [...matches.values()].map((pullRequest) => ({
          link: linkFor(pullRequest.url, host),
          pullRequest,
        }));
      }),
      checkoutNames: Effect.fn("GitHubPullRequests.checkoutNames")(
        function* (cwd, branch, host, branches) {
          if (!branch) return branches;
          const current = currentNames(cwd, host);
          const headRepo = yield* trackedHeadRepo(current, branch, branches);
          let baseRepo = branches.baseRepo;
          if (baseRepo && isFromBranch({ head: branches.head, headRepo }, branch)) {
            const named = [...new Set((yield* remoteRepos(cwd, host)).map(({ repo }) => repo))];
            if (!named.includes(baseRepo))
              for (const repo of named)
                if ((yield* current(repo).pipe(Effect.orElseSucceed(() => null))) === baseRepo) {
                  baseRepo = repo;
                  break;
                }
          }
          return {
            ...branches,
            ...(headRepo ? { headRepo } : {}),
            ...(baseRepo ? { baseRepo } : {}),
          };
        },
      ),
    });
  }),
);
