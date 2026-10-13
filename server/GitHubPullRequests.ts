/** GitHub adapter for pull requests: URL identity, remote parsing, the `gh` response shape and
 * its mapping into wire `PullRequest` facts, and host routing through `gh`. Nothing else in
 * Piano knows how GitHub or `gh` phrase a pull request; session-link policy lives in
 * SessionPullRequests.
 */
import { Context, Data, Effect, Layer, Schema } from "effect";
import type { PullRequest } from "../shared/wire.ts";
import { GhCommand, run as runProcess } from "./Subprocess.ts";

export class PullRequestError extends Data.TaggedError("PullRequestError")<{
  readonly detail: string;
}> {
  override get message() {
    return this.detail;
  }
}
const failure = (detail: string) => new PullRequestError({ detail });

export const EXE_GITHUB = "github.int.exe.xyz";
/** The API route `gh` authenticates against; browser URLs always name github.com. */
export type GitHubHost = "github.com" | typeof EXE_GITHUB;

export interface PullRequestIdentity {
  /** Lower-case "owner/name". */
  readonly repo: string;
  readonly number: number;
  /** Canonical browser URL on github.com. */
  readonly url: string;
  /** The host the URL named: an exe.dev integration URL implies that route. */
  readonly host: GitHubHost;
}

/** Parse a GitHub pull request URL (github.com or the exe.dev integration), or null. */
export function pullRequestIdentity(raw: string): PullRequestIdentity | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const match = u.pathname.match(
    /^\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d*)(?:\/(?:files|commits|checks))?\/?$/,
  );
  if (
    u.protocol !== "https:" ||
    (u.hostname !== "github.com" && u.hostname !== EXE_GITHUB) ||
    u.port ||
    u.username ||
    u.password ||
    !match
  )
    return null;
  const repo = match[1]!.toLowerCase(),
    number = Number(match[2]);
  if (!Number.isSafeInteger(number)) return null;
  return {
    repo,
    number,
    url: `https://github.com/${repo}/pull/${number}`,
    host: u.hostname === EXE_GITHUB ? EXE_GITHUB : "github.com",
  };
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
  additions: Schema.optional(Schema.Number),
  deletions: Schema.optional(Schema.Number),
  changedFiles: Schema.optional(Schema.Number),
  updatedAt: Schema.optional(Schema.String),
  closedAt: Schema.optional(Schema.NullOr(Schema.String)),
});
export type GitHubPullRequest = typeof GitHubPullRequest.Type;
const Candidate = Schema.Struct({
  ...GitHubPullRequest.fields,
  headRefName: Schema.String,
  headRepository: Schema.NullOr(Schema.Struct({ name: Schema.String })),
  headRepositoryOwner: Schema.NullOr(Schema.Struct({ login: Schema.String })),
});
const fields =
  "url,number,title,state,isDraft,reviewDecision,statusCheckRollup,author,headRefName,baseRefName,additions,deletions,changedFiles,updatedAt,closedAt";

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

export class GitHubPullRequests extends Context.Service<
  GitHubPullRequests,
  {
    /** Live facts for one pull request, read through the given API route. */
    readonly view: (
      identity: PullRequestIdentity,
      host: GitHubHost,
    ) => Effect.Effect<PullRequest, PullRequestError>;
    /** Open pull requests whose head is `branch` in head repository `repo` ("owner/name").
     * `cwd` is the checkout: on github.com, gh resolves the base repository (including a fork
     * parent) from it. */
    readonly openForHead: (
      cwd: string,
      branch: string,
      repo: string,
      host: GitHubHost,
    ) => Effect.Effect<ReadonlyArray<PullRequest>, PullRequestError>;
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
        env: { ...process.env, GH_HOST: host, GH_REPO: undefined },
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
      view: Effect.fn("GitHubPullRequests.view")(function* (identity, host) {
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
            `${fields},headRepository,headRepositoryOwner`,
            ...(host === EXE_GITHUB ? ["--repo", `${EXE_GITHUB}/${repo}`] : []),
          ],
          host,
        );
        const candidates = yield* Effect.try({
          try: () =>
            Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Candidate)))(output),
          catch: () => failure("GitHub returned an invalid pull request response."),
        });
        const matches = candidates.filter(
          (p) =>
            p.headRefName === branch &&
            `${p.headRepositoryOwner?.login}/${p.headRepository?.name}`.toLowerCase() === repo,
        );
        return yield* Effect.try({
          try: () => matches.map(facts),
          catch: () => failure("GitHub returned an invalid pull request URL."),
        });
      }),
    });
  }),
);
