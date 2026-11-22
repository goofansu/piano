import type { CommandForm } from "../../../../features/commands/web/index.ts";
import { canRenameSession } from "../../../../features/commands/web/index.ts";
import {
  saveNewProject,
  deleteProject,
  projectDeletionConfirmation,
  type ProjectFormPage,
  EMPTY_PROJECT_DRAFT,
  type ProjectDraft,
  type ProjectDraftCheck,
  projectSettingsSave,
} from "../../../../features/projects/web/index.ts";
import type { SendDisposition } from "../../../../shared/transport/ws.ts";
import {
  type ClientCommand,
  SESSION_TITLE_MAX,
  type ServerMessage,
} from "../../../../shared/wire.ts";
import { findProject } from "../../shared/lib/projects.ts";
import { screenKey } from "../../shared/navigation/pageAddress.ts";
import { sessionWorking } from "../../shared/state/sessionActivity.ts";
import { sessionLabel } from "../../shared/state/sessionCatalog.ts";
import { sessionMutable } from "../../shared/state/sessionContext.ts";
import type { AppState } from "../../shared/state/state.ts";

export type FormAnswer = {
  projectCheck?: ProjectDraftCheck;
} & (
  | { allowed: false }
  | {
      allowed: true;
      command: ClientCommand;
      open?: ProjectFormPage;
    }
);

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
      return deleteProject(state, form.project);
    case "project":
      return typeof input === "string"
        ? { allowed: false }
        : saveNewProject(state, form.dialog, input, newId);
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
    case "archive-session": {
      const title = sessionLabel(form.target.title);
      return {
        title: "Stop and archive this session?",
        description: `This will stop any work still running in "${title}" and remove it from the sidebar. Its transcript will be kept. Changes already made to files will not be undone.`,
        confirmLabel: "Stop and archive",
        destructive: false,
      };
    }
    case "delete-session": {
      const working = sessionWorking(state, form.target);
      const stop = working ? "This will stop the session and interrupt its current work. " : "";
      return {
        title: "Delete session?",
        description: `${stop}"${sessionLabel(form.target.title)}" and its transcript are removed from Pi's session store. This cannot be undone.`,
        confirmLabel: working ? "Stop and delete" : "Delete",
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
    case "delete-project":
      return projectDeletionConfirmation(state, form.project);
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
  openPage: (page: ProjectFormPage) => void;
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
  let waiting: { page: ProjectFormPage; command: ClientCommand; from: string } | null = null;
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
