import type { AppState, Page } from "./state.ts";

export type StartPage = Extract<Page, { kind: "new" | "project" }>;

export function startPage(view: AppState["view"]): StartPage | undefined {
  return view.kind === "new" || view.kind === "project" ? view : undefined;
}
