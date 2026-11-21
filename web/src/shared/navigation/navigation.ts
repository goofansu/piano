import type { FilePreview } from "../../../../shared/workspace/files.ts";
import type { Page } from "../state/state.ts";
import type { SettingsSection } from "./routes.ts";
export type SurfaceView = "changes";

export type SurfaceTab = SurfaceView | FileTab;

export type FileLocation = { kind: "file"; path: string; from: SessionArea };

export interface FileTab extends FileLocation {
  key: number;
  workspaceId: string | undefined;
  requested: string;
  aliases: readonly string[];
  pending: boolean;
  result?: FilePreview;
  status: string;
}

export const isView = (tab: SurfaceTab): tab is SurfaceView => typeof tab === "string";

export interface Surface {
  tabs: SurfaceTab[];
  active: string;
}

export const tabKey = (tab: SurfaceView | FileLocation): string =>
  typeof tab === "string" ? tab : `file:${tab.path}`;

export const activeTab = (surface: Surface | null): SurfaceTab | undefined =>
  surface?.tabs.find((tab) => tabKey(tab) === surface.active);

export type SessionArea = "agent" | "surface";

export interface SessionLayout {
  single: boolean;
  agent: boolean;
  surface: boolean;
  rail: boolean;
  agentTab: boolean;
}

export interface NavigationState {
  settings: SettingsSection | null;
  surface: Surface | null;
  rail: boolean;
  covered: boolean;
  area: SessionArea;
  surfaceRequest: number;
  single: boolean;
  layout: SessionLayout;
  shownTab: string | null;
  pullRequest: boolean;
  palette: boolean;
}

export interface Navigation {
  getState: () => NavigationState;
  subscribe: (listener: () => void) => () => void;
  start: () => () => void;
  select: (cwd: string, sessionId: string | null) => void;
  openPage: (page: Page) => void;
  openNew: (cwd?: string, projectId?: string) => void;
  openProjects: () => void;
  openProject: (projectId: string) => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  openChanges: () => void;
  toggleRail: () => void;
  openFile: (path: string, from?: SessionArea) => void;
  selectTab: (key: string) => void;
  closeTab: (key: string) => void;
  showAgent: () => void;
  setSingle: (single: boolean) => void;
  openPullRequest: () => void;
  closePullRequest: () => void;
  setPalette: (open: boolean) => void;
}
