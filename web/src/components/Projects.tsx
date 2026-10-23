import { PROJECT_INSTRUCTIONS_MAX, type Project } from "@shared/wire";
import {
  FolderIcon,
  FolderInputIcon,
  FolderMinusIcon,
  type LucideIcon,
  PencilIcon,
  PlusIcon,
  ScrollTextIcon,
  Trash2Icon,
} from "lucide-react";
import { useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea";
import type {
  ProjectCommand,
  ProjectCommandIcon,
  ProjectDialog,
  SessionProjectMenu,
} from "@/lib/projectCommands";

const ICONS: Record<ProjectCommandIcon, LucideIcon> = {
  new: PlusIcon,
  edit: PencilIcon,
  instructions: ScrollTextIcon,
  delete: Trash2Icon,
  folder: FolderIcon,
  remove: FolderMinusIcon,
};

/** A project command's icon, wherever its command is offered. */
export function ProjectCommandIconView({ icon }: { icon: ProjectCommandIcon }) {
  const Icon = ICONS[icon];
  return <Icon />;
}

/**
 * Shared destination rows for the composer menu and sidebar submenu. A destination with a `command`
 * sends a registry change and is enabled as that command is; the New page's pick only chooses locally.
 */
export function ProjectDestinationItems<D extends { project: Project; command?: ProjectCommand }>({
  create,
  destinations,
  onCreate,
  onPick,
}: {
  create: ProjectCommand;
  destinations: readonly D[];
  onCreate: () => void;
  onPick: (destination: D) => void;
}) {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem disabled={!create.enabled} onSelect={onCreate}>
          <ProjectCommandIconView icon={create.icon} /> {create.label}…
        </DropdownMenuItem>
      </DropdownMenuGroup>
      {destinations.length > 0 && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {destinations.map((d) => (
              <DropdownMenuItem
                key={d.project.id}
                disabled={d.command ? !d.command.enabled : false}
                onSelect={() => onPick(d)}
              >
                <FolderIcon />
                <span className="truncate">{d.project.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </>
      )}
    </>
  );
}

/**
 * A session's project rows for a menu, from `sessionProjectMenu`: the current membership named, the
 * destinations in a submenu, and removal. "New project…" creates a destination and files the session
 * in it without changing execution. `run` is the command host's runner.
 */
export function ProjectMenu({
  menu,
  run,
}: {
  menu: SessionProjectMenu;
  run: (command: ProjectCommand) => void;
}) {
  const { current, entry, create, remove } = menu;
  return (
    <>
      {current && (
        <DropdownMenuLabel className="max-w-64 truncate text-sm font-normal text-muted-foreground">
          {current.name}
        </DropdownMenuLabel>
      )}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={!entry.enabled}>
          <FolderInputIcon /> {entry.label}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-w-[calc(100vw-2rem)]">
          <ProjectDestinationItems
            create={create}
            destinations={menu.destinations}
            onCreate={() => run(create)}
            onPick={(d) => run(d.command)}
          />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {remove && (
        <DropdownMenuItem disabled={!remove.enabled} onSelect={() => run(remove)}>
          <ProjectCommandIconView icon={remove.icon} /> {remove.label}
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

/**
 * What Pi adds to the system prompt of the project's sessions. The command host owns the one
 * instance and its form (the text, whether saving is allowed, submitting); this only renders it.
 */
export function ProjectInstructionsDialogView({
  project,
  instructions,
  allowed,
  edit,
  submit,
  close,
}: {
  project: Project | undefined;
  instructions: string;
  allowed: boolean;
  edit: (instructions: string) => void;
  submit: () => void;
  close: () => void;
}) {
  return (
    <Dialog open={!!project} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-xl">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Instructions</DialogTitle>
            <DialogDescription>
              Pi adds these to the system prompt of every session in {project?.name}. A session
              already running gets them when it next starts.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <Textarea
              aria-label="Instructions"
              value={instructions}
              onChange={(e) => edit(e.target.value)}
              maxLength={PROJECT_INSTRUCTIONS_MAX}
              className="max-h-[50dvh] min-h-40 font-mono text-sm"
              autoFocus
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!allowed}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
