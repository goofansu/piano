import type { SessionPullRequest, SessionPullRequestAction } from "@shared/wire";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { sessionPullRequest } from "@/lib/api";

/** Only the selected session is polled. Identity and request order fence late responses. */
export function useSessionPullRequest(workspaceId: string | undefined, sessionId: string | null | undefined, working: boolean) {
  // Snapshot identity: a response for another session never shows.
  const key = workspaceId && sessionId ? JSON.stringify([workspaceId, sessionId]) : null;
  const [snapshot, setSnapshot] = useState<{ key: string; value: SessionPullRequest }>();
  const [busy, setBusy] = useState(false);
  const active = useRef<{ controller: AbortController; mutation: boolean } | null>(null);
  const request = useCallback(async (action?: SessionPullRequestAction) => {
    if (!key || !workspaceId || !sessionId || (!action && active.current?.mutation)) return false;
    active.current?.controller.abort();
    const current = { controller: new AbortController(), mutation: !!action };
    active.current = current;
    // Reads refresh facts silently; only explicit changes block the controls.
    setBusy(current.mutation);
    try {
      const body = await sessionPullRequest(workspaceId, sessionId, action, { signal: current.controller.signal });
      if (active.current !== current) return false;
      setSnapshot({ key, value: body });
      if (action && body.error) toast.error(body.error);
      // A saved association can succeed even when its live GitHub status is unavailable.
      return body;
    } catch (error) {
      if (current.controller.signal.aborted || active.current !== current) return false;
      const message = error instanceof Error ? error.message : "Could not load the pull request.";
      if (action) toast.error(message);
      setSnapshot(previous => ({ key, value: {
        link: previous?.key === key ? previous.value.link : null,
        pullRequest: null,
        discovery: previous?.key === key ? previous.value.discovery : true,
        error: message,
      } }));
      return false;
    } finally {
      if (active.current === current) { active.current = null; setBusy(false); }
    }
  }, [key, workspaceId, sessionId]);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) void request(); }, 60_000);
    const focus = () => { void request(); };
    window.addEventListener("focus", focus);
    return () => { clearInterval(timer); window.removeEventListener("focus", focus); active.current?.controller.abort(); active.current = null; };
  }, [request]);
  useEffect(() => { void request(); }, [request, working]);
  return { value: snapshot?.key === key ? snapshot.value : undefined, busy, refresh: () => request(), change: request };
}
