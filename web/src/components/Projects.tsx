import type { Project } from "@shared/wire";
import {
  FolderIcon,
  FolderInputIcon,
  FolderMinusIcon,
  type LucideIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SettingsIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import { useId, useRef } from "react";
import { type IconPlace, PianoButton } from "@/components/PianoButton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/PianoDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { ProjectFields } from "@/components/ProjectSettings";
import { Button } from "@/components/ui/button";
import {
  type ProjectCommand,
  type ProjectCommandIcon,
  type ProjectDialog,
  type ProjectDraft,
  projectMenu,
  type SessionProjectMenu,
} from "@/lib/projectCommands";

/** The one map from a project command's icon name to its icon, menus and palette alike. */
const ICONS: Record<ProjectCommandIcon, LucideIcon> = {
  new: SquarePenIcon,
  "new-project": PlusIcon,
  settings: SettingsIcon,
  delete: Trash2Icon,
  folder: FolderIcon,
  remove: FolderMinusIcon,
};

/** Whether `icon` names a project command's icon, which `ProjectCommandIconView` draws. */
export function isProjectCommandIcon(icon: string): icon is ProjectCommandIcon {
  return Object.hasOwn(ICONS, icon);
}

/** A project command's icon, wherever its command is offered. */
export function ProjectCommandIconView({
  icon,
  ...props
}: {
  icon: ProjectCommandIcon;
  /** A Button's leading or trailing icon, which sets its padding. */
  "data-icon"?: "inline-start" | "inline-end";
}) {
  const Icon = ICONS[icon];
  return <Icon {...props} />;
}

/** A project command as a menu row, by its label and icon. */
function ProjectCommandMenuItem({
  command,
  run,
}: {
  command: ProjectCommand;
  run: (command: ProjectCommand) => void;
}) {
  return (
    <DropdownMenuItem
      variant={command.destructive ? "destructive" : undefined}
      disabled={!command.enabled}
      onSelect={() => run(command)}
    >
      <ProjectCommandIconView icon={command.icon} /> {command.label}
    </DropdownMenuItem>
  );
}

/**
 * A project's ⋯ menu, from `projectCommands` as `projectMenu` lays it out: its rows, then Delete
 * apart, as on a session's menu. The sidebar's project group, the Projects index and the project's
 * home differ only in the trigger's place. `run` is the command host's runner.
 */
export function ProjectCommandsMenu({
  project,
  commands,
  run,
  size,
}: {
  project: Project;
  commands: readonly ProjectCommand[];
  run: (command: ProjectCommand) => void;
  size: IconPlace;
}) {
  const menu = projectMenu(commands);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PianoButton variant="ghost" size={size} aria-label={`Project menu for ${project.name}`}>
          <MoreHorizontalIcon />
        </PianoButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {menu.manage.length > 0 && (
          <DropdownMenuGroup>
            {menu.manage.map((c) => (
              <ProjectCommandMenuItem key={c.id} command={c} run={run} />
            ))}
          </DropdownMenuGroup>
        )}
        {menu.destructive.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {menu.destructive.map((c) => (
                <ProjectCommandMenuItem key={c.id} command={c} run={run} />
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
 * one instance and its form (the project draft, whether saving is allowed, submitting); this only
 * renders it, in the shape of Project settings, so the project's first session already carries
 * its instructions.
 */
export function ProjectDialogView({
  open,
  dialog,
  draft,
  setDraft,
  allowed,
  submit,
  close,
}: {
  open: boolean;
  dialog: ProjectDialog | undefined;
  draft: ProjectDraft;
  setDraft: (draft: ProjectDraft) => void;
  allowed: boolean;
  submit: () => void;
  close: () => void;
}) {
  const id = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="sm:max-w-xl"
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
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <ProjectFields id={id} draft={draft} setDraft={setDraft} nameRef={nameInput} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!allowed}>
              {dialog?.assign ? "Create and add session" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
