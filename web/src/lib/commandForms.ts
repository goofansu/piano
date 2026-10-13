/**
 * The answers to the forms `runCommand` opens (see `CommandForm`): whether the answer is allowed now,
 * and the one registry change it sends. Forms re-check their rule when answered, since the
 * connection or the session's attachment may have changed while the form was open. `CommandHost`
 * and the project dialog render the inputs and act on the answer.
 */
// Relative, not @shared: module tests load this file directly in Node.
import type { ClientCommand } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";
import type { CommandForm } from "./commands.ts";
import { canRenameSession } from "./sessionCommands.ts";
import { sessionMutable } from "./sessionContext.ts";

export interface FormAnswer {
  /** The form may be submitted now; otherwise its submit control is disabled. */
  allowed: boolean;
  /** What submitting sends; present exactly when allowed. */
  command?: ClientCommand;
  /** A new project, not created for a session, opens once it is saved. */
  openProject?: string;
}

/**
 * Answer `form` with its text input (the session title or project name; unused by confirmations).
 * `newId` names a new project; it is called only for an allowed new-project answer.
 */
export function answerForm(
  state: AppState,
  form: CommandForm,
  text = "",
  newId: () => string = () => crypto.randomUUID(),
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
    case "delete-session": {
      const { cwd, sessionId } = form.target;
      if (!sessionMutable(state, form.target)) return { allowed: false };
      return { allowed: true, command: { _tag: "delete_session", cwd, sessionId } };
    }
    // Sharing has its own HTTP confirmation/result form, not a registry command.
    case "share-session":
      return { allowed: false };
    case "close-folder":
      if (!state.connected) return { allowed: false };
      return { allowed: true, command: { _tag: "remove_folder", path: form.folder.path } };
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
