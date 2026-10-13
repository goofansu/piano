import { cn } from "cn";
import {
  ArrowUpIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchPlusIcon,
  PlusIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  TargetIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { BranchLabel } from "@/components/BranchLabel";
import { useCommands } from "@/components/CommandHost";
import { DraftEditor, useDraftEditor } from "@/components/DraftEditor";
import { FolderPicker } from "@/components/FolderPicker";
import { IconButton } from "@/components/IconButton";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/PianoCommand";
import { PianoMark } from "@/components/PianoMark";
import { Popover, PopoverTrigger } from "@/components/PianoPopover";
import { PickerCheck, PickerContent, PickerSearch } from "@/components/Picker";
import { ShowSidebarButton } from "@/components/ShowSidebarButton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { WorktreesPopover } from "@/components/Worktrees";
import { newSessionCommand, newSessionReady } from "@/lib/composerControl";
import { abbrevHome } from "@/lib/format";
import { type GlobalCommand, trustCommand } from "@/lib/globalCommands";
import { NEW_SESSION_DRAFT } from "@/lib/messageDraft";
import {
  canStartSessionIn,
  findProject,
  newProjectCommand,
  projectChoices,
  projectCommand,
} from "@/lib/projectCommands";
import { completionTarget, folderFor } from "@/lib/sessionContext";
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
  /** The project a session started here joins; the page is that project's home. */
  projectId?: string;
  onProjectChange: (projectId?: string) => void;
}

/** New session: a composer. The first prompt creates the session in the chosen directory with the chosen model and effort. */
export function NewSession({ state, client, chooseDirectory, projectId, onProjectChange }: Props) {
  const { send } = client;
  const { run } = useCommands();
  // The client starts a fresh page in the last directory used, else the first folder; opened for a project, it starts without one.
  const cwd = state.view.kind === "new" ? (state.view.cwd ?? "") : "";
  const editor = useDraftEditor(NEW_SESSION_DRAFT);
  const [pickerOpen, setPickerOpen] = useState(false);

  const folder = folderFor(state, cwd);
  const project = findProject(state, projectId);
  const unarchive = project && projectCommand(state, project, "unarchive");
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
    projectOpen: canStartSessionIn(state, projectId),
  });

  const submit = () => {
    // Creating switches the main pane to the new session at once, so this page never shows a pending state.
    if (!ready) return;
    editor.submit((message) =>
      send(newSessionCommand({ cwd, projectId }, message, choice.start())),
    );
  };

  return (
    <>
      {/* No header on this page; the sidebar sheet still needs its button on small screens. */}
      <ShowSidebarButton className="absolute top-2 left-2" />
      <div className="new-session-layout flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-14 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6 md:py-16">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col md:my-auto md:flex-none">
          <div className="new-session-welcome welcome-enter flex min-h-0 flex-1 flex-col items-center justify-center py-6 text-center md:mb-7 md:flex-none md:py-0">
            <PianoMark className="mb-5 hidden size-12 rounded-2xl md:inline-flex" />
            <h1 className="text-xl font-medium tracking-tight md:text-[2rem]">
              {project?.name ?? "What should we work on?"}
            </h1>
            <p className="mt-2 hidden text-base text-ink-2 md:block">
              A little progress starts with an idea.
            </p>
          </div>
          <div className="shrink-0">
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
              <ProjectSelect state={state} value={projectId} onChange={onProjectChange} />
            </div>
            <DraftEditor
              editor={editor}
              completion={completionTarget(state)}
              attachmentsDisabled={!state.connected}
              autoFocus={!window.matchMedia("(pointer: coarse)").matches}
              label="First message"
              className="welcome-enter welcome-composer"
              inputClassName={cn(
                composerInput,
                "new-session-input md:max-h-[min(18rem,30dvh)] md:min-h-28 md:pt-5",
              )}
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
                  className={composerAction}
                  aria-label="Send"
                  disabled={!ready}
                  onClick={submit}
                >
                  <span className="control-enter inline-flex">
                    <ArrowUpIcon />
                  </span>
                </Button>
              }
            />
            {folder?.discovery.status === "error" && (
              <Alert
                variant="destructive"
                className="mt-2 animate-in fade-in-0 slide-in-from-top-1"
              >
                <AlertDescription>
                  Git status unavailable. Open Worktrees to inspect and refresh.
                </AlertDescription>
              </Alert>
            )}
            {unarchive && (
              <Alert className="mt-2 animate-in fade-in-0 slide-in-from-top-1">
                <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>This project is archived.</span>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    disabled={!unarchive.enabled}
                    onClick={() => run(unarchive)}
                  >
                    {unarchive.label}
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
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
 * Which project the new session joins: the same searchable picker as the directory beside it, and the
 * place to create the first one. A project created here becomes the page's project.
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
  const search = useRef<HTMLInputElement>(null);
  const current = findProject(state, value);
  const choices = projectChoices(state, current);
  const pick = (id?: string) => {
    onChange(id);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          role="combobox"
          aria-expanded={open}
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
      </PopoverTrigger>
      <PickerContent align="end" aria-label="Choose a project" searchRef={search}>
        {choices.length === 0 ? (
          // Before the first project exists there is nothing to search; the page invites creating one instead.
          <Empty className="p-6 md:p-6">
            <EmptyHeader>
              <EmptyDescription>
                No projects yet. A project groups sessions from any folders around one outcome.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" disabled={!create.enabled} onClick={onCreate}>
                <PlusIcon /> {create.label}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Command>
            <PickerSearch ref={search} aria-label="Search projects" placeholder="Search projects">
              <IconButton label={create.label} disabled={!create.enabled} onClick={onCreate}>
                <PlusIcon aria-hidden />
              </IconButton>
            </PickerSearch>
            <CommandList className="max-h-[min(18rem,60dvh)]">
              <CommandEmpty>No project matches.</CommandEmpty>
              <CommandGroup>
                {choices.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.id}
                    keywords={[p.name]}
                    onSelect={() => pick(p.id)}
                  >
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {p.archived && <span className="text-xs text-ink-3">Archived</span>}
                    <PickerCheck selected={p.id === value} />
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  value="__none"
                  keywords={["none", "no project"]}
                  onSelect={() => pick(undefined)}
                >
                  <span className="min-w-0 flex-1 truncate">None</span>
                  <PickerCheck selected={!value} />
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PickerContent>
    </Popover>
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
      disabled={!command.enabled}
      className={cn(picker, "shrink-0", trusted ? "text-ink-3" : "text-ink-2")}
      title={
        trusted
          ? "Pi loads this folder's .pi settings, extensions and skills. Click to untrust."
          : "Pi skips this folder's .pi settings, extensions and skills. Click to trust."
      }
      onClick={() => run(command)}
    >
      {trusted ? <ShieldCheckIcon /> : <ShieldOffIcon />}
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
    setWtOpen(false);
  });
  // A pending worktree operation keeps the picker open until its receipt, timeout or disconnect.
  const wtPending = worktrees.request.status === "pending";
  const search = useRef<HTMLInputElement>(null);
  const known = state.folders.flatMap((p) => p.worktrees.map((w) => ({ folder: p.name, ...w })));
  const current = known.find((k) => k.path === value);
  const roots = known.filter((k) => k.root);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (wtPending) return;
        setOpen(next);
        if (!next) setWtOpen(false);
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
          {!value ? (
            <span>Choose a folder</span>
          ) : current ? (
            <>
              <span className="truncate font-mono">{current.folder}</span>
              {!current.root && (
                <BranchLabel
                  branch={
                    current.branch ?? (current.facts?.detached ? "Detached" : "Unknown branch")
                  }
                  className="text-ink-3"
                />
              )}
            </>
          ) : (
            <span className="truncate font-mono">{abbrevHome(value)}</span>
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
                  {roots.map((k) => (
                    <CommandItem
                      key={k.path}
                      value={k.path}
                      keywords={[k.folder]}
                      disabled={k.status === "missing"}
                      onSelect={() => {
                        onChange(k.path);
                        setOpen(false);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{k.folder}</span>
                      <PickerCheck selected={k.path === value} />
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
                {current && (
                  <CommandItem
                    value="__worktree"
                    onSelect={() => {
                      setWtOpen(true);
                      worktrees.open(folderFor(state, value)?.path);
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
