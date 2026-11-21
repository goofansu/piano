import type { ClientCommand, Project } from "../../../../shared/wire.ts";

type SessionRef = { cwd: string; sessionId: string };

export type ProjectDialog = { assign?: SessionRef; newPage?: true };

export type ProjectCommandId =
  | "new-session"
  | "open-project"
  | "settings"
  | "done"
  | "delete"
  | "new-project"
  | "assign";

export type ProjectCommandIcon =
  | "new"
  | "create"
  | "settings"
  | "done"
  | "reopen"
  | "delete"
  | "project"
  | "remove";

export type ProjectCommandIntent =
  | { kind: "open-project"; projectId: string }
  | { kind: "project-settings"; projectId: string }
  | { kind: "project-dialog"; dialog: ProjectDialog }
  | { kind: "delete-project"; project: Project }
  | { kind: "send"; command: ClientCommand };

export interface ProjectCommand {
  id: ProjectCommandId;
  label: string;
  ariaLabel?: string;
  icon: ProjectCommandIcon;
  enabled: boolean;
  destructive?: true;
  intent: ProjectCommandIntent;
}

export interface ProjectDestination {
  project: Project;
  command: ProjectCommand;
}

export interface SessionProjectMenu {
  current: Project | undefined;
  open: ProjectCommand | undefined;
  entry: { label: "Move to project" | "Add to project"; enabled: boolean };
  create: ProjectCommand | undefined;
  destinations: ProjectDestination[];
  remove: ProjectCommand | undefined;
}
