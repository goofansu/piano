import { type GlobalCommand, trustCommand } from "@features/commands/web";
import { useCommands } from "@features/commands/web/browser";
import { useModelCatalog, useModelChoice } from "@features/models/web/browser";
import { useSidebarLayout } from "@features/navigation/web/browser";
import {
  newProjectCommand,
  projectDestinations,
  ProjectDestinationItems,
} from "@features/projects/web/browser";
import {
  completionTarget,
  newSessionCommand,
  newSessionReady,
  ComposerSend,
  DraftEditor,
  useDraftEditor,
  directoryChoices,
  startPlace,
} from "@features/sessions/web/browser";
import { FolderPicker } from "@features/workspace/web/browser";
import { cn } from "cn";
import {
  CircleOffIcon,
  FolderIcon,
  FolderOpenIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  TargetIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { useComposerToolbar } from "@/app/sessions/composerToolbar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AlertDetails, Banner } from "@/shared/components/Banner";
import { BranchLabel } from "@/shared/components/BranchLabel";
import { PaneShowSidebar } from "@/shared/components/Pane";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/shared/components/PianoCommand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/PianoDropdownMenu";
import { PianoMark } from "@/shared/components/PianoMark";
import { Popover, PopoverTrigger } from "@/shared/components/PianoPopover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/PianoTooltip";
import { PickerCheck, PickerContent, PickerSearch } from "@/shared/components/Picker";
import { composerInput, picker } from "@/shared/lib/styles";
import type { Client } from "@/shared/state/client";
import { NEW_SESSION_DRAFT } from "@/shared/state/draftKey";
import type { ProjectCommand } from "@/shared/state/projectCommandTypes";
import { folderFor } from "@/shared/state/sessionCatalog";
import { checkoutMissingAt } from "@/shared/state/sessionContext";
import { startPage } from "@/shared/state/startPage";
import type { AppState } from "@/shared/state/state";
import { findProject } from "../../shared/lib/projects.ts";

type StartClient = Pick<Client, "send" | "dispatch">;

interface Props {
  state: AppState;
  client: StartClient;
  chooseDirectory: (cwd: string) => void;
  onProjectChange?: (projectId?: string) => void;
}

export function NewSession({ state, client, chooseDirectory, onProjectChange }: Props) {
  return (
    <>
      <PaneShowSidebar />
      <div className="new-session-layout flex min-h-0 flex-1 flex-col overflow-y-auto px-(--gutter) pt-14 pb-[max(1rem,env(safe-area-inset-bottom))] md:py-16">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col md:my-auto md:flex-none">
          <div className="new-session-welcome flex min-h-0 flex-1 flex-col items-center justify-center py-6 text-center md:mb-7 md:flex-none md:py-0">
            <PianoMark className="size-12 rounded-2xl md:mb-5" />
            <h1 className="hidden text-xl font-medium tracking-tight md:block md:text-[2rem]">
              What should we work on?
            </h1>
            <p className="mt-2 hidden text-base text-ink-2 md:block">
              A little progress starts with an idea.
            </p>
          </div>
          <NewSessionComposer
            state={state}
            client={client}
            chooseDirectory={chooseDirectory}
            onProjectChange={onProjectChange}
            className="shrink-0"
          />
        </div>
      </div>
    </>
  );
}

export function NewSessionComposer({
  state,
  client,
  chooseDirectory,
  onProjectChange,
  className,
}: {
  state: AppState;
  client: StartClient;
  chooseDirectory: (cwd: string) => void;
  onProjectChange?: (projectId?: string) => void;
  className?: string;
}) {
  const { run } = useCommands();
  const sidebarLayout = useSidebarLayout();
  const page = startPage(state.view);
  const cwd = page?.cwd ?? "";
  const projectId = page?.projectId;
  const editor = useDraftEditor(NEW_SESSION_DRAFT);
  const [pickerOpen, setPickerOpen] = useState(false);

  const folder = folderFor(state, cwd);
  const place = startPlace(state, cwd, projectId);
  const trust = trustCommand(state, cwd);
  const models = useModelCatalog(cwd || undefined);
  const { catalog } = models;
  const choice = useModelChoice(
    models,
    { kind: "new", cwd },
    undefined,
    true,
    state.pendingCreate?.outcome === "rejected" && state.pendingCreate.cwd === cwd
      ? state.pendingCreate.options
      : undefined,
  );
  const toolbar = useComposerToolbar(choice, place);
  const checkoutMissing = !!cwd && checkoutMissingAt(state, cwd);
  const ready =
    !checkoutMissing &&
    newSessionReady({
      text: editor.message,
      images: editor.attachments,
      connected: state.connected,
      catalog,
      cwd,
      model: choice.model,
    });

  const submit = () => {
    if (!ready) return;
    const join = findProject(state, projectId)?.id;
    const { start } = choice;
    if (
      editor.submit((message, attemptId) =>
        client.send({ ...newSessionCommand({ cwd, projectId: join }, message, start), attemptId }),
      )
    )
      choice.consume();
  };

  return (
    <>
      <div className={className}>
        <div className="mb-2 flex min-w-0 items-center gap-1 max-md:flex-wrap max-md:gap-y-0.5">
          <div className="flex min-w-0 max-w-full shrink items-center gap-1">
            <div className="min-w-0 shrink">
              <DirectorySelect
                state={state}
                value={cwd}
                onChange={chooseDirectory}
                onBrowse={() => setPickerOpen(true)}
              />
            </div>
            {trust && <TrustToggle command={trust} run={run} />}
          </div>
          {onProjectChange && (
            <ProjectSelect state={state} value={projectId} onChange={onProjectChange} />
          )}
        </div>
        {state.selectionFailure && state.pendingCreate?.outcome === "rejected" && (
          <Banner
            variant="destructive"
            title="Could not start session"
            action={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => client.dispatch({ type: "dismiss_creation" })}
                >
                  Dismiss
                </Button>
                <Button variant="outline" size="sm" disabled={!ready} onClick={submit}>
                  Retry
                </Button>
              </>
            }
          >
            {state.selectionFailure.message}
          </Banner>
        )}
        <DraftEditor
          editor={editor}
          completion={completionTarget(state)}
          attachmentsDisabled={!state.connected}
          autoFocus={
            !window.matchMedia("(pointer: coarse)").matches && !sidebarLayout.getState().mobileOpen
          }
          label="First message"
          inputClassName={cn(
            composerInput,
            "new-session-input md:max-h-[min(18rem,30dvh)] md:min-h-28 md:pt-5",
          )}
          maxHeight={288}
          toolbar={toolbar}
          onSend={submit}
          actions={<ComposerSend disabled={!ready} onClick={submit} />}
        />
        {checkoutMissing && (
          <Alert data-motion="fade" className="mt-2">
            <AlertDescription>
              Checkout removed. Restore it at its path or choose another directory.
            </AlertDescription>
          </Alert>
        )}
        {!checkoutMissing && folder?.discovery.status === "error" && (
          <Alert data-motion="fade" variant="destructive" className="mt-2">
            <AlertDescription>
              Git status unavailable.
              <AlertDetails label="Error details">
                <p className="whitespace-pre-wrap break-words">{folder.discovery.detail}</p>
              </AlertDetails>
            </AlertDescription>
          </Alert>
        )}
      </div>
      <FolderPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={chooseDirectory}
        initialPath={cwd || undefined}
      />
    </>
  );
}

function ProjectSelect({
  state,
  value,
  onChange,
}: {
  state: AppState;
  value?: string;
  onChange: (id?: string) => void;
}) {
  const { run } = useCommands();
  const [open, setOpen] = useState(false);
  const create = newProjectCommand(state, { newPage: true });
  const onCreate = (command: ProjectCommand) => {
    setOpen(false);
    run(command);
  };
  const current = findProject(state, value);
  const choices = projectDestinations(state, current, { keepCurrent: true });
  const pick = (id?: string) => {
    onChange(id);
    setOpen(false);
  };
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label="Project"
            className={cn(
              picker,
              "ml-auto max-w-[45%] shrink-0 max-md:ml-0 max-md:max-w-full",
              current ? "text-ink-2" : "text-ink-3",
            )}
          />
        }
      >
        <TargetIcon className="text-ink-3" />
        <span className="truncate">{current ? current.name : "Project"}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label="Choose a project"
        className="max-w-[calc(100vw-2rem)]"
      >
        <ProjectDestinationItems
          create={create}
          destinations={choices.map((project) => ({ project }))}
          onCreate={onCreate}
          onPick={(d) => pick(d.project.id)}
          selected={current?.id}
        />
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => pick(undefined)}>
            <CircleOffIcon /> No project
            <PickerCheck selected={!current} />
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TrustToggle({
  command,
  run,
}: {
  command: GlobalCommand;
  run: (command: GlobalCommand) => void;
}) {
  const trusted = !!command.pressed;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={trusted}
            aria-label="Directory trust"
            aria-busy={command.pending || undefined}
            disabled={!command.enabled}
            className={cn(picker, "shrink-0", trusted ? "text-ink-3" : "text-ink-2")}
            onClick={() => run(command)}
          >
            {command.pending ? (
              <Spinner
                data-icon="inline-start"
                aria-label="Updating trust"
                className="motion-reduce:animate-none"
              />
            ) : trusted ? (
              <ShieldCheckIcon data-icon="inline-start" />
            ) : (
              <ShieldOffIcon data-icon="inline-start" />
            )}
            <span>{trusted ? "Trusted" : "Untrusted"}</span>
          </Button>
        }
      />
      <TooltipContent>
        {trusted
          ? "Pi loads this directory's .pi resources"
          : "Pi skips this directory's .pi resources"}
      </TooltipContent>
    </Tooltip>
  );
}

function DirectorySelect({
  state,
  value,
  onChange,
  onBrowse,
}: {
  state: AppState;
  value: string;
  onChange: (cwd: string) => void;
  onBrowse?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const { trigger, roots } = directoryChoices(state, value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            // oxlint-disable-next-line jsx-a11y/role-has-required-aria-props
            role="combobox"
            aria-expanded={open}
            aria-label="Directory"
            title={value || undefined}
            className={cn(
              picker,
              "w-full min-w-0 max-w-none justify-start",
              trigger.kind === "none" && "text-ink-3",
            )}
          >
            <FolderIcon className="text-ink-3" />
            {trigger.kind === "none" ? (
              <span>Directory</span>
            ) : trigger.kind === "checkout" ? (
              <>
                <span className="max-w-[12rem] shrink-0 truncate">{trigger.folder}</span>
                {trigger.branchLabel && (
                  <BranchLabel branch={trigger.branchLabel} className="text-ink-3" />
                )}
              </>
            ) : (
              <span className="truncate font-mono">{trigger.label}</span>
            )}
          </Button>
        }
      />
      <PickerContent aria-label="Choose a directory" searchRef={search}>
        <Command>
          <PickerSearch
            ref={search}
            divider={false}
            aria-label="Search folders"
            placeholder="Search folders"
          />
          <CommandList className="max-h-[min(18rem,60dvh)]">
            <CommandEmpty>No folder matches.</CommandEmpty>
            {roots.length > 0 && (
              <CommandGroup heading="Folders">
                {roots.map((root) => (
                  <CommandItem
                    key={root.path}
                    value={root.path}
                    keywords={[root.label]}
                    onSelect={() => {
                      onChange(root.path);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{root.label}</span>
                    <PickerCheck selected={root.selected} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {onBrowse && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value="__browse"
                    onSelect={() => {
                      setOpen(false);
                      onBrowse();
                    }}
                  >
                    <FolderOpenIcon /> Browse…
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PickerContent>
    </Popover>
  );
}
