import type { SessionPullRequestLink } from "@shared/wire";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { sessionPullRequest } from "@/lib/api";
import { pullRequestTrigger } from "@/lib/changesView";
import { createSessionPullRequest, pullRequestKey } from "@/lib/sessionPullRequest";

/**
 * Only the selected session is observed, and only while the registry links it (`link` is the
 * catalog's). The module owns freshness, focus/work refreshes and polling of visible active PR
 * details; this hook passes the session snapshot and what is on screen without deciding that
 * policy. The details are the row under the Changes toolbar, so they show while Changes does
 * (`visible`); navigation owns whether the link dialog is open, and the link may close it.
 */
export function useSessionPullRequest(
  workspaceId: string | undefined,
  sessionId: string | null | undefined,
  link: SessionPullRequestLink | null | undefined,
  working: boolean,
  {
    visible,
    dialog,
  }: {
    /** Changes is on screen for this session, where the pull request row shows. */
    visible: boolean;
    /** The link dialog: linking one, or changing the saved link. */
    dialog: { open: boolean; onOpenChange: (open: boolean) => void };
  },
) {
  const latest = useRef(dialog);
  latest.current = dialog;
  const [pr] = useState(() =>
    createSessionPullRequest({
      api: sessionPullRequest,
      notify: {
        error: (message) => toast.error(message),
        info: (message) => toast(message),
        success: (message) => toast.success(message),
      },
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
    () => pr.observe(workspaceId, sessionId, registered, working, { visible, dialog: dialog.open }),
    [pr, workspaceId, sessionId, registered, working, visible, dialog.open],
  );
  const state = useSyncExternalStore(pr.subscribe, pr.getState);
  // Only the current session's value, even in the render in which the session changes (INV-07).
  const current = state.key === pullRequestKey(workspaceId, sessionId);
  return {
    value: current ? state.value : undefined,
    linked: current && state.linked,
    registered: current ? state.link : undefined,
    /** Changes reads again when this moves: the registry's link as Changes compares by it. */
    changesTrigger: pullRequestTrigger(link),
    loading: current && state.loading,
    busy: current && state.busy,
    finding: current && state.finding,
    surface: current ? state.surface : "closed",
    /** Opens the link dialog: to link one, or to change the saved link. */
    open: () => dialog.onOpenChange(true),
    /** Leaves the dialog; a changed link stays as it was. */
    cancel: () => dialog.onOpenChange(false),
    link: pr.link,
    discover: pr.discover,
    remove: pr.remove,
  };
}
