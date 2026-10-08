import type { SessionPullRequest, SessionPullRequestAction } from "@shared/wire";
import { useCallback, useEffect, useRef, useState } from "react";

/** Only the selected session is polled. Identity and request order fence late responses. */
export function useSessionPullRequest(workspaceId: string | undefined, sessionId: string | null | undefined, working: boolean) {
  const url = workspaceId && sessionId ? `/api/session/pull-request?${new URLSearchParams({ workspaceId, sessionId })}` : null;
  const [snapshot, setSnapshot] = useState<{ url: string; value: SessionPullRequest }>();
  const [busy, setBusy] = useState(false);
  const active = useRef<{ controller: AbortController; mutation: boolean } | null>(null);
  const request = useCallback(async (action?: SessionPullRequestAction) => {
    if (!url || (!action && active.current?.mutation)) return false;
    active.current?.controller.abort();
    const current = { controller: new AbortController(), mutation: !!action };
    active.current = current;
    setBusy(true);
    try {
      const response = await fetch(url, { signal: current.controller.signal, cache: "no-store",
        ...(action ? { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(action) } : {}) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load the pull request.");
      if (active.current !== current) return false;
      setSnapshot({ url, value: body as SessionPullRequest });
      // A saved association can succeed even when its live GitHub status is unavailable.
      return true;
    } catch (error) {
      if (current.controller.signal.aborted || active.current !== current) return false;
      setSnapshot(previous => ({ url, value: {
        link: previous?.url === url ? previous.value.link : null,
        pullRequest: null,
        discovery: previous?.url === url ? previous.value.discovery : true,
        error: error instanceof Error ? error.message : "Could not load the pull request.",
      } }));
      return false;
    } finally {
      if (active.current === current) { active.current = null; setBusy(false); }
    }
  }, [url]);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) void request(); }, 60_000);
    const focus = () => { void request(); };
    window.addEventListener("focus", focus);
    return () => { clearInterval(timer); window.removeEventListener("focus", focus); active.current?.controller.abort(); active.current = null; };
  }, [request]);
  useEffect(() => { void request(); }, [request, working]);
  return { value: snapshot?.url === url ? snapshot.value : undefined, busy, refresh: () => request(), change: request };
}
