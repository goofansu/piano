/**
 * The forms `runCommand` opens (see `CommandForm`) and their one lifecycle: `open` a form, edit its
 * input (a session title, or a project draft), `submit` or `cancel` it. Submitting re-checks the
 * form's rule, since the connection, the session's attachment or the project may have changed while
 * the form was open, and a form closes only after its answer was sent; a refused answer leaves it
 * open having sent nothing. Project settings starts from the project as saved when it opens. Sharing is a phase of its form (confirm, publishing, shared or failed) and publishes
 * at most once per opening. A new project not created for a session opens once it is saved: its
 * home, or the New page for it when the New page's project picker created it.
 * `CommandHost` and the dialogs render this state and nothing else. Nothing here depends on React.
 */
// Relative, not @shared: module tests load this file directly in Node.
import type { SessionShare } from "../../../shared/share.ts";
import type { ClientCommand } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";
import type { CommandForm } from "./commands.ts";
import {
  checkProjectDraft,
  EMPTY_PROJECT_DRAFT,
  findProject,
  type ProjectDraft,
  projectSettingsSave,
} from "./projectCommands.ts";
import { sessionLabel } from "./sessionCatalog.ts";
import { canRenameSession, canShareSession } from "./sessionCommands.ts";
import { sessionMutable, sessionWorking, workspaceFor } from "./sessionContext.ts";
import { sessionHasPreview } from "./sessionPreview.ts";

export interface FormAnswer {
  /** The form may be submitted now; otherwise its submit control is disabled. */
  allowed: boolean;
  /** What submitting sends; present exactly when an allowed registry form. */
  command?: ClientCommand;
  /**
   * The page submitting opens. A new project not created for a session opens its home, or the New
   * page for it when the New page's project picker created it; a deleted project's home or New page,
   * when on screen, gives way to the plain New page.
   */
  open?: FormPage;
  /** What submitting a share form publishes; present exactly when an allowed share form. */
  share?: { workspaceId: string; sessionId: string };
}

/** A page a submitted form opens: a project's home, or the New page, for a project or none. */
export type FormPage = { kind: "project"; projectId: string } | { kind: "new"; projectId?: string };

export interface AnswerContext {
  /** Share publishes only while signed in to Radius. */
  radiusSignedIn?: boolean;
  /** Names a new project; called only for an allowed new-project answer. */
  newId?: () => string;
}

/**
 * Answer `form` with its input: the session title for rename, the project draft for a new project
 * or a project's settings; confirmations take none. A project form answered with a title is refused.
 */
export function answerForm(
  state: AppState,
  form: CommandForm,
  input: string | ProjectDraft = "",
  { radiusSignedIn = false, newId = () => crypto.randomUUID() }: AnswerContext = {},
): FormAnswer {
  const text = typeof input === "string" ? input : "";
  switch (form.kind) {
    case "rename-session": {
      const { target } = form;
      const title = text.trim();
      if (!canRenameSession(state, target) || !title || title === (target.title ?? ""))
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
    // Sharing publishes over HTTP, not through a registry command.
    case "share-session": {
      const workspace = workspaceFor(state, form.target.cwd);
      if (!radiusSignedIn || !workspace || !canShareSession(state, form.target))
        return { allowed: false };
      return {
        allowed: true,
        share: { workspaceId: workspace.id, sessionId: form.target.sessionId },
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
          ? { open: { kind: "new" } }
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
        // One message, so the project, its instructions and its new session arrive in one registry write.
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
    // A project deleted while its settings are open refuses the save, as a vanished session refuses rename.
    case "project-settings": {
      if (typeof input === "string") return { allowed: false };
      return projectSettingsSave(state, form.projectId, input);
    }
  }
}

/** What a confirmation form asks; the one confirm dialog renders this and nothing else. */
export interface Confirmation {
  title: string;
  description: string;
  /** The confirm button's label. */
  confirmLabel: string;
  /** The confirm button is destructive: the change cannot be undone. */
  destructive: boolean;
}

/**
 * The question a confirmation form asks, as of `state`; undefined for a form with its own dialog
 * (rename, share, project, project settings). Deleting a working session warns that it interrupts the work.
 */
export function confirmation(state: AppState, form: CommandForm): Confirmation | undefined {
  switch (form.kind) {
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
      // The name sits in the body, where a long one wraps; the title stays one short line.
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
      const count = state.sessionReferences.filter(
        (s) => s.projectId === form.project.id && !s.archived,
      ).length;
      // Named as the sidebar's group is, so the reader knows where the sessions go.
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
    case "share-session":
    case "project":
    case "project-settings":
      return undefined;
  }
}

export type SharePhase =
  | { phase: "confirm" }
  | { phase: "publishing" }
  | { phase: "shared"; share: SessionShare }
  | { phase: "failed"; error: string };

export interface CommandFormsState {
  /** The open form; `null` when none is. */
  form: CommandForm | null;
  /** The rename form's text input: the session title; empty for every other form. */
  text: string;
  /** The New project or Project settings form's Name and Instructions; empty for every other form. */
  projectDraft: ProjectDraft;
  /** The share form's phase; `confirm` for every other form. */
  share: SharePhase;
}

export interface CommandFormsOptions {
  /** The page's state as of now; forms are answered against it when rendered and submitted. */
  getState: () => AppState;
  radiusSignedIn: () => boolean;
  send: (command: ClientCommand) => void;
  /** Publish a session to Radius; resolves once the publication is confirmed. */
  share: (workspaceId: string, sessionId: string) => Promise<SessionShare>;
  /** A project's home. */
  openProject: (id: string) => void;
  /** The New page, for `projectId` or, without it, for no project. */
  openNew: (projectId?: string) => void;
  newId?: () => string;
}

export interface CommandForms {
  getState: () => CommandFormsState;
  subscribe: (listener: () => void) => () => void;
  /** The open form's answer as of now; `{ allowed: false }` when none is open. */
  answer: () => FormAnswer;
  /**
   * Open `form`, replacing any open one. Rename starts from the session's title, Project settings
   * from the project's saved name and instructions.
   */
  open: (form: CommandForm) => void;
  /** The rename form's title. */
  edit: (text: string) => void;
  /** The New project or Project settings form's draft. */
  editProject: (draft: ProjectDraft) => void;
  /**
   * Send the open form's answer if it is allowed now, then close; a share form publishes instead and
   * stays open on its result. Returns whether anything was sent or published.
   */
  submit: () => boolean;
  /** Close the open form; ignored while a share is publishing. */
  cancel: () => void;
}

/** The forms whose input is a project draft rather than a title. */
const editsProject = (form: CommandForm) =>
  form.kind === "project" || form.kind === "project-settings";

export const SHARE_UNCONFIRMED =
  "Sharing could not be confirmed. Check Radius artifacts before sharing again.";

const CLOSED: CommandFormsState = {
  form: null,
  text: "",
  projectDraft: EMPTY_PROJECT_DRAFT,
  share: { phase: "confirm" },
};

export function createCommandForms({
  getState,
  radiusSignedIn,
  send,
  share,
  openProject,
  openNew,
  newId,
}: CommandFormsOptions): CommandForms {
  let state = CLOSED;
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
          { radiusSignedIn: radiusSignedIn(), newId },
        )
      : { allowed: false };

  const publish = (form: CommandForm, workspaceId: string, sessionId: string) => {
    // Only this opening of the form takes the result; a closed or replaced form ignores it.
    const settle = (phase: SharePhase) => {
      if (state.form === form) set({ ...state, share: phase });
    };
    set({ ...state, share: { phase: "publishing" } });
    share(workspaceId, sessionId).then(
      (result) => settle({ phase: "shared", share: result }),
      (cause: unknown) =>
        settle({
          phase: "failed",
          error: cause instanceof Error ? cause.message : SHARE_UNCONFIRMED,
        }),
    );
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    answer,
    open: (form) =>
      set({
        form,
        text: form.kind === "rename-session" ? (form.target.title ?? "") : "",
        projectDraft:
          form.kind === "project-settings" ? savedDraft(form.projectId) : EMPTY_PROJECT_DRAFT,
        share: { phase: "confirm" },
      }),
    edit: (text) => {
      if (state.form?.kind === "rename-session") set({ ...state, text });
    },
    editProject: (projectDraft) => {
      if (state.form && editsProject(state.form)) set({ ...state, projectDraft });
    },
    submit: () => {
      const { form } = state;
      if (!form) return false;
      // Publish at most once per opening: only from the confirmation phase.
      if (form.kind === "share-session" && state.share.phase !== "confirm") return false;
      const answered = answer();
      if (!answered.allowed) return false;
      if (answered.share) {
        publish(form, answered.share.workspaceId, answered.share.sessionId);
        return true;
      }
      if (!answered.command) return false;
      send(answered.command);
      set(CLOSED);
      if (answered.open?.kind === "project") openProject(answered.open.projectId);
      if (answered.open?.kind === "new") openNew(answered.open.projectId);
      return true;
    },
    cancel: () => {
      if (state.form && state.share.phase !== "publishing") set(CLOSED);
    },
  };
}
