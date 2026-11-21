import { findProject } from "../lib/projects.ts";
import { unavailableSessionTitle } from "../state/sessionCatalog.ts";
import type { AppState, Page } from "../state/state.ts";
import { type Route, routePath } from "./routes.ts";
export function pageAddress(state: AppState, page: Page): { route: Route; title: string } {
  switch (page.kind) {
    case "new":
      return {
        route: { kind: "new", projectId: page.projectId },
        title: findProject(state, page.projectId)?.name || "New session",
      };
    case "projects":
      return { route: { kind: "projects" }, title: "Projects" };
    case "project":
      return {
        route: { kind: "project", projectId: page.projectId },
        title: findProject(state, page.projectId)?.name || "Project",
      };
    case "missing-session":
      return {
        route: { kind: "session", sessionId: page.sessionId },
        title: unavailableSessionTitle(page.reason),
      };
  }
}

export type SessionPane =
  | { kind: "session"; sessionId: string }
  | { kind: "creating" }
  | { kind: "failed"; sessionId: string }
  | { kind: "unresolved" };

export function sessionPane(state: AppState): SessionPane {
  const sessionId = (state.session ?? state.selecting)?.sessionId;
  if (sessionId) return { kind: "session", sessionId };
  if (state.selecting || state.pendingCreate) return { kind: "creating" };
  const failed = state.selectionFailure?.sessionId;
  return failed ? { kind: "failed", sessionId: failed } : { kind: "unresolved" };
}

export function screenKey(state: AppState): string {
  if (state.view.kind !== "session") return routePath(pageAddress(state, state.view).route);
  const pane = sessionPane(state);
  return "sessionId" in pane ? `${pane.kind}:${pane.sessionId}` : pane.kind;
}
