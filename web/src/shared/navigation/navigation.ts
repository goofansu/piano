import type { FilePreview } from "../../../../shared/workspace/files.ts";
import type { Page } from "../state/state.ts";
import type { SettingsSection } from "./routes.ts";
export type InspectorView = "changes";

export type InspectorTab = InspectorView | FileTab;

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

export const isView = (tab: InspectorTab): tab is InspectorView => typeof tab === "string";

export interface Inspector {
  tabs: InspectorTab[];
  active: string;
}

export const tabKey = (tab: InspectorView | FileLocation): string =>
  typeof tab === "string" ? tab : `file:${tab.path}`;

export const activeTab = (inspector: Inspector | null): InspectorTab | undefined =>
  inspector?.tabs.find((tab) => tabKey(tab) === inspector.active);

export type SessionArea = "agent" | "inspector";

export interface SessionLayout {
  single: boolean;
  agent: boolean;
  inspector: boolean;
  rail: boolean;
  agentTab: boolean;
}

export interface NavigationState {
  settings: SettingsSection | null;
  inspector: Inspector | null;
  rail: boolean;
  covered: boolean;
  area: SessionArea;
  inspectorRequest: number;
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
