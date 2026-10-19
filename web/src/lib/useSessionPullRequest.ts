import type { SessionPullRequestLink } from "@shared/wire";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { sessionPullRequest } from "@/lib/api";
import { createSessionPullRequest, pullRequestKey } from "@/lib/sessionPullRequest";

/**
 * Only the selected session is observed, and only while the registry links it (`link` is the
 * catalog's): on selection, focus, a minute's interval and when its work starts or stops.
 * Navigation owns whether the panel is open; the link decides what it shows and may close it.
 */
export function useSessionPullRequest(
  workspaceId: string | undefined,
  sessionId: string | null | undefined,
  link: SessionPullRequestLink | null | undefined,
  working: boolean,
  panel: { open: boolean; onOpenChange: (open: boolean) => void },
) {
  const latest = useRef(panel);
  latest.current = panel;
  const [pr] = useState(() =>
    createSessionPullRequest({
      api: sessionPullRequest,
      notify: { error: (message) => toast.error(message), info: (message) => toast(message) },
      closed: () => {
        if (latest.current.open) latest.current.onOpenChange(false);
      },
    }),
  );
  // The catalog republishes an unchanged link as a new object; follow the link, not the object.
  const url = link?.url,
    source = link?.source,
    apiHost = link?.apiHost,
    removed = link === null;
  const registered = useMemo(
    () => (removed ? null : url && source ? { url, source, apiHost } : undefined),
    [url, source, apiHost, removed],
  );
  useEffect(() => pr.start(), [pr]);
  useEffect(
    () => pr.observe(workspaceId, sessionId, registered),
    [pr, workspaceId, sessionId, registered],
  );
  const seen = useRef(working);
  useEffect(() => {
    if (seen.current === working) return;
    seen.current = working;
    pr.activity(working);
  }, [pr, working]);
  useEffect(() => (panel.open ? pr.open() : pr.close()), [pr, panel.open]);
  const state = useSyncExternalStore(pr.subscribe, pr.getState);
  // Only the current session's value, even in the render in which the session changes (INV-07).
  const current = state.key === pullRequestKey(workspaceId, sessionId);
  return {
    value: current ? state.value : undefined,
    busy: current && state.busy,
    finding: current && state.finding,
    surface: current && panel.open ? state.surface : "closed",
    open: () => panel.onOpenChange(true),
    close: () => panel.onOpenChange(false),
    edit: pr.edit,
    cancel: pr.cancel,
    link: pr.link,
    discover: pr.discover,
    remove: pr.remove,
  };
}
