import type { SessionPullRequestLink } from "@shared/wire";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { sessionPullRequest } from "@/lib/api";
import { pullRequestTrigger } from "@/lib/changesView";
import type { PullRequestTarget } from "@/lib/sessionContext";
import { createSessionPullRequest, pullRequestKey } from "@/lib/sessionPullRequest";

export function useSessionPullRequest(
  target: PullRequestTarget | undefined,
  link: SessionPullRequestLink | null | undefined,
  working: boolean,
  {
    visible,
    dialog,
    changeable,
  }: {
    visible: boolean;
    dialog: { open: boolean; onOpenChange: (open: boolean) => void };
    changeable: boolean;
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
  const url = link?.url,
    source = link?.source,
    apiHost = link?.apiHost,
    removed = link === null;
  const registered = useMemo(
    () => (removed ? null : url && source ? { url, source, apiHost } : undefined),
    [url, source, apiHost, removed],
  );
  useEffect(() => pr.start(), [pr]);
  const workspaceId = target?.workspaceId,
    sessionId = target?.sessionId;
  useEffect(
    () => pr.observe(workspaceId, sessionId, registered, working, { visible, dialog: dialog.open }),
    [pr, workspaceId, sessionId, registered, working, visible, dialog.open],
  );
  const state = useSyncExternalStore(pr.subscribe, pr.getState);
  const current = state.key === pullRequestKey(workspaceId, sessionId);
  return {
    changeable: !!target && changeable,
    value: current ? state.value : undefined,
    linked: current && state.linked,
    registered: current ? state.link : undefined,
    changesTrigger: pullRequestTrigger(link),
    loading: current && state.loading,
    busy: current && state.busy,
    finding: current && state.finding,
    surface: current ? state.surface : "closed",
    open: () => dialog.onOpenChange(true),
    cancel: () => dialog.onOpenChange(false),
    link: pr.link,
    discover: pr.discover,
    remove: pr.remove,
  };
}
