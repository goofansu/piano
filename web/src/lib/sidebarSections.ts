/**
 * What the sidebar's session list shows under the chosen view: the Pinned section, then one body
 * for the grouping, a loading placeholder before the registry arrives, or the empty-state text.
 * Pure, so the Sidebar only renders the sections and keeps its timers, animation and disclosure.
 */
import type { FolderView, Project } from "@shared/wire";
import type { AppState } from "../store.ts";
import { activeProjects } from "./projectCommands.ts";
import { type SessionEntry, sessionCatalog } from "./sessionCatalog.ts";
import {
  dateGroups,
  folderGroups,
  projectGroups,
  type SessionGroup,
  type SidebarView,
  sortSessions,
} from "./sidebarView.ts";

export type SidebarBody =
  | { kind: "loading" }
  | { kind: "empty"; text: string }
  | { kind: "folders"; groups: Array<{ folder: FolderView; sessions: SessionEntry[] }> }
  /** Active projects in order, then always the No project group (`project: null`). */
  | { kind: "projects"; groups: Array<SessionGroup<Project, SessionEntry>> }
  | { kind: "dates"; groups: Array<{ label: string; sessions: SessionEntry[] }> }
  | { kind: "list"; sessions: SessionEntry[] };

export interface SidebarSections {
  /** Pinned sessions in the chosen order, wherever their folder is; empty until the registry arrives. */
  pinned: SessionEntry[];
  /** Null when pinned rows stand in for the empty state, so nothing shows below them. */
  body: SidebarBody | null;
}

const NO_FOLDERS = "No folders yet. Start a session in any folder and it appears here.";
const NO_SESSIONS = "No sessions yet. Start one and it appears here.";

/**
 * One catalog for every grouping, so switching the grouping never changes which sessions are
 * listed. A pinned session shows only under Pinned; the groupings take the listed rest.
 * `now` places sessions in date groups.
 */
export function sidebarSections(state: AppState, view: SidebarView, now: Date): SidebarSections {
  if (!state.registryLoaded) return { pinned: [], body: { kind: "loading" } };
  const catalog = sessionCatalog(state);
  const pinned = sortSessions(
    catalog.filter((s) => s.pinned),
    view.sortBy,
  );
  const listed = catalog.filter((s) => s.listed && !s.pinned);
  const body = (b: SidebarBody): SidebarSections => ({
    pinned,
    body: b.kind === "empty" && pinned.length > 0 ? null : b,
  });
  const empty = (text: string) => body({ kind: "empty", text });

  switch (view.groupBy) {
    case "folder":
      if (state.folders.length === 0) return empty(NO_FOLDERS);
      return body({ kind: "folders", groups: folderGroups(state.folders, listed, view.sortBy) });
    case "project": {
      // Archived projects are not listed; a place for archived projects and sessions is still to be designed.
      const active = activeProjects(state);
      const groups = projectGroups(active, listed, view.sortBy);
      if (active.length === 0 && groups.every((g) => g.sessions.length === 0))
        return empty(NO_SESSIONS);
      return body({ kind: "projects", groups });
    }
    case "date": {
      const groups = dateGroups(listed, view.sortBy, now);
      if (groups.length === 0) return empty(NO_SESSIONS);
      return body({ kind: "dates", groups });
    }
    default: {
      // No grouping; a stored view is not validated, so an unknown grouping lists the same way.
      const sessions = sortSessions(listed, view.sortBy);
      if (sessions.length === 0) return empty(NO_SESSIONS);
      return body({ kind: "list", sessions });
    }
  }
}
