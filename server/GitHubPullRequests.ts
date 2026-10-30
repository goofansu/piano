/** GitHub adapter for pull requests: remote parsing, the `gh` response shape and its mapping
 * into wire `PullRequest` facts, and API host routing through `gh`: which route a saved link, URL
 * or checkout reads through, and how a link records it. Nothing else in Piano knows how GitHub or
 * `gh` phrase a pull request; which pull request a URL names is `shared/pullRequestIdentity.ts`,
 * and session-link policy lives in SessionPullRequests.
 */
import { Context, Data, Effect, Layer, Schema } from "effect";
import { EXE_GITHUB, type GitHubHost, pullRequestIdentity } from "../shared/pullRequestIdentity.ts";
import type { PullRequest } from "../shared/wire.ts";
import { childEnvironment } from "./ChildEnvironment.ts";
import { type BranchHome, observeGit } from "./GitCheckout.ts";
import { GhCommand, run as runProcess } from "./Subprocess.ts";

export class PullRequestError extends Data.TaggedError("PullRequestError")<{
  readonly detail: string;
}> {
  override get message() {
    return this.detail;
  }
}
const failure = (detail: string) => new PullRequestError({ detail });

/** A pull request as a session saves it: the canonical github.com URL, plus the API route when
 * it is not github.com. The saved route outlives the checkout that implied it. */
export interface PullRequestLink {
  readonly url: string;
  readonly apiHost?: typeof EXE_GITHUB;
}

/** The repository and API route a Git remote URL names, or null for a non-GitHub remote. */
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

/** A branch as GitHub knows it: its name on the remote it pushes to, in that remote's repository. */
export interface BranchHead {
  readonly name: string;
  readonly repo: string;
}

/** Where a branch's work goes, as GitHub sees it: no remote, a remote not on GitHub, or a GitHub
 * repository read through its API route, with the branch there unless detached. Discovery, the
 * API route of a link and the pull request Changes compares with all read a branch this way. */
export type BranchRemote =
  | { readonly on: "none" }
  | { readonly on: "other" }
  | { readonly on: "github"; readonly apiHost: GitHubHost; readonly head: BranchHead | null };

/** Where Git says a branch lives (GitCheckout's `BranchHome`) as GitHub sees it, pushed or not:
 * each caller decides what an unpushed branch means to it. */
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

/** `cwd`'s branch as GitHub sees it, read in `cwd` through GitCheckout's hardened observation
 * (INV-06): inherited GIT_* state cannot redirect it. Null outside Git; fails when Git cannot
 * answer. A branch Git holds no pushed ref for still names where it would be: discovery can find
 * a pull request opened from a push Git has not fetched. */
export const observeBranchRemote = Effect.fn("GitHubPullRequests.observeBranchRemote")(function* (
  cwd: string,
): Effect.fn.Return<BranchRemote | null, PullRequestError> {
  const observed = yield* observeGit(cwd, { home: true });
  if (observed.status === "broken") return yield* failure(observed.detail);
  if (observed.status === "non-git" || !observed.home) return null;
  return branchRemote(observed.home);
});

/** Whether a pull request was opened from `branch`: its head names the same branch in the same
 * repository. Discovery and Changes both ask this; a same-named branch of a fork is another. */
export const isFromBranch = (
  pr: { readonly head?: string | undefined; readonly headRepo?: string | undefined },
  branch: BranchHead,
): boolean => pr.head === branch.name && pr.headRepo === branch.repo;

/** One pull request as `gh pr view/list --json` returns it. */
export const GitHubPullRequest = Schema.Struct({
  url: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  state: Schema.Literals(["OPEN", "MERGED", "CLOSED"]),
  isDraft: Schema.Boolean,
  reviewDecision: Schema.NullOr(Schema.String),
  statusCheckRollup: Schema.NullOr(
    Schema.Array(
      Schema.Struct({
        __typename: Schema.optional(Schema.String),
        status: Schema.optional(Schema.String),
        conclusion: Schema.optional(Schema.NullOr(Schema.String)),
        state: Schema.optional(Schema.String),
      }),
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
const fields =
  "url,number,title,state,isDraft,reviewDecision,statusCheckRollup,author,headRefName,baseRefName,headRepository,headRepositoryOwner,additions,deletions,changedFiles,updatedAt,closedAt";

/** Map GitHub's response into wire facts. Throws when the URL is not a pull request URL or
 * disagrees with the number. */
export function facts(raw: GitHubPullRequest): PullRequest {
  const checks = raw.statusCheckRollup ?? [];
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
    checks: failed ? "failure" : pending ? "pending" : checks.length ? "success" : "none",
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
    // Merged and closed PRs date their disposition; open work dates its last activity.
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

/** The API route `cwd`'s GitHub remote implies; github.com when it names none or is unreadable. */
const checkoutHost = (cwd: string): Effect.Effect<GitHubHost> =>
  observeBranchRemote(cwd).pipe(
    Effect.map((remote) => (remote?.on === "github" ? remote.apiHost : "github.com")),
    Effect.orElseSucceed(() => "github.com" as const),
  );

export class GitHubPullRequests extends Context.Service<
  GitHubPullRequests,
  {
    /** The link to save for a pull request URL. Its route is the URL's own when the URL names
     * the exe.dev integration, else the one `cwd`'s remote implies, else github.com. */
    readonly link: (url: string, cwd: string) => Effect.Effect<PullRequestLink, PullRequestError>;
    /** Live facts for a saved link, read through its saved route, else the one `cwd`'s remote
     * implies, else github.com. The checkout need not still exist. */
    readonly view: (
      link: PullRequestLink,
      cwd: string,
    ) => Effect.Effect<PullRequest, PullRequestError>;
    /** Open pull requests whose head is `branch` in head repository `repo` ("owner/name"),
     * each with the link that reads it back through `host`. `cwd` is the checkout: on
     * github.com, gh resolves the base repository (including a fork parent) from it. */
    readonly openForHead: (
      cwd: string,
      branch: string,
      repo: string,
      host: GitHubHost,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly link: PullRequestLink; readonly pullRequest: PullRequest }>,
      PullRequestError
    >;
  }
>()("piano/GitHubPullRequests") {}

export const GitHubPullRequestsLive = Layer.effect(
  GitHubPullRequests,
  Effect.gen(function* () {
    const ghCli = yield* GhCommand;
    // Scope routing to this subprocess; never change global gh config or credentials.
    const gh = (cwd: string, args: string[], host: GitHubHost) =>
      runProcess({
        command: ghCli,
        args,
        cwd,
        env: { ...childEnvironment(), GH_HOST: host, GH_REPO: undefined },
        timeout: 15000,
        limit: 4 * 1024 * 1024,
      }).pipe(
        Effect.map((result) => result.stdout.toString().trim()),
        Effect.mapError(() =>
          failure(
            host === EXE_GITHUB
              ? "Could not read GitHub through exe.dev. Check that this VM's GitHub integration can access the repository, then retry."
              : "Could not read GitHub. Check gh authentication and repository access, then retry.",
          ),
        ),
      );
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
        // A public URL overrides GH_HOST in gh. Use number + explicit API repository instead.
        // Neither this lookup nor a saved integration route needs the checkout to still exist.
        const output = yield* gh(
          process.cwd(),
          [
            "pr",
            "view",
            String(identity.number),
            "--repo",
            `${host}/${identity.repo}`,
            "--json",
            fields,
          ],
          host,
        );
        return yield* Effect.try({
          try: () =>
            facts(Schema.decodeUnknownSync(Schema.fromJsonString(GitHubPullRequest))(output)),
          catch: () => failure("GitHub returned an invalid pull request response."),
        });
      }),
      openForHead: Effect.fn("GitHubPullRequests.openForHead")(function* (cwd, branch, repo, host) {
        // Normal remotes let gh select the base repository (including fork parents).
        // Integration remotes name the authorized repository explicitly. Match the head
        // repository too: unrelated forks often have identically named branches.
        const output = yield* gh(
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
            "--json",
            fields,
            ...(host === EXE_GITHUB ? ["--repo", `${EXE_GITHUB}/${repo}`] : []),
          ],
          host,
        );
        const candidates = yield* Effect.try({
          try: () =>
            Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(GitHubPullRequest)))(
              output,
            ).map((raw) => ({ head: raw.headRefName, pullRequest: facts(raw) })),
          catch: () => failure("GitHub returned an invalid pull request response."),
        });
        return candidates
          .filter((p) =>
            isFromBranch(
              { head: p.head, headRepo: p.pullRequest.headRepo },
              { name: branch, repo },
            ),
          )
          .map(({ pullRequest }) => ({ link: linkFor(pullRequest.url, host), pullRequest }));
      }),
    });
  }),
);
