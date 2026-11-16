import type { Project } from "@shared/wire";
import { cn } from "cn";
import {
  CircleCheckIcon,
  CircleMinusIcon,
  type LucideIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RotateCcwIcon,
  SettingsIcon,
  SquarePenIcon,
  TargetIcon,
  Trash2Icon,
} from "lucide-react";
import { useId, useRef } from "react";
import { FormDialog } from "@/components/FormDialog";
import { type IconPlace, PianoButton } from "@/components/PianoButton";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/PianoDialog";
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
import { PickerCheck } from "@/components/Picker";
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

const ICONS: Record<ProjectCommandIcon, LucideIcon> = {
  new: SquarePenIcon,
  create: PlusIcon,
  settings: SettingsIcon,
  done: CircleCheckIcon,
  reopen: RotateCcwIcon,
  delete: Trash2Icon,
  project: TargetIcon,
  remove: CircleMinusIcon,
};

export function isProjectCommandIcon(icon: string): icon is ProjectCommandIcon {
  return Object.hasOwn(ICONS, icon);
}

export function ProjectCommandIconView({
  icon,
  ...props
}: {
  icon: ProjectCommandIcon;
  "data-icon"?: "inline-start" | "inline-end";
}) {
  const Icon = ICONS[icon];
  return <Icon {...props} />;
}

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

export function ProjectCommandsMenu({
  project,
  commands,
  run,
  size,
  trailing,
}: {
  project: Project;
  commands: readonly ProjectCommand[];
  run: (command: ProjectCommand) => void;
  size: IconPlace;
  trailing?: boolean;
}) {
  const menu = projectMenu(commands);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PianoButton
          variant="ghost"
          size={size}
          trailing={trailing}
          className={cn(trailing && "-mr-(--glyph-pad)")}
          aria-label={`Project menu for ${project.name}`}
        >
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

export function ProjectDestinationItems<D extends { project: Project; command?: ProjectCommand }>({
  create,
  destinations,
  onCreate,
  onPick,
  selected,
}: {
  create: ProjectCommand;
  destinations: readonly D[];
  onCreate: () => void;
  onPick: (destination: D) => void;
  selected?: string;
}) {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem disabled={!create.enabled} onSelect={onCreate}>
          <ProjectCommandIconView icon={create.icon} /> {create.label}
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
                <TargetIcon />
                <span className="truncate">{d.project.name}</span>
                {selected !== undefined && <PickerCheck selected={d.project.id === selected} />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </>
      )}
    </>
  );
}

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
          <TargetIcon /> {entry.label}
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
    <FormDialog
      open={open}
      close={close}
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
    </FormDialog>
  );
}
