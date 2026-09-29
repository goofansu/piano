/**
 * Pull requests for a session, through the `gh` CLI: every GitHub PR URL that
 * appeared in the transcript. Lookups are cached briefly; a machine without `gh`
 * simply yields nothing.
 */
import { execFile } from "node:child_process";
import { Effect } from "effect";
import type { PullRequest } from "../shared/wire.ts";

const FIELDS = "url,number,title,state,isDraft,reviewDecision,statusCheckRollup,headRepositoryOwner,updatedAt";

interface RawPr {
  url: string;
  number: number;
  title: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  reviewDecision: string;
  statusCheckRollup?: Array<{ __typename?: string; status?: string; conclusion?: string; state?: string }>;
  headRepositoryOwner?: { login?: string };
  updatedAt?: string;
}

const gh = (args: string[]): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        execFile("gh", args, { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) reject(new Error(String(stderr || err.message).trim()));
          else resolve(stdout);
        });
      }),
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  });

function checksOf(rollup: RawPr["statusCheckRollup"]): PullRequest["checks"] {
  if (!rollup?.length) return "none";
  let pending = false;
  for (const c of rollup) {
    if (c.__typename === "StatusContext") {
      if (c.state === "FAILURE" || c.state === "ERROR") return "failure";
      if (c.state !== "SUCCESS") pending = true;
    } else {
      if (c.status !== "COMPLETED") pending = true;
      else if (c.conclusion && !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(c.conclusion)) return "failure";
    }
  }
  return pending ? "pending" : "success";
}

function toPullRequest(raw: RawPr): PullRequest {
  const m = raw.url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/);
  const review = raw.reviewDecision === "APPROVED" ? "approved" : raw.reviewDecision === "CHANGES_REQUESTED" ? "changes_requested" : raw.reviewDecision === "REVIEW_REQUIRED" ? "review_required" : "none";
  return {
    url: raw.url,
    repo: m?.[1] ?? "",
    number: raw.number,
    title: raw.title,
    state: raw.state === "MERGED" ? "merged" : raw.state === "CLOSED" ? "closed" : raw.isDraft ? "draft" : "open",
    checks: checksOf(raw.statusCheckRollup),
    review,
  };
}

const parse = (json: string): RawPr[] => {
  const v = JSON.parse(json) as RawPr | RawPr[];
  return Array.isArray(v) ? v : [v];
};

const byUrl = (url: string): Effect.Effect<PullRequest | undefined> =>
  gh(["pr", "view", url, "--json", FIELDS]).pipe(
    Effect.map((out) => toPullRequest(parse(out)[0])),
    Effect.orElseSucceed(() => undefined),
  );

const cache = new Map<string, { at: number; prs: PullRequest[] }>();
const TTL = 30_000;

export const lookupPullRequests = (urls: ReadonlyArray<string>): Effect.Effect<PullRequest[]> =>
  Effect.gen(function* () {
    const key = urls.join(" ");
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.prs;
    const mentioned = yield* Effect.forEach(urls, byUrl, { concurrency: 4 });
    const seen = new Set<string>();
    const prs: PullRequest[] = [];
    for (const pr of mentioned) {
      if (!pr || seen.has(pr.url)) continue;
      seen.add(pr.url);
      prs.push(pr);
    }
    cache.set(key, { at: Date.now(), prs });
    return prs;
  });
