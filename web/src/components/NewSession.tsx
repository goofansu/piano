import { cn } from "cn";
import {
  CircleOffIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchPlusIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  TargetIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { Banner } from "@/components/Banner";
import { BranchLabel } from "@/components/BranchLabel";
import { useCommands } from "@/components/CommandHost";
import { ComposerSend, DraftEditor, useDraftEditor } from "@/components/DraftEditor";
import { FolderPicker } from "@/components/FolderPicker";
import { PaneShowSidebar } from "@/components/Pane";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/PianoCommand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { PianoMark } from "@/components/PianoMark";
import { Popover, PopoverTrigger } from "@/components/PianoPopover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { PickerCheck, PickerContent, PickerSearch } from "@/components/Picker";
import { ProjectDestinationItems } from "@/components/Projects";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { WorktreesPopover } from "@/components/Worktrees";
import type { Client } from "@/lib/client";
import { newSessionCommand, newSessionReady } from "@/lib/composerControl";
import { type GlobalCommand, trustCommand } from "@/lib/globalCommands";
import { NEW_SESSION_DRAFT } from "@/lib/messageDraft";
import {
  findProject,
  newProjectCommand,
  type ProjectCommand,
  projectDestinations,
} from "@/lib/projectCommands";
import { folderFor } from "@/lib/sessionCatalog";
import { completionTarget, directoryChoices, startPlace } from "@/lib/sessionContext";
import { startPage } from "@/lib/startPage";
import { composerInput, picker } from "@/lib/styles";
import { useImageSend } from "@/lib/useImageSend";
import { useOffers } from "@/lib/useMachine";
import { useModelCatalog } from "@/lib/useModelCatalog";
import { useModelChoice } from "@/lib/useModelChoice";
import { useSidebarLayout } from "@/lib/useSidebarLayout";
import { useWorktreeOperation } from "@/lib/useWorktreeOperation";
import type { WorktreeOperationOptions } from "@/lib/worktreeOperation";
import type { AppState } from "@/store";

type WorktreeClient = WorktreeOperationOptions["client"] & Pick<Client, "captureSend" | "dispatch">;

interface Props {
  state: AppState;
  client: WorktreeClient;
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
  client: WorktreeClient;
  chooseDirectory: (cwd: string) => void;
  onProjectChange?: (projectId?: string) => void;
  className?: string;
}) {
  const { run } = useCommands();
  const offers = useOffers();
  const sidebarLayout = useSidebarLayout();
  const page = startPage(state.view);
  const cwd = page?.cwd ?? "";
  const projectId = page?.projectId;
  const editor = useDraftEditor(NEW_SESSION_DRAFT);
  const [pickerOpen, setPickerOpen] = useState(false);

  const folder = folderFor(state, cwd);
  const place = startPlace(state, cwd, projectId);
  const trust = trustCommand(state, cwd, offers);
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
  const imageSend = useImageSend(editor, client.captureSend, { cwd }, state.selectionId, choice);
  const refusal = cwd ? offers.startRefusal(state, cwd) : undefined;
  const checkoutMissing = refusal === "checkout-missing";
  const ready =
    !editor.preparing &&
    !refusal &&
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
    imageSend.send((message, attemptId, start) => ({
      ...newSessionCommand({ cwd, projectId: join }, message, start),
      attemptId,
    }));
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
                onBrowse={offers.browse ? () => setPickerOpen(true) : undefined}
                client={client}
                worktreesOffered={offers.worktrees}
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
          cancelUpload={imageSend.cancel}
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
          model={choice}
          onSend={submit}
          voice={() => place}
          actions={<ComposerSend disabled={!ready} onClick={submit} />}
        />
        {checkoutMissing && (
          <Alert data-motion="fade" className="mt-2">
            <AlertDescription>
              Checkout removed. Restore it at its path or choose another directory.
            </AlertDescription>
          </Alert>
        )}
        {refusal === "folder-closed" && state.registryLoaded && (
          <Alert data-motion="fade" className="mt-2">
            <AlertDescription>
              Folder closed. Reopen it in this machine's Piano or choose another directory.
            </AlertDescription>
          </Alert>
        )}
        {offers.worktrees && !refusal && folder?.discovery.status === "error" && (
          <Alert data-motion="fade" variant="destructive" className="mt-2">
            <AlertDescription>
              Git status unavailable. Open Worktrees to inspect and refresh.
            </AlertDescription>
          </Alert>
        )}
      </div>
      {offers.browse && (
        <FolderPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onPick={chooseDirectory}
          initialPath={cwd || undefined}
        />
      )}
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
  const create = newProjectCommand(state, { newPage: true }, useOffers());
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
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Project"
          className={cn(
            picker,
            "ml-auto max-w-[45%] shrink-0 max-md:ml-0 max-md:max-w-full",
            current ? "text-ink-2" : "text-ink-3",
          )}
        >
          <TargetIcon className="text-ink-3" />
          <span className="truncate">{current ? current.name : "Project"}</span>
        </Button>
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
          <DropdownMenuItem onSelect={() => pick(undefined)}>
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
      <TooltipTrigger asChild>
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
      </TooltipTrigger>
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
  client,
  worktreesOffered,
}: {
  state: AppState;
  value: string;
  onChange: (cwd: string) => void;
  onBrowse?: () => void;
  client: WorktreeClient;
  worktreesOffered: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [wtOpen, setWtOpen] = useState(false);
  const worktrees = useWorktreeOperation(client, (cwd) => {
    onChange(cwd);
    setOpen(false);
  });
  const wtPending = worktrees.request.status === "pending";
  const search = useRef<HTMLInputElement>(null);
  const choices = directoryChoices(state, value, useOffers().startsSessionIn);
  const { trigger, roots } = choices;
  const worktreesFolder = worktreesOffered ? choices.worktreesFolder : undefined;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (wtPending) return;
        setOpen(next);
        if (next) setWtOpen(false);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          // oxlint-disable-next-line jsx-a11y/role-has-required-aria-props -- PopoverTrigger sets aria-controls.
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
      </PopoverTrigger>
      {wtOpen ? (
        <WorktreesPopover operation={worktrees} state={state} currentCwd={value} />
      ) : (
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
              {(onBrowse || worktreesFolder) && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    {onBrowse && (
                      <CommandItem
                        value="__browse"
                        onSelect={() => {
                          setOpen(false);
                          onBrowse();
                        }}
                      >
                        <FolderOpenIcon /> Browse…
                      </CommandItem>
                    )}
                    {worktreesFolder && (
                      <CommandItem
                        value="__worktree"
                        onSelect={() => {
                          setWtOpen(true);
                          worktrees.open(worktreesFolder.path);
                        }}
                      >
                        <GitBranchPlusIcon /> Worktrees
                      </CommandItem>
                    )}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PickerContent>
      )}
    </Popover>
  );
}
