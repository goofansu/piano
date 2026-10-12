import { useCallback, useEffect, useState } from "react";
import {
  initialOpenGroups,
  nextOpenGroups,
  type OpenGroupsEvent,
  ownerGroupKey,
} from "@/lib/sidebarGroups";
import type { GroupBy } from "@/lib/sidebarView";
import { readJson, writeJson } from "@/lib/storage";
import type { AppState } from "@/store";

/** Remembered per browser, like the sidebar's grouping. */
const KEY = "piano.openProjects";

/** The sidebar's open groups: `nextOpenGroups` fed by the selection, the registry and user toggles. */
export function useSidebarGroups(state: AppState, groupBy: GroupBy) {
  const [groups, setGroups] = useState(() => initialOpenGroups(readJson<string[]>(KEY, [])));
  const dispatch = useCallback(
    (event: OpenGroupsEvent) =>
      setGroups((prev) => {
        const next = nextOpenGroups(prev, event);
        if (next.open !== prev.open) writeJson(KEY, [...next.open]);
        return next;
      }),
    [],
  );

  const current = state.session ?? state.selecting;
  const cwd = current?.cwd;
  const sessionId = current?.sessionId ?? null;
  const key = cwd === undefined ? undefined : ownerGroupKey(state, { cwd, sessionId }, groupBy);
  useEffect(() => {
    if (cwd !== undefined) dispatch({ type: "owner", cwd, sessionId, groupBy, key });
  }, [dispatch, cwd, sessionId, groupBy, key]);

  useEffect(() => {
    if (state.registryLoaded) dispatch({ type: "projects", ids: state.projects.map((p) => p.id) });
  }, [dispatch, state.registryLoaded, state.projects]);

  const setOpen = useCallback(
    (key: string, open: boolean) => dispatch({ type: "toggle", key, open }),
    [dispatch],
  );
  return { openGroups: groups.open, setOpen };
}
