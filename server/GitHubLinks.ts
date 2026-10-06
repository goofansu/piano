/**
 * Live status for the GitHub links a session mentions, through the `gh` CLI: pull
 * requests and issues by URL. Lookups are cached briefly; a machine without `gh`, or a
 * URL `gh` cannot resolve, simply yields nothing for that link.
 */
import { execFile } from "node:child_process";
import { Effect } from "effect";
import type { LinkStatus, PullRequest } from "../shared/wire.ts";

const PR_FIELDS = "url,number,title,state,isDraft,reviewDecision,statusCheckRollup";
const ISSUE_FIELDS = "url,number,title,state";

interface RawPr {
  url: string;
  number: number;
  title: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  reviewDecision: string;
  statusCheckRollup?: Array<{ __typename?: string; status?: string; conclusion?: string; state?: string }>;
}

interface RawIssue {
  url: string;
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
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

const repoOf = (url: string) => url.match(/github\.com\/([^/]+\/[^/]+)\//)?.[1] ?? "";

function toPullRequest(raw: RawPr): LinkStatus {
  const review = raw.reviewDecision === "APPROVED" ? "approved" : raw.reviewDecision === "CHANGES_REQUESTED" ? "changes_requested" : raw.reviewDecision === "REVIEW_REQUIRED" ? "review_required" : "none";
  return {
    _tag: "pull_request",
    url: raw.url,
    repo: repoOf(raw.url),
    number: raw.number,
    title: raw.title,
    state: raw.state === "MERGED" ? "merged" : raw.state === "CLOSED" ? "closed" : raw.isDraft ? "draft" : "open",
    checks: checksOf(raw.statusCheckRollup),
    review,
  };
}

const toIssue = (raw: RawIssue): LinkStatus => ({
  _tag: "issue",
  url: raw.url,
  repo: repoOf(raw.url),
  number: raw.number,
  title: raw.title,
  state: raw.state === "CLOSED" ? "closed" : "open",
});

const first = <T>(json: string): T => {
  const v = JSON.parse(json) as T | T[];
  return Array.isArray(v) ? v[0] : v;
};

const byUrl = (url: string): Effect.Effect<LinkStatus | undefined> =>
  (/\/pull\/\d+$/.test(url)
    ? gh(["pr", "view", url, "--json", PR_FIELDS]).pipe(Effect.map((out) => toPullRequest(first<RawPr>(out))))
    : gh(["issue", "view", url, "--json", ISSUE_FIELDS]).pipe(Effect.map((out) => toIssue(first<RawIssue>(out))))
  ).pipe(Effect.orElseSucceed(() => undefined));

const cache = new Map<string, { at: number; links: LinkStatus[] }>();
const TTL = 30_000;

export const lookupGitHubLinks = (urls: ReadonlyArray<string>): Effect.Effect<LinkStatus[]> =>
  Effect.gen(function* () {
    const key = urls.join(" ");
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.links;
    const found = yield* Effect.forEach(urls, byUrl, { concurrency: 4 });
    const seen = new Set<string>();
    const links: LinkStatus[] = [];
    for (const link of found) {
      if (!link || seen.has(link.url)) continue;
      seen.add(link.url);
      links.push(link);
    }
    cache.set(key, { at: Date.now(), links });
    return links;
  });
