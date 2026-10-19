import type { Project } from "@shared/wire";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  FolderIcon,
  FolderInputIcon,
  FolderMinusIcon,
  type LucideIcon,
  PencilIcon,
  PlusIcon,
  TargetIcon,
} from "lucide-react";
import { useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/PianoDropdownMenu";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  assignProjectCommand,
  newProjectCommand,
  type ProjectCommand,
  type ProjectCommandIcon,
  type ProjectDialog,
  projectDestinations,
} from "@/lib/projectCommands";
import type { SessionTarget } from "@/lib/sessionCommands";
import { sessionProject } from "@/lib/sessionContext";
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

/**
 * Shared destination rows for the composer menu and sidebar submenu. `disabled` is for a pick that
 * sends a registry change; the New page's pick only chooses locally.
 */
export function ProjectDestinationItems({
  create,
  projects,
  disabled = false,
  onCreate,
  onPick,
}: {
  create: ProjectCommand;
  projects: readonly Project[];
  disabled?: boolean;
  onCreate: () => void;
  onPick: (id: string) => void;
}) {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem disabled={!create.enabled} onSelect={onCreate}>
          <ProjectCommandIconView icon={create.icon} /> {create.label}…
        </DropdownMenuItem>
      </DropdownMenuGroup>
      {projects.length > 0 && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {projects.map((p) => (
              <DropdownMenuItem key={p.id} disabled={disabled} onSelect={() => onPick(p.id)}>
                <FolderIcon />
                <span className="truncate">
                  {p.name}
                  {p.archived && " · Archived"}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </>
      )}
    </>
  );
}

/**
 * A session's project rows for a menu: the current membership named, the destinations in a
 * submenu, and removal. "New project…" creates a destination and files the session in it without
 * changing execution. `run` is the command host's runner.
 */
export function ProjectMenu({
  state,
  session,
  run,
}: {
  state: AppState;
  session: SessionTarget;
  run: (command: ProjectCommand) => void;
}) {
  const current = sessionProject(state, session);
  const destinations = projectDestinations(state, current, { keepCurrent: false });
  const create = newProjectCommand(state, session);
  return (
    <>
      {current && (
        <DropdownMenuLabel className="max-w-64 truncate font-normal text-muted-foreground">
          {current.name}
          {current.archived && " · Archived"}
        </DropdownMenuLabel>
      )}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={!create.enabled}>
          <FolderInputIcon /> {current ? "Move to project" : "Add to project"}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-w-[calc(100vw-2rem)]">
          <ProjectDestinationItems
            create={create}
            projects={destinations}
            disabled={!state.connected}
            onCreate={() => run(create)}
            onPick={(id) => run(assignProjectCommand(state, session, id))}
          />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {current && (
        <DropdownMenuItem
          disabled={!state.connected}
          onSelect={() => run(assignProjectCommand(state, session, null))}
        >
          <FolderMinusIcon /> Remove from project
        </DropdownMenuItem>
      )}
    </>
  );
}

/**
 * Organization only: saving never opens, aborts or releases a Pi child. The command host owns the
 * one instance and its form (name, whether saving is allowed, submitting); this only renders it.
 */
export function ProjectDialogView({
  open,
  dialog,
  name,
  allowed,
  edit,
  submit,
  close,
}: {
  open: boolean;
  dialog: ProjectDialog | undefined;
  name: string;
  allowed: boolean;
  edit: (name: string) => void;
  submit: () => void;
  close: () => void;
}) {
  const editing = !!dialog?.project;
  const nameInput = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="sm:max-w-md"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameInput.current?.focus();
        }}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? "Edit project" : "New project"}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="project-name">Name</FieldLabel>
              <Input
                id="project-name"
                ref={nameInput}
                value={name}
                onChange={(e) => edit(e.target.value)}
                maxLength={200}
                required
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!allowed}>
              {editing ? "Save" : dialog?.assign ? "Create and add session" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
