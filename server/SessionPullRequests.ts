/** Session-owned PR associations. Git discovers candidates; GitHub owns live facts.
 * Transcript contents never participate. Registry retains only identity and user preference.
 */
import { execFile } from "node:child_process";
import { Context, Data, Effect, Layer, Schema } from "effect";
import type { PullRequest, SessionPullRequest, SessionPullRequestAction, SessionPullRequestLink } from "../shared/wire.ts";
import { Registry, type RegistryError, type SessionEntry } from "./Registry.ts";

export class PullRequestError extends Data.TaggedError("PullRequestError")<{ readonly detail: string }> {
  override get message() { return this.detail; }
}
const failure = (detail: string) => new PullRequestError({ detail });

const EXE_GITHUB = "github.int.exe.xyz";
type GitHubHost = "github.com" | typeof EXE_GITHUB;

const run = (command: string, args: string[], cwd: string, env = process.env) => Effect.tryPromise({
  try: signal => new Promise<string>((resolve, reject) => {
    execFile(command, args, { cwd, env, signal, timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message)); else resolve(stdout.trim());
    });
  }),
  catch: error => failure(error instanceof Error ? error.message : String(error)),
});

function identity(raw: string) {
  const u = new URL(raw.trim());
  const match = u.pathname.match(/^\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d*)(?:\/(?:files|commits|checks))?\/?$/);
  if (u.protocol !== "https:" || (u.hostname !== "github.com" && u.hostname !== EXE_GITHUB) || u.port || u.username || u.password || !match) throw new Error("Enter a GitHub pull request URL.");
  const repo = match[1]!.toLowerCase(), number = Number(match[2]);
  if (!Number.isSafeInteger(number)) throw new Error("Invalid pull request number.");
  return { repo, number, url: `https://github.com/${repo}/pull/${number}` };
}
const parseIdentity = (url: string) => Effect.try({ try: () => identity(url), catch: () => failure("Enter a GitHub pull request URL.") });

const RawPr = Schema.Struct({
  url: Schema.String, number: Schema.Number, title: Schema.String,
  state: Schema.Literals(["OPEN", "MERGED", "CLOSED"]), isDraft: Schema.Boolean,
  reviewDecision: Schema.NullOr(Schema.String),
  statusCheckRollup: Schema.NullOr(Schema.Array(Schema.Struct({
    __typename: Schema.optional(Schema.String), status: Schema.optional(Schema.String),
    conclusion: Schema.optional(Schema.NullOr(Schema.String)), state: Schema.optional(Schema.String),
  }))),
});
const Candidate = Schema.Struct({ ...RawPr.fields, headRefName: Schema.String,
  headRepository: Schema.NullOr(Schema.Struct({ name: Schema.String })),
  headRepositoryOwner: Schema.NullOr(Schema.Struct({ login: Schema.String })),
});
const fields = "url,number,title,state,isDraft,reviewDecision,statusCheckRollup";
function facts(raw: typeof RawPr.Type): PullRequest {
  const checks = raw.statusCheckRollup ?? [];
  const failed = checks.some(c => c.__typename === "StatusContext" ? c.state === "FAILURE" || c.state === "ERROR"
    : c.status === "COMPLETED" && !!c.conclusion && !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(c.conclusion));
  const pending = checks.some(c => c.__typename === "StatusContext" ? c.state !== "SUCCESS" : c.status !== "COMPLETED");
  const key = identity(raw.url);
  if (key.number !== raw.number) throw new Error("Mismatched pull request identity.");
  return { ...key, title: raw.title,
    state: raw.state === "MERGED" ? "merged" : raw.state === "CLOSED" ? "closed" : raw.isDraft ? "draft" : "open",
    checks: failed ? "failure" : pending ? "pending" : checks.length ? "success" : "none",
    review: raw.reviewDecision === "APPROVED" ? "approved" : raw.reviewDecision === "CHANGES_REQUESTED" ? "changes_requested" : raw.reviewDecision === "REVIEW_REQUIRED" ? "review_required" : "none",
  };
}

/** Observe both branch and head repository, including tracking-remote choice. */
const checkout = (cwd: string) => Effect.gen(function* () {
  const inside = yield* run("git", ["rev-parse", "--is-inside-work-tree"], cwd).pipe(
    Effect.catchIf(e => /not a git repository/.test(e.detail), () => Effect.succeed("false")));
  if (inside !== "true") return null;
  const branch = yield* run("git", ["branch", "--show-current"], cwd);
  const tracking = branch ? yield* run("git", ["for-each-ref", "--format=%(upstream:remotename)", `refs/heads/${branch}`], cwd) : "";
  const remote = yield* run("git", ["remote", "get-url", tracking && tracking !== "." ? tracking : "origin"], cwd).pipe(
    Effect.catchIf(e => /No such remote/.test(e.detail), () => Effect.succeed("")));
  const proxy = remote.match(/^https:\/\/github\.int\.exe\.xyz\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i);
  const match = proxy ?? remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i);
  if (!remote) return null;
  if (!match) return yield* failure("Branch discovery needs a GitHub or exe.dev GitHub integration remote. Link a pull request explicitly for this checkout.");
  return { branch, remote, repo: match[1]!.toLowerCase(), apiHost: proxy ? EXE_GITHUB : "github.com" as GitHubHost };
});

export class SessionPullRequests extends Context.Service<SessionPullRequests, {
  readonly get: (cwd: string, sessionId: string) => Effect.Effect<SessionPullRequest, PullRequestError | RegistryError>;
  readonly change: (cwd: string, sessionId: string, action: SessionPullRequestAction) => Effect.Effect<SessionPullRequest, PullRequestError | RegistryError>;
}>()("piano/SessionPullRequests") {}

export const SessionPullRequestsLive = Layer.effect(SessionPullRequests, Effect.gen(function* () {
  const registry = yield* Registry;
  const entry = (cwd: string, sessionId: string) => Effect.gen(function* () {
    const found = (yield* registry.get).sessions.find(s => s.cwd === cwd && s.sessionId === sessionId);
    if (!found) return yield* failure("Session is not registered. Refresh the session list.");
    return found;
  });
  // Scope routing to this subprocess; never change global gh config or credentials.
  const gh = (cwd: string, args: string[], host: GitHubHost) => run("gh", args, cwd, { ...process.env, GH_HOST: host, GH_REPO: undefined }).pipe(
    Effect.mapError(() => failure(host === EXE_GITHUB
      ? "Could not read GitHub through exe.dev. Check that this VM's GitHub integration can access the repository, then retry."
      : "Could not read GitHub. Check gh authentication and repository access, then retry.")));
  const hostFor = (s: SessionEntry) => s.pullRequest?.apiHost ? Effect.succeed(s.pullRequest.apiHost)
    : checkout(s.cwd).pipe(Effect.map(c => c?.apiHost ?? "github.com" as GitHubHost), Effect.orElseSucceed(() => "github.com" as const));
  const view = (url: string, host: GitHubHost) => Effect.gen(function* () {
    const key = yield* parseIdentity(url);
    // A public URL overrides GH_HOST in gh. Use number + explicit API repository instead.
    // Neither this lookup nor a saved integration route needs the checkout to still exist.
    const output = yield* gh(process.cwd(), ["pr", "view", String(key.number), "--repo", `${host}/${key.repo}`, "--json", fields], host);
    return yield* Effect.try({ try: () => facts(Schema.decodeUnknownSync(Schema.fromJsonString(RawPr))(output)),
      catch: () => failure("GitHub returned an invalid pull request response.") });
  });
  const save = (expected: SessionEntry, link: SessionEntry["pullRequest"]) => Effect.gen(function* () {
    if (!(yield* registry.setSessionPullRequest(expected, link))) return yield* failure("The session's pull request changed during lookup. Refresh and try again.");
  });
  const result = (s: SessionEntry, forceDiscovery = false): Effect.Effect<SessionPullRequest, PullRequestError | RegistryError> => Effect.gen(function* () {
    if (!forceDiscovery && s.pullRequest === null) return { link: null, pullRequest: null, discovery: false };
    if (!forceDiscovery && s.pullRequest) {
      const pullRequest = yield* view(s.pullRequest.url, yield* hostFor(s)).pipe(Effect.result);
      // A failed lookup retains the association, not stale success/checks.
      return pullRequest._tag === "Success"
        ? { link: s.pullRequest, pullRequest: pullRequest.success, discovery: false }
        : { link: s.pullRequest, pullRequest: null, discovery: false, error: pullRequest.failure.detail };
    }
    const discover = Effect.gen(function* () {
      const before = yield* checkout(s.cwd);
      if (!before?.branch) return null;
      // Normal remotes let gh select the base repository (including fork parents).
      // Integration remotes name the authorized repository explicitly. Match the head
      // repository too: unrelated forks often have identically named branches.
      const output = yield* gh(s.cwd, ["pr", "list", "--head", before.branch, "--state", "open", "--limit", "100", "--json", `${fields},headRefName,headRepository,headRepositoryOwner`,
        ...(before.apiHost === EXE_GITHUB ? ["--repo", `${EXE_GITHUB}/${before.repo}`] : [])], before.apiHost);
      const candidates = yield* Effect.try({ try: () => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Candidate)))(output),
        catch: () => failure("GitHub returned an invalid pull request response.") });
      const matches = candidates.filter(p => p.headRefName === before.branch && `${p.headRepositoryOwner?.login}/${p.headRepository?.name}`.toLowerCase() === before.repo);
      if (matches.length > 1) return yield* failure("Several pull requests match this branch. Link the intended pull request explicitly.");
      if (!matches.length) return null;
      const after = yield* checkout(s.cwd);
      if (JSON.stringify(before) !== JSON.stringify(after)) return yield* failure("The checkout changed during lookup. Retry discovery.");
      const pullRequest = yield* Effect.try({ try: () => facts(matches[0]!), catch: () => failure("GitHub returned an invalid pull request URL.") });
      return { pullRequest, apiHost: before.apiHost };
    });
    const found = yield* discover.pipe(Effect.result);
    if (found._tag === "Failure") return { link: s.pullRequest ?? null, pullRequest: null, discovery: s.pullRequest === undefined, error: found.failure.detail };
    if (!found.success) {
      if (s.pullRequest) return { ...(yield* result(s)), error: "No matching open pull request for the current branch." };
      if (forceDiscovery) yield* save(s, undefined);
      return { link: null, pullRequest: null, discovery: true };
    }
    const link: SessionPullRequestLink = { url: found.success.pullRequest.url, source: "branch",
      ...(found.success.apiHost === EXE_GITHUB ? { apiHost: EXE_GITHUB } : {}) };
    yield* save(s, link);
    return { link, pullRequest: found.success.pullRequest, discovery: false };
  });
  return SessionPullRequests.of({
    get: (cwd, sessionId) => Effect.gen(function* () { return yield* result(yield* entry(cwd, sessionId)); }),
    change: (cwd, sessionId, action) => Effect.gen(function* () {
      const s = yield* entry(cwd, sessionId);
      if (action.action === "link") {
        // Explicit association is the user's choice, not a claim that GitHub is reachable.
        const key = yield* parseIdentity(action.url);
        // A new explicit choice follows its URL/workspace route, not a previous link's route.
        const host = new URL(action.url.trim()).hostname === EXE_GITHUB ? EXE_GITHUB : yield* hostFor({ ...s, pullRequest: undefined });
        const link: SessionPullRequestLink = { url: key.url, source: "manual", ...(host === EXE_GITHUB ? { apiHost: EXE_GITHUB } : {}) };
        yield* save(s, link);
        return yield* result(yield* entry(cwd, sessionId));
      }
      if (action.action === "discover") return yield* result(s, true);
      yield* save(s, null);
      return { link: null, pullRequest: null, discovery: false };
    }),
  });
}));
