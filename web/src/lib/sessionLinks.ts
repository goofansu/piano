import { useCallback, useEffect, useMemo, useState } from "react";
import type { LinkStatus, RenderMsg } from "@shared/wire";
import { type SessionLink, sessionLinks, statusUrls, withStatus } from "@/lib/links";

/** Links marked done stay out of the pile for this session, on this browser. */
const doneKey = (cwd: string, sessionId: string | null) => `piano.links.done:${cwd}:${sessionId ?? "new"}`;

function readDone(key: string): string[] {
  if (!key) return [];
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeDone(key: string, urls: string[]) {
  try {
    if (urls.length) localStorage.setItem(key, JSON.stringify(urls));
    else localStorage.removeItem(key);
  } catch {
    /* a private window or blocked storage only forgets dismissals */
  }
}

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
 * The session's set-aside links: what the transcript mentions, minus what the reader marked
 * done, with live status where the server has it. `markDone` is the pile's "Done" action
 * and `restore` its undo.
 */
export function useSessionLinks(session: { cwd: string; sessionId: string | null; messages: ReadonlyArray<RenderMsg> } | null, settled: boolean) {
  const key = session ? doneKey(session.cwd, session.sessionId) : "";
  // Dismissals belong to one session; another session's key reads its own list during render.
  const [stored, setStored] = useState(() => ({ key, urls: readDone(key) }));
  const done = useMemo(() => (stored.key === key ? stored.urls : readDone(key)), [stored, key]);
  const messages = session?.messages;
  const mentioned = useMemo(() => (messages ? sessionLinks(messages) : []), [messages]);
  const shown = useMemo(() => mentioned.filter((l) => !done.includes(l.url)), [mentioned, done]);
  const statuses = useLinkStatus(useMemo(() => statusUrls(shown), [shown]), settled);
  const links: SessionLink[] = useMemo(() => withStatus(shown, statuses), [shown, statuses]);
  const update = useCallback((next: (urls: string[]) => string[]) => setStored((s) => {
    const urls = next(s.key === key ? s.urls : readDone(key));
    writeDone(key, urls);
    return { key, urls };
  }), [key]);
  const markDone = useCallback((url: string) => update((urls) => (urls.includes(url) ? urls : [...urls, url])), [update]);
  const restore = useCallback((url: string) => update((urls) => urls.filter((u) => u !== url)), [update]);
  return { links, markDone, restore };
}
