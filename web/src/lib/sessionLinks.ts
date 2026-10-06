import { useEffect, useMemo, useState } from "react";
import type { LinkStatus, RenderMsg } from "@shared/wire";
import { type SessionLink, sessionLinks, statusUrls, withStatus } from "@/lib/links";

/** Live status for the links the server can look up, refreshed when the turn settles and every minute while shown. */
function useLinkStatus(urls: string[], settled: boolean): LinkStatus[] {
  const [statuses, setStatuses] = useState<LinkStatus[]>([]);
  const key = urls.join(" ");
  useEffect(() => {
    if (!key) return;
    let live = true;
    const load = () =>
      fetch(`/api/links?urls=${encodeURIComponent(key)}`)
        .then((r) => r.json() as Promise<{ links?: LinkStatus[] }>)
        .then((d) => live && setStatuses(d.links ?? []))
        .catch(() => {});
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [key, settled]);
  return key ? statuses : [];
}

/**
 * The session's set-aside links: what the transcript mentions, with live status where the
 * server has it. Nothing is stored; the transcript is the only source.
 */
export function useSessionLinks(messages: ReadonlyArray<RenderMsg> | undefined, settled: boolean): SessionLink[] {
  const mentioned = useMemo(() => (messages ? sessionLinks(messages) : []), [messages]);
  const statuses = useLinkStatus(useMemo(() => statusUrls(mentioned), [mentioned]), settled);
  return useMemo(() => withStatus(mentioned, statuses), [mentioned, statuses]);
}
