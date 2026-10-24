/**
 * Which view starts sessions, and where: the New page and a project's home each hold the directory
 * a session started there runs in, and the project it joins. Store, client, composer and focused
 * directory ask this instead of each restating which pages those are.
 */
import type { AppState, Page } from "../store.ts";

/** A page whose composer starts a session: the New page (a project's when `projectId` is set) or a project's home. */
export type StartPage = Extract<Page, { kind: "new" | "project" }>;

/** The view as a page that starts sessions, else undefined. */
export function startPage(view: AppState["view"]): StartPage | undefined {
  return view.kind === "new" || view.kind === "project" ? view : undefined;
}
