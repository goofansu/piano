// Relative, not @/: module tests load this file directly in Node.
import type { AppState } from "../store.ts";
import { folderFor, sessionReference } from "./sessionContext.ts";
import type { GroupBy } from "./sidebarView.ts";

/**
 * Which sidebar groups are open. Folder groups are keyed by path and project groups by
 * `projectKey`, in one set. `revealed` and `projects` remember what the policy has already acted
 * on, so repeating an event (as every registry refresh does) changes nothing.
 */
export interface OpenGroups {
  readonly open: ReadonlySet<string>;
  /** The last selection, grouping and owning group revealed. */
  readonly revealed: string | null;
  /** Project ids already seen once the registry loaded; null before then. */
  readonly projects: ReadonlySet<string> | null;
}

export type OpenGroupsEvent =
  /** The user opened or collapsed a group. */
  | { type: "toggle"; key: string; open: boolean }
  /** The selected session, the grouping or the group owning the selection, as of this render. */
  | {
      type: "owner";
      cwd: string;
      sessionId: string | null;
      groupBy: GroupBy;
      key: string | undefined;
    }
  /** The registry's project ids, once loaded. */
  | { type: "projects"; ids: readonly string[] };

/** Project groups share the open set with folders, keyed apart from paths; the empty id is the No project group. */
export const projectKey = (id: string) => `project:${id}`;

export const initialOpenGroups = (open: Iterable<string>): OpenGroups => ({
  open: new Set(open),
  revealed: null,
  projects: null,
});

/** The group holding a session: pinned sessions live only in Pinned, never in their folder/project group. */
export function ownerGroupKey(
  state: AppState,
  session: { cwd: string; sessionId: string | null },
  groupBy: GroupBy,
): string | undefined {
  const member = session.sessionId
    ? sessionReference(state, { cwd: session.cwd, sessionId: session.sessionId })
    : undefined;
  if (member?.pinned) return undefined;
  if (groupBy === "folder") return folderFor(state, session.cwd)?.path;
  if (groupBy !== "project") return undefined;
  return projectKey(member?.projectId ?? "");
}

const withOpen = (groups: OpenGroups, keys: readonly string[]): ReadonlySet<string> => {
  const missing = keys.filter((k) => !groups.open.has(k));
  return missing.length === 0 ? groups.open : new Set([...groups.open, ...missing]);
};

/**
 * The sidebar's open-group policy. A user toggle is kept. A new selection, grouping or owning group
 * opens the owning group; the same one again does not, so a registry refresh never undoes a
 * collapse. A project that appears after the registry loaded opens, so a session just filed in it
 * is in sight. Returns `prev` itself when nothing changes.
 */
export function nextOpenGroups(prev: OpenGroups, event: OpenGroupsEvent): OpenGroups {
  switch (event.type) {
    case "toggle": {
      if (prev.open.has(event.key) === event.open) return prev;
      const open = new Set(prev.open);
      if (event.open) open.add(event.key);
      else open.delete(event.key);
      return { ...prev, open };
    }
    case "owner": {
      if (!event.key) return prev;
      const target = JSON.stringify([event.cwd, event.sessionId, event.groupBy, event.key]);
      if (prev.revealed === target) return prev;
      return { ...prev, revealed: target, open: withOpen(prev, [event.key]) };
    }
    case "projects": {
      const seen = prev.projects;
      if (seen && event.ids.length === seen.size && event.ids.every((id) => seen.has(id)))
        return prev;
      const added = seen ? event.ids.filter((id) => !seen.has(id)).map(projectKey) : [];
      return { ...prev, projects: new Set(event.ids), open: withOpen(prev, added) };
    }
  }
}
