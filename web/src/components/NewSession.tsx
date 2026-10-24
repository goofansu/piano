import { cn } from "cn";
import {
  ArrowUpIcon,
  FolderIcon,
  FolderMinusIcon,
  FolderOpenIcon,
  GitBranchPlusIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  TargetIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { BranchLabel } from "@/components/BranchLabel";
import { useCommands } from "@/components/CommandHost";
import { DraftEditor, useDraftEditor } from "@/components/DraftEditor";
import { FolderPicker } from "@/components/FolderPicker";
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
import { PickerCheck, PickerContent, PickerSearch } from "@/components/Picker";
import { ProjectDestinationItems } from "@/components/Projects";
import { ShowSidebarButton } from "@/components/ShowSidebarButton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { WorktreesPopover } from "@/components/Worktrees";
import { newSessionCommand, newSessionReady } from "@/lib/composerControl";
import { type GlobalCommand, trustCommand } from "@/lib/globalCommands";
import { NEW_SESSION_DRAFT } from "@/lib/messageDraft";
import { findProject, newProjectCommand, projectDestinations } from "@/lib/projectCommands";
import { folderFor } from "@/lib/sessionCatalog";
import { completionTarget, directoryChoices } from "@/lib/sessionContext";
import { composerAction, composerInput, picker } from "@/lib/styles";
import { useModelCatalog } from "@/lib/useModelCatalog";
import { useModelChoice } from "@/lib/useModelChoice";
import { useWorktreeOperation } from "@/lib/useWorktreeOperation";
import type { WorktreeOperationOptions } from "@/lib/worktreeOperation";
import type { AppState } from "@/store";

type WorktreeClient = WorktreeOperationOptions["client"];

interface Props {
  state: AppState;
  /** Sends commands; the worktree picker also hears its own receipts through it. */
  client: WorktreeClient;
  /** Picks the directory the session will run in; the page shows the store's `view.cwd`. */
  chooseDirectory: (cwd: string) => void;
  /** The project a session started here joins. */
  projectId?: string;
  onProjectChange: (projectId?: string) => void;
}

/** New session: a welcome above the composer. */
export function NewSession({ state, client, chooseDirectory, projectId, onProjectChange }: Props) {
  const project = findProject(state, projectId);
  return (
    <>
      {/* No header on this page; the sidebar sheet still needs its button on small screens. */}
      <ShowSidebarButton className="absolute top-[calc(var(--gutter)-0.5rem)] left-[calc(var(--gutter)-0.5rem)]" />
      <div className="new-session-layout flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-14 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6 md:py-16">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col md:my-auto md:flex-none">
          <div className="new-session-welcome flex min-h-0 flex-1 flex-col items-center justify-center py-6 text-center md:mb-7 md:flex-none md:py-0">
            <PianoMark className="mb-5 hidden size-12 rounded-2xl md:inline-flex" />
            <h1 className="text-xl font-medium tracking-tight md:text-[2rem]">
              {project?.name ?? "What should we work on?"}
            </h1>
            <p className="mt-2 hidden text-base text-ink-2 md:block">
              A little progress starts with an idea.
            </p>
          </div>
          <NewSessionComposer
            state={state}
            client={client}
            chooseDirectory={chooseDirectory}
            projectId={projectId}
            onProjectChange={onProjectChange}
            className="shrink-0"
            inputClassName="new-session-input md:max-h-[min(18rem,30dvh)] md:min-h-28 md:pt-5"
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
 * chosen model and effort.
 */
export function NewSessionComposer({
  state,
  client,
  chooseDirectory,
  projectId,
  onProjectChange,
  className,
  inputClassName,
}: {
  state: AppState;
  client: WorktreeClient;
  chooseDirectory: (cwd: string) => void;
  projectId?: string;
  onProjectChange?: (projectId?: string) => void;
  className?: string;
  inputClassName?: string;
}) {
  const { send } = client;
  const { run } = useCommands();
  // The client starts a fresh New page in the last directory used, else the first folder; a
  // project's New page starts without one, and its home in its most recent member's folder.
  const cwd =
    state.view.kind === "new" || state.view.kind === "project" ? (state.view.cwd ?? "") : "";
  const editor = useDraftEditor(NEW_SESSION_DRAFT);
  const [pickerOpen, setPickerOpen] = useState(false);

  const folder = folderFor(state, cwd);
  const trust = trustCommand(state, cwd);
  const models = useModelCatalog(cwd || undefined);
  const { catalog } = models;
  // The choice belongs to the directory; a reconnect keeps it, re-clamped to the refreshed catalog.
  const choice = useModelChoice(catalog, { kind: "new", cwd });
  // The client asks Pi about this directory's models and trust whenever it changes (see lib/client).
  const ready = newSessionReady({
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
    choice.submit((start) =>
      editor.submit((message) => send(newSessionCommand({ cwd, projectId: join }, message, start))),
    );
  };

  return (
    <>
      <div className={className}>
        {/* Left: where the session runs, with that directory's trust beside it. Right: which project it joins. */}
        <div className="mb-2 flex min-w-0 items-center gap-1">
          <div className="min-w-0 shrink">
            <DirectorySelect
              state={state}
              value={cwd}
              onChange={chooseDirectory}
              onBrowse={() => setPickerOpen(true)}
              client={client}
            />
          </div>
          {trust && <TrustToggle command={trust} run={run} />}
          {onProjectChange && (
            <ProjectSelect state={state} value={projectId} onChange={onProjectChange} />
          )}
        </div>
        <DraftEditor
          editor={editor}
          completion={completionTarget(state)}
          attachmentsDisabled={!state.connected}
          autoFocus={!window.matchMedia("(pointer: coarse)").matches}
          label="First message"
          inputClassName={cn(composerInput, inputClassName)}
          maxHeight={288}
          model={{
            models,
            value: choice.model,
            onChange: choice.onModelChange,
            effort: choice.effort,
            onEffortChange: choice.onEffortChange,
            noDirectory: !cwd,
          }}
          onSend={submit}
          actions={
            <Button
              size="icon"
              data-motion="press"
              className={composerAction}
              aria-label="Send"
              disabled={!ready}
              onClick={submit}
            >
              <span className="inline-flex">
                <ArrowUpIcon />
              </span>
            </Button>
          }
        />
        {folder?.discovery.status === "error" && (
          <Alert data-motion="fade" variant="destructive" className="mt-2">
            <AlertDescription>
              Git status unavailable. Open Worktrees to inspect and refresh.
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

/**
 * Which project the new session joins: the sidebar's destination menu, with a way to clear the
 * choice. A project created here becomes the page's project.
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
  const create = newProjectCommand(state);
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
            "ml-auto max-w-[45%] shrink-0",
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
        />
        {current && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => pick(undefined)}>
                <FolderMinusIcon /> None
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
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
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={trusted}
      aria-label="Directory trust"
      aria-busy={command.pending || undefined}
      disabled={!command.enabled}
      className={cn(picker, "shrink-0", trusted ? "text-ink-3" : "text-ink-2")}
      title={
        trusted
          ? "Pi loads this folder's .pi settings, extensions and skills. Click to untrust."
          : "Pi skips this folder's .pi settings, extensions and skills. Click to trust."
      }
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
      <span className="max-[360px]:hidden">{trusted ? "Trusted" : "Untrusted"}</span>
    </Button>
  );
}

/** Folder roots plus Browse and Worktrees escape hatches; a selected worktree is still named by folder and branch. */
function DirectorySelect({
  state,
  value,
  onChange,
  onBrowse,
  client,
}: {
  state: AppState;
  value: string;
  onChange: (cwd: string) => void;
  onBrowse: () => void;
  client: WorktreeClient;
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
  const { trigger, roots, worktreesFolder } = directoryChoices(state, value);
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
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label="Directory"
          className={cn(picker, "w-full min-w-0 max-w-none justify-start")}
          title={value}
        >
          <FolderIcon className="text-ink-3" />
          {trigger.kind === "none" ? (
            <span>Choose a folder</span>
          ) : trigger.kind === "checkout" ? (
            <>
              <span className="truncate font-mono">{trigger.folder}</span>
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
        <PickerContent aria-label="Choose a folder" searchRef={search}>
          <Command>
            <PickerSearch ref={search} aria-label="Search folders" placeholder="Search folders" />
            <CommandList className="max-h-[min(18rem,60dvh)]">
              <CommandEmpty>No folder matches.</CommandEmpty>
              {roots.length > 0 && (
                <CommandGroup heading="Folders">
                  {roots.map((root) => (
                    <CommandItem
                      key={root.path}
                      value={root.path}
                      keywords={[root.label]}
                      disabled={root.disabled}
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
            </CommandList>
          </Command>
        </PickerContent>
      )}
    </Popover>
  );
}
