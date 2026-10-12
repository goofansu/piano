import type { ClientCommand } from "@shared/wire";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  type LucideIcon,
  PencilIcon,
  PlusIcon,
  TargetIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ProjectCommandIcon, ProjectDialog } from "@/lib/projectCommands";
import type { AppState } from "@/store";

const ICONS: Record<ProjectCommandIcon, LucideIcon> = {
  new: PlusIcon,
  edit: PencilIcon,
  archive: ArchiveIcon,
  unarchive: ArchiveRestoreIcon,
  project: TargetIcon,
};

/** A project command's icon, wherever its command is offered. */
export function ProjectCommandIconView({ icon }: { icon: ProjectCommandIcon }) {
  const Icon = ICONS[icon];
  return <Icon />;
}

/** Organization only: saving never opens, aborts or releases a Pi child. The command host owns the one instance. */
export function ProjectDialogView({
  state,
  send,
  dialog,
  close,
  openProject,
}: {
  state: AppState;
  send: (command: ClientCommand) => void;
  dialog: ProjectDialog;
  close: () => void;
  openProject: (id: string) => void;
}) {
  const [name, setName] = useState(dialog.project?.name ?? "");
  const editing = !!dialog.project;
  const ready = state.connected && !!name.trim();
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            const id = dialog.project?.id ?? crypto.randomUUID();
            // One message, so the project and its new session arrive in one registry write.
            send({
              _tag: "save_project",
              project: { id, name: name.trim() },
              assign: dialog.assign && {
                cwd: dialog.assign.cwd,
                sessionId: dialog.assign.sessionId,
              },
            });
            close();
            if (!editing && !dialog.assign) openProject(id);
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? "Edit project" : "New project"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Rename the project."
                : "A project groups sessions from any folders around one outcome."}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="project-name">Name</FieldLabel>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                autoFocus
                required
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready}>
              {editing ? "Save" : dialog.assign ? "Create and add session" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
