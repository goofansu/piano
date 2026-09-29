import { useEffect, useMemo, useState } from "react";
import type { PullRequest, RenderMsg } from "@shared/wire";

const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;

/** GitHub PR URLs in the transcript, first mention first, without duplicates. */
export function pullRequestUrls(messages: RenderMsg[]): string[] {
  const seen = new Set<string>();
  for (const m of messages) for (const u of m.text.match(PR_URL) ?? []) seen.add(u);
  return [...seen];
}

/** The pull requests mentioned in the transcript, refreshed when it settles and every minute while shown. */
export function usePullRequests(urls: string[], settled: boolean): PullRequest[] {
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const key = useMemo(() => urls.join(" "), [urls]);
  useEffect(() => {
    if (urls.length === 0) {
      setPrs([]);
      return;
    }
    let live = true;
    const load = () =>
      fetch(`/api/prs?urls=${encodeURIComponent(urls.join(" "))}`)
        .then((r) => r.json() as Promise<{ prs?: PullRequest[] }>)
        .then((d) => live && setPrs(d.prs ?? []))
        .catch(() => {});
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, settled]);
  return prs;
}
