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
import { findProject, newProjectCommand, projectDestinations } from "@/lib/projectCommands";
import { folderFor } from "@/lib/sessionCatalog";
import {
  checkoutMissingAt,
  completionTarget,
  directoryChoices,
  startPlace,
} from "@/lib/sessionContext";
import { startPage } from "@/lib/startPage";
import { composerInput, picker } from "@/lib/styles";
import { useImageSend } from "@/lib/useImageSend";
import { useOffers } from "@/lib/useMachine";
import { useModelCatalog } from "@/lib/useModelCatalog";
import { useModelChoice } from "@/lib/useModelChoice";
import { useWorktreeOperation } from "@/lib/useWorktreeOperation";
import type { WorktreeOperationOptions } from "@/lib/worktreeOperation";
import type { AppState } from "@/store";

type WorktreeClient = WorktreeOperationOptions["client"] & Pick<Client, "captureSend" | "dispatch">;

interface Props {
  state: AppState;
  /** Sends commands; the worktree picker also hears its own receipts through it. */
  client: WorktreeClient;
  /** Picks the directory the session will run in; the page shows the store's `view.cwd`. */
  chooseDirectory: (cwd: string) => void;
  /** Absent on a project's home, which is the project. */
  onProjectChange?: (projectId?: string) => void;
}

/** New session: a welcome above the composer. The project control names the project; the headline does not repeat it. */
export function NewSession({ state, client, chooseDirectory, onProjectChange }: Props) {
  return (
    <>
      {/* No header on this page; the sidebar sheet still needs its button on small screens. */}
      <PaneShowSidebar />
      <div className="new-session-layout flex min-h-0 flex-1 flex-col overflow-y-auto px-(--gutter) pt-14 pb-[max(1rem,env(safe-area-inset-bottom))] md:py-16">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col md:my-auto md:flex-none">
          {/* Below md the mark alone fills the space above the composer: the project control
           * beneath already names the project, and a long name would wrap into a wall of text. */}
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

/**
 * The composer that starts a session, on the New page and on a project's home: where it runs, that
 * directory's trust, which project it joins (only where `onProjectChange` lets the page change it),
 * and the first message. The first prompt creates the session in the chosen directory with the
 * chosen model and effort. On a remote machine the directory is one the remote registered: there is
 * no browsing or worktree creation, which would change more than its projects and that folder's trust.
 */
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
  // The client starts a fresh New page in the last directory used, else the first folder; a
  // project's New page starts without one, and its home in its most recent member's folder.
  const page = startPage(state.view);
  const cwd = page?.cwd ?? "";
  const projectId = page?.projectId;
  const editor = useDraftEditor(NEW_SESSION_DRAFT);
  const imageSend = useImageSend(editor, client.captureSend, { cwd }, state.selectionId);
  const [pickerOpen, setPickerOpen] = useState(false);

  const folder = folderFor(state, cwd);
  const place = startPlace(state, cwd, projectId);
  const trust = trustCommand(state, cwd);
  const models = useModelCatalog(cwd || undefined);
  const { catalog } = models;
  // The choice belongs to the directory; a reconnect keeps it, re-clamped to the refreshed catalog.
  const choice = useModelChoice(
    models,
    { kind: "new", cwd },
    undefined,
    true,
    state.pendingCreate?.outcome === "rejected" && state.pendingCreate.cwd === cwd
      ? state.pendingCreate.options
      : undefined,
  );
  // No session can start where the checkout is gone; the draft waits for another directory.
  const checkoutMissing = !!cwd && checkoutMissingAt(state, cwd);
  // The client asks Pi about this directory's models and trust whenever it changes (see lib/client).
  const ready =
    !editor.preparing &&
    (!cwd || offers.startsSessionIn(state, cwd)) &&
    newSessionReady({
      text: editor.message,
      images: editor.attachments,
      connected: state.connected,
      catalog,
      cwd,
      model: choice.model,
    });

  const submit = () => {
    // A creation that is sent switches the main pane to the new session at once, so this page never
    // shows a pending state; one known not sent keeps the draft and the pick here.
    if (!ready) return;
    // A project deleted while it was chosen is no longer joined.
    const join = findProject(state, projectId)?.id;
    const start = choice.start;
    imageSend.send(
      (message, attemptId) => ({
        ...newSessionCommand({ cwd, projectId: join }, message, start),
        attemptId,
      }),
      (consumed) => {
        if (consumed) choice.consume();
      },
    );
  };

  return (
    <>
      <div className={className}>
        {/* Left: where the session runs, with that directory's trust beside it. Right: which project it
         * joins. Below md the pane is the whole screen and the row wraps instead, each control the
         * size of its name, so a long folder, branch or project name never crowds the others out. */}
        <div className="mb-2 flex min-w-0 items-center gap-1 max-md:flex-wrap max-md:gap-y-0.5">
          {/* The directory and its trust stay on one line: the branch gives way, never the trust. */}
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
          autoFocus={!window.matchMedia("(pointer: coarse)").matches}
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
        {offers.worktrees && !checkoutMissing && folder?.discovery.status === "error" && (
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

/**
 * Which project the new session joins: the sidebar's destination menu with the current choice
 * checked, as the Directory and Model pickers beside it check theirs, and No project last. A
 * project created here becomes the page's project.
 */
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
  const onCreate = () => {
    setOpen(false);
    run(create);
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

/**
 * The palette's Trust folder command as a toggle that shows the directory's state; offered only for
 * directories with `.pi` resources or `.agents/skills`, which Pi loads only when trusted.
 */
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

/**
 * Folder roots plus Browse and Worktrees escape hatches, offered only where this machine may
 * browse or create; a selected worktree is still named by folder and branch.
 */
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
  // A pending worktree operation keeps the picker open until its receipt, timeout or disconnect.
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
        // Reset to the folder list on open, not on close: a closing overlay keeps its last open face.
        if (next) setWtOpen(false);
      }}
    >
      <Tooltip>
        {/* The full path waits in a tooltip; with no directory chosen there is none to show. */}
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              // oxlint-disable-next-line jsx-a11y/role-has-required-aria-props -- PopoverTrigger sets aria-controls.
              role="combobox"
              aria-expanded={open}
              aria-label="Directory"
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
                  {/* The folder keeps its name; a long branch truncates first, as in the session header. */}
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
        </TooltipTrigger>
        {value && <TooltipContent className="max-w-md break-all">{value}</TooltipContent>}
      </Tooltip>
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
                    {/* Worktrees belong to the chosen folder's repository. */}
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
