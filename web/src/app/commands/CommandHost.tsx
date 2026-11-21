import { CommandsContext } from "@features/commands/web/commandContext";
import {
  type Command,
  type CommandEffects,
  type CommandForm,
  runCommand,
} from "@features/commands/web/commands";
import { useSidebarLayout } from "@features/navigation/web/sidebar/useSidebarLayout";
import { useSidebarView } from "@features/navigation/web/sidebar/useSidebarView";
import {
  openProjectCommands,
  projectPageActions,
  sessionProjectMenu,
} from "@features/projects/web/projectActions";
import { ProjectDialogView } from "@features/projects/web/Projects";
import { ProjectSettingsDialog } from "@features/projects/web/ProjectSettings";
import { artifactsMenu } from "@features/radius/web/artifactsMenu";
import { useMessagesOnly } from "@features/sessions/web/transcript/useMessagesOnly";
import { ShareSessionDialog, type ShareTarget } from "@features/sharing/web/ShareSessionDialog";
import { type ClientCommand, SESSION_TITLE_MAX, type ServerMessage } from "@shared/wire";
import { useTheme } from "next-themes";
import { useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { editorAvailable, openPageEditor, pageAvailability } from "@/app/settingsEditors";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { copyText } from "@/shared/components/CopyButton";
import { FormDialog } from "@/shared/components/FormDialog";
import { DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/PianoDialog";
import { RemovalDialog } from "@/shared/components/RemovalDialog";
import { type FocusReturn, focusReturn } from "@/shared/lib/focusReturn";
import { useCodeWrap } from "@/shared/lib/useCodeWrap";
import { useNavigation } from "@/shared/navigation/useNavigation";
import { sessionLabel } from "@/shared/state/sessionCatalog";
import { workspaceFor } from "@/shared/state/sessionContext";
import type { AppState } from "@/shared/state/state";
import type { SendDisposition } from "../../../../shared/transport/ws.ts";
import { confirmation, FORM_NOT_SENT } from "./commandForms";
import { useCommandForms } from "./useCommandForms";

async function copySessionValue(value: string, label: string) {
  const failure = `Could not copy the ${label[0]?.toLowerCase()}${label.slice(1)}.`;
  if (await copyText(value, failure)) toast.success(`${label} copied`);
}

const SESSION_MENU = "main header [data-session-menu]";

function formFocusFallback(form: CommandForm) {
  if (form.kind === "project") return '[data-command="new-project"]';
  if (form.kind === "project-settings" || form.kind === "delete-project")
    return "main header [data-project-menu]";
  return SESSION_MENU;
}

export function CommandHost({
  state,
  send,
  decideTrust,
  listen,
  children,
}: {
  state: AppState;
  send: (command: ClientCommand) => SendDisposition;
  decideTrust: (path: string, trusted: boolean) => void;
  listen: (listener: (message: ServerMessage) => void) => () => void;
  children: React.ReactNode;
}) {
  const {
    openPage,
    openNew,
    openProjects,
    openProject,
    openChanges,
    toggleRail,
    showAgent,
    openPullRequest,
    openSettings,
    closeSettings,
    settings,
    layout,
  } = useNavigation();
  const [messagesOnly, setMessagesOnly] = useMessagesOnly();
  const [codeWrap, setCodeWrap] = useCodeWrap();
  const { view, setView } = useSidebarView();
  const { theme, setTheme } = useTheme();
  const sidebar = useSidebarLayout();
  const sidebarHidden = useSyncExternalStore(sidebar.subscribe, sidebar.getState).hidden;
  useSyncExternalStore(pageAvailability.subscribe, pageAvailability.getState);
  const forms = useCommandForms({
    state,
    send: (command) => {
      const disposition = send(command);
      if (disposition === "not-sent") toast.warning(FORM_NOT_SENT);
      return disposition;
    },
    openPage,
    listen,
  });
  const { form } = forms;
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renaming = form?.kind === "rename-session" ? form.target : null;
  const close = forms.cancel;
  const answer = forms.answer();
  const asking = form ? confirmation(state, form) : undefined;
  const project = form?.kind === "project" ? form.dialog : undefined;
  const projectSettings = form?.kind === "project-settings";
  const [sharing, setSharing] = useState<ShareTarget | null>(null);
  const returnFocus = useRef<FocusReturn | undefined>(undefined);

  const effects: CommandEffects = {
    send,
    decideTrust,
    closeSettings,
    openSettings,
    openNew,
    openProjects,
    openProject,
    openChanges,
    openArtifacts: artifactsMenu.open,
    toggleRail,
    showAgent,
    openPullRequest,
    toggleSidebar: sidebar.toggle,
    setView,
    setMessagesOnly,
    setCodeWrap,
    setAppearance: setTheme,
    copy: (value, label) => void copySessionValue(value, label),
    openForm: (form) => {
      returnFocus.current = focusReturn(formFocusFallback(form));
      forms.open(form);
    },
    shareSession: (target) => {
      const workspace = workspaceFor(state, target.cwd);
      if (!workspace) {
        toast.error("Could not find this session’s workspace. Refresh the session list.");
        return;
      }
      returnFocus.current = focusReturn(SESSION_MENU);
      setSharing({
        workspaceId: workspace.id,
        sessionId: target.sessionId,
        title: sessionLabel(target.title),
      });
    },
    openPageEditor,
  };
  const run = (command: Command) => runCommand(command, effects);

  return (
    <CommandsContext.Provider
      value={{
        run,
        messagesOnly,
        layout,
        codeWrap,
        state,
        sessionProjectMenu,
        openProjectCommands,
        global: {
          projectPageActions,
          editorAvailable,
          settings,
          view,
          theme: theme ?? "system",
          sidebarHidden,
        },
      }}
    >
      {children}
      {sharing && (
        <ShareSessionDialog
          target={sharing}
          close={() => setSharing(null)}
          openSettings={openSettings}
          finalFocus={returnFocus.current}
        />
      )}
      <FormDialog
        open={!!renaming}
        close={close}
        className="sm:max-w-md"
        initialFocus={renameInputRef}
        finalFocus={returnFocus.current}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            forms.submit();
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <Input
                ref={renameInputRef}
                aria-label="Session name"
                value={renaming ? forms.text : ""}
                onChange={(event) => forms.edit(event.target.value)}
                onFocus={(event) => event.target.select()}
                maxLength={SESSION_TITLE_MAX}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!answer.allowed}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </FormDialog>
      <RemovalDialog
        open={!!asking}
        title={asking?.title ?? ""}
        description={asking?.description ?? ""}
        action={asking?.confirmLabel ?? ""}
        destructive={asking?.destructive}
        busy={false}
        disabled={!answer.allowed}
        cancel={close}
        confirm={forms.submit}
        finalFocus={returnFocus.current}
      />
      <ProjectDialogView
        open={!!project}
        dialog={project}
        draft={forms.projectDraft}
        setDraft={forms.editProject}
        allowed={answer.allowed}
        submit={forms.submit}
        close={close}
        finalFocus={returnFocus.current}
      />
      <ProjectSettingsDialog
        open={projectSettings}
        check={answer.projectCheck}
        draft={forms.projectDraft}
        setDraft={forms.editProject}
        allowed={answer.allowed}
        submit={forms.submit}
        close={close}
        finalFocus={returnFocus.current}
      />
    </CommandsContext.Provider>
  );
}
