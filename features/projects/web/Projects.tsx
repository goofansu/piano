import { ProjectFields } from "@features/projects/web/ProjectSettings";
import type { Project } from "@shared/wire";
import { cn } from "cn";
import { MoreHorizontalIcon, TargetIcon } from "lucide-react";
import { useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/shared/components/FormDialog";
import { IconButton } from "@/shared/components/IconButton";
import { type IconPlace, PianoButton } from "@/shared/components/PianoButton";
import {
  type DialogFinalFocus,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/PianoDialog";
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
} from "@/shared/components/PianoDropdownMenu";
import { PickerCheck } from "@/shared/components/Picker";
import { ProjectCommandIconView } from "@/shared/components/ProjectCommandIcon";
import {
  type ProjectCommand,
  type ProjectDialog,
  type ProjectDraft,
  projectCommands,
  projectMenu,
  type SessionProjectMenu,
} from "@/shared/state/projectActions";
import type { AppState } from "@/shared/state/state";

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
      onClick={() => run(command)}
    >
      <ProjectCommandIconView icon={command.icon} /> {command.label}
    </DropdownMenuItem>
  );
}

export function projectRowActions(
  state: AppState,
  project: Project,
  run: (command: ProjectCommand) => void,
) {
  const commands = projectCommands(state, project);
  const create = commands.find((c) => c.id === "new-session");
  return [
    create?.enabled && (
      <IconButton
        key="new"
        size="row"
        label={create.ariaLabel ?? create.label}
        tooltip={create.label}
        onClick={() => run(create)}
      >
        <ProjectCommandIconView icon={create.icon} />
      </IconButton>
    ),
    <ProjectCommandsMenu key="menu" project={project} commands={commands} run={run} size="row" />,
  ];
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
      <DropdownMenuTrigger
        render={
          <PianoButton
            variant="ghost"
            size={size}
            trailing={trailing}
            className={cn(trailing && "-mr-(--glyph-pad)")}
            aria-label={`Project menu for ${project.name}`}
            data-project-menu
          />
        }
      >
        <MoreHorizontalIcon />
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
  create: ProjectCommand | undefined;
  destinations: readonly D[];
  onCreate: (create: ProjectCommand) => void;
  onPick: (destination: D) => void;
  selected?: string;
}) {
  return (
    <>
      {create && (
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={!create.enabled} onClick={() => onCreate(create)}>
            <ProjectCommandIconView icon={create.icon} /> {create.label}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      )}
      {destinations.length > 0 && (
        <>
          {create && <DropdownMenuSeparator />}
          <DropdownMenuGroup>
            {destinations.map((d) => (
              <DropdownMenuItem
                key={d.project.id}
                disabled={d.command ? !d.command.enabled : false}
                onClick={() => onPick(d)}
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
            onCreate={run}
            onPick={(d) => run(d.command)}
          />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {remove && (
        <DropdownMenuItem disabled={!remove.enabled} onClick={() => run(remove)}>
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
  finalFocus,
}: {
  open: boolean;
  dialog: ProjectDialog | undefined;
  draft: ProjectDraft;
  setDraft: (draft: ProjectDraft) => void;
  allowed: boolean;
  submit: () => void;
  close: () => void;
  finalFocus?: DialogFinalFocus;
}) {
  const id = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  return (
    <FormDialog
      open={open}
      close={close}
      className="sm:max-w-xl"
      initialFocus={nameInput}
      finalFocus={finalFocus}
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
