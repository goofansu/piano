/**
 * The forms `runCommand` opens (see `CommandForm`) and their one lifecycle: `open` a form, `edit`
 * its text, `submit` or `cancel` it. Submitting re-checks the form's rule, since the connection or
 * the session's attachment may have changed while the form was open, and a form closes only after
 * its answer was sent; a refused answer leaves it open having sent nothing. Sharing is a phase of
 * its form (confirm, publishing, shared or failed) and publishes at most once per opening. A new
 * project not created for a session opens once it is saved. `CommandHost` and the dialogs render
 * this state and nothing else. Nothing here depends on React.
 */
// Relative, not @shared: module tests load this file directly in Node.
import type { SessionShare } from "../../../shared/share.ts";
import type { ClientCommand } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";
import type { CommandForm } from "./commands.ts";
import { canRenameSession, canShareSession } from "./sessionCommands.ts";
import { sessionMutable, sessionWorking, workspaceFor } from "./sessionContext.ts";
import { sessionHasPreview } from "./sessionPreview.ts";

export interface FormAnswer {
  /** The form may be submitted now; otherwise its submit control is disabled. */
  allowed: boolean;
  /** What submitting sends; present exactly when an allowed registry form. */
  command?: ClientCommand;
  /** A new project, not created for a session, opens once it is saved. */
  openProject?: string;
  /** A deleted project's home or New page, when on screen, gives way to the plain New page. */
  leaveProject?: string;
  /** What submitting a share form publishes; present exactly when an allowed share form. */
  share?: { workspaceId: string; sessionId: string };
}

export interface AnswerContext {
  /** Share publishes only while signed in to Radius. */
  radiusSignedIn?: boolean;
  /** Names a new project; called only for an allowed new-project answer. */
  newId?: () => string;
}

/** Answer `form` with its text input (the session title or project name; unused by confirmations). */
export function answerForm(
  state: AppState,
  form: CommandForm,
  text = "",
  { radiusSignedIn = false, newId = () => crypto.randomUUID() }: AnswerContext = {},
): FormAnswer {
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
          ? { leaveProject: form.project.id }
          : {}),
      };
    case "project": {
      const { project, assign } = form.dialog;
      const name = text.trim();
      if (!state.connected || !name) return { allowed: false };
      const id = project?.id ?? newId();
      return {
        allowed: true,
        // One message, so the project and its new session arrive in one registry write.
        command: {
          _tag: "save_project",
          project: { id, name },
          assign: assign && { cwd: assign.cwd, sessionId: assign.sessionId },
        },
        ...(!project && !assign ? { openProject: id } : {}),
      };
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
 * (rename, share, project). Deleting a working session warns that it interrupts the work.
 */
export function confirmation(state: AppState, form: CommandForm): Confirmation | undefined {
  switch (form.kind) {
    case "archive-session": {
      const title = form.target.title || "Untitled";
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
        title: "Delete this session?",
        description: `${stop}"${form.target.title || "Untitled"}" and its transcript are removed from Pi's session store. This cannot be undone.`,
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
      const kept =
        count === 0
          ? ""
          : count === 1
            ? " Its session is kept, in no project."
            : ` Its ${count} sessions are kept, in no project.`;
      return {
        title: "Delete this project?",
        description: `"${form.project.name}" will be deleted.${kept} This cannot be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      };
    }
    case "rename-session":
    case "share-session":
    case "project":
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
  /** The form's text input: the session title or project name. */
  text: string;
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
  openProject: (id: string) => void;
  /** The plain New page, with no project. */
  openNew: () => void;
  newId?: () => string;
}

export interface CommandForms {
  getState: () => CommandFormsState;
  subscribe: (listener: () => void) => () => void;
  /** The open form's answer as of now; `{ allowed: false }` when none is open. */
  answer: () => FormAnswer;
  /** Open `form`, replacing any open one. Rename starts from the title, a project edit from its name. */
  open: (form: CommandForm) => void;
  edit: (text: string) => void;
  /**
   * Send the open form's answer if it is allowed now, then close; a share form publishes instead and
   * stays open on its result. Returns whether anything was sent or published.
   */
  submit: () => boolean;
  /** Close the open form; ignored while a share is publishing. */
  cancel: () => void;
}

export const SHARE_UNCONFIRMED =
  "Sharing could not be confirmed. Check Radius artifacts before sharing again.";

const CLOSED: CommandFormsState = { form: null, text: "", share: { phase: "confirm" } };

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
  const answer = (): FormAnswer =>
    state.form
      ? answerForm(getState(), state.form, state.text, {
          radiusSignedIn: radiusSignedIn(),
          newId,
        })
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
        text:
          form.kind === "rename-session"
            ? (form.target.title ?? "")
            : form.kind === "project"
              ? (form.dialog.project?.name ?? "")
              : "",
        share: { phase: "confirm" },
      }),
    edit: (text) => {
      if (state.form) set({ ...state, text });
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
      if (answered.openProject) openProject(answered.openProject);
      if (answered.leaveProject) openNew();
      return true;
    },
    cancel: () => {
      if (state.form && state.share.phase !== "publishing") set(CLOSED);
    },
  };
}
