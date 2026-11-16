import { type ClientCommand, SESSION_TITLE_MAX, type ServerMessage } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";
import type { CommandForm } from "./commands.ts";
import { screenKey } from "./navigation.ts";
import {
  checkProjectDraft,
  EMPTY_PROJECT_DRAFT,
  findProject,
  type ProjectDraft,
  type ProjectDraftCheck,
  projectSettingsSave,
} from "./projectCommands.ts";
import { inSidebarGroups, sessionCatalog, sessionLabel } from "./sessionCatalog.ts";
import { canRenameSession } from "./sessionCommands.ts";
import { sessionMutable, sessionReady, sessionWorking } from "./sessionContext.ts";
import { previewClaimHolds, sessionHasPreview, stopPreview } from "./sessionPreview.ts";
import type { SendDisposition } from "./ws.ts";

export type FormAnswer = {
  projectCheck?: ProjectDraftCheck;
} & (
  | { allowed: false }
  | {
      allowed: true;
      command: ClientCommand;
      open?: FormPage;
    }
);

export type FormPage =
  | { kind: "project"; projectId: string }
  | { kind: "new"; projectId: string }
  | { kind: "projects" };

export interface AnswerContext {
  newId?: () => string;
  opened?: ProjectDraft;
}

export function answerForm(
  state: AppState,
  form: CommandForm,
  input: string | ProjectDraft = "",
  { newId = () => crypto.randomUUID(), opened }: AnswerContext = {},
): FormAnswer {
  const text = typeof input === "string" ? input : "";
  switch (form.kind) {
    case "stop-preview": {
      if (!sessionReady(state) || !previewClaimHolds(state, form)) return { allowed: false };
      return { allowed: true, command: stopPreview(form) };
    }
    case "rename-session": {
      const { target } = form;
      const title = text.trim();
      if (
        !canRenameSession(state, target) ||
        !title ||
        title.length > SESSION_TITLE_MAX ||
        title === (target.title ?? "")
      )
        return { allowed: false };
      const { cwd, sessionId } = target;
      return { allowed: true, command: { _tag: "rename_session", cwd, sessionId, title } };
    }
    case "archive-session":
    case "delete-session": {
      const { cwd, sessionId } = form.target;
      if (!sessionMutable(state, form.target)) return { allowed: false };
      return {
        allowed: true,
        command: {
          _tag: form.kind === "archive-session" ? "archive_session" : "delete_session",
          cwd,
          sessionId,
        },
      };
    }
    case "close-folder":
      if (!state.connected) return { allowed: false };
      return { allowed: true, command: { _tag: "remove_folder", path: form.folder.path } };
    case "delete-project":
      if (!state.connected) return { allowed: false };
      return {
        allowed: true,
        command: { _tag: "delete_project", id: form.project.id },
        ...("projectId" in state.view && state.view.projectId === form.project.id
          ? { open: { kind: "projects" } }
          : {}),
      };
    case "project": {
      const { assign, newPage } = form.dialog;
      const saved = typeof input === "string" ? undefined : checkProjectDraft(input).saved;
      if (!state.connected || !saved) return { allowed: false };
      const { name, instructions } = saved;
      const id = newId();
      return {
        allowed: true,
        command: {
          _tag: "save_project",
          project: { id, name, ...(instructions ? { instructions } : {}) },
          assign: assign && { cwd: assign.cwd, sessionId: assign.sessionId },
        },
        ...(!assign
          ? { open: newPage ? { kind: "new", projectId: id } : { kind: "project", projectId: id } }
          : {}),
      };
    }
    case "project-settings": {
      if (typeof input === "string") return { allowed: false };
      return projectSettingsSave(state, form.projectId, input, opened);
    }
  }
}

export interface Confirmation {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
}

export function confirmation(state: AppState, form: CommandForm): Confirmation | undefined {
  switch (form.kind) {
    case "stop-preview":
      return {
        title: "Stop preview?",
        description: `This will stop ${form.host}. The session stays available.`,
        confirmLabel: "Stop preview",
        destructive: true,
      };
    case "archive-session": {
      const title = sessionLabel(form.target.title);
      const preview = sessionHasPreview(state, form.target);
      const stop =
        preview && !sessionWorking(state, form.target)
          ? `the app "${title}" started`
          : `any work still running in "${title}"${preview ? " and the app it started" : ""}`;
      return {
        title: "Stop and archive this session?",
        description: `This will stop ${stop} and remove ${preview ? "the session" : "it"} from the sidebar. Its transcript will be kept. Changes already made to files will not be undone.`,
        confirmLabel: "Stop and archive",
        destructive: false,
      };
    }
    case "delete-session": {
      const working = sessionWorking(state, form.target);
      const preview = sessionHasPreview(state, form.target);
      const stop = working
        ? `This will stop the session and interrupt its current work${preview ? ", and stop the app it started" : ""}. `
        : preview
          ? "This will stop the app the session started. "
          : "";
      return {
        title: "Delete session?",
        description: `${stop}"${sessionLabel(form.target.title)}" and its transcript are removed from Pi's session store. This cannot be undone.`,
        confirmLabel: working || preview ? "Stop and delete" : "Delete",
        destructive: true,
      };
    }
    case "close-folder":
      return {
        title: "Close this folder?",
        description: `"${form.folder.name}" will be removed from the sidebar. Files and session history will not be deleted.`,
        confirmLabel: "Close",
        destructive: false,
      };
    case "delete-project": {
      const { id } = form.project;
      const count = sessionCatalog({
        ...state,
        projects: state.projects.filter((p) => p.id !== id),
      }).filter((s) => s.projectId === id && inSidebarGroups(s)).length;
      const moved =
        count === 0
          ? ""
          : count === 1
            ? "; its session moves to No project"
            : `; its ${count} sessions move to No project`;
      return {
        title: "Delete project?",
        description: `"${form.project.name}" is deleted${moved}. This cannot be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      };
    }
    case "rename-session":
    case "project":
    case "project-settings":
      return undefined;
  }
}

export interface CommandFormsState {
  form: CommandForm | null;
  text: string;
  projectDraft: ProjectDraft;
}

export interface CommandFormsOptions {
  getState: () => AppState;
  send: (command: ClientCommand) => SendDisposition;
  openPage: (page: FormPage) => void;
  newId?: () => string;
}

export interface CommandForms {
  getState: () => CommandFormsState;
  subscribe: (listener: () => void) => () => void;
  answer: () => FormAnswer;
  open: (form: CommandForm) => void;
  edit: (text: string) => void;
  editProject: (draft: ProjectDraft) => void;
  submit: () => boolean;
  cancel: () => void;
  settle: () => void;
  hear: (message: ServerMessage) => void;
}

const editsProject = (form: CommandForm) =>
  form.kind === "project" || form.kind === "project-settings";

export const FORM_NOT_SENT = "Change not sent. Retry when Piano reconnects.";

const confirmedIn = (state: AppState, command: ClientCommand) =>
  command._tag === "save_project"
    ? !!findProject(state, command.project.id)
    : command._tag === "delete_project"
      ? !findProject(state, command.id)
      : true;

const CLOSED: CommandFormsState = {
  form: null,
  text: "",
  projectDraft: EMPTY_PROJECT_DRAFT,
};

export function createCommandForms({
  getState,
  send,
  openPage,
  newId,
}: CommandFormsOptions): CommandForms {
  let state = CLOSED;
  let opened: ProjectDraft | undefined;
  let waiting: { page: FormPage; command: ClientCommand; from: string } | null = null;
  const screen = () => screenKey(getState());
  const listeners = new Set<() => void>();
  const set = (next: CommandFormsState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const savedDraft = (projectId: string): ProjectDraft => {
    const project = findProject(getState(), projectId);
    return project
      ? { name: project.name, instructions: project.instructions ?? "" }
      : EMPTY_PROJECT_DRAFT;
  };
  const answer = (): FormAnswer =>
    state.form
      ? answerForm(
          getState(),
          state.form,
          editsProject(state.form) ? state.projectDraft : state.text,
          { newId, opened },
        )
      : { allowed: false };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    answer,
    open: (form) => {
      opened = form.kind === "project-settings" ? savedDraft(form.projectId) : undefined;
      set({
        form,
        text: form.kind === "rename-session" ? (form.target.title ?? "") : "",
        projectDraft: opened ?? EMPTY_PROJECT_DRAFT,
      });
    },
    edit: (text) => {
      if (state.form?.kind === "rename-session") set({ ...state, text });
    },
    editProject: (projectDraft) => {
      if (state.form && editsProject(state.form)) set({ ...state, projectDraft });
    },
    submit: () => {
      const { form } = state;
      if (!form) return false;
      const answered = answer();
      if (!answered.allowed) return false;
      if (send(answered.command) === "not-sent") return false;
      waiting = answered.open
        ? { page: answered.open, command: answered.command, from: screen() }
        : null;
      set(CLOSED);
      return true;
    },
    cancel: () => {
      if (state.form) set(CLOSED);
    },
    settle: () => {
      if (!waiting) return;
      const app = getState();
      if (!app.connected || screen() !== waiting.from) {
        waiting = null;
        return;
      }
      if (!confirmedIn(app, waiting.command)) return;
      const { page } = waiting;
      waiting = null;
      openPage(page);
    },
    hear: (message) => {
      if (message._tag === "error" && !message.selectionId) waiting = null;
    },
  };
}
