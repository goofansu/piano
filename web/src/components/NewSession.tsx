import type { ClientCommand as ClientMessage, ThinkingLevel } from "@shared/wire";
import { cn } from "cn";
import { ArrowUpIcon, FolderIcon, FolderOpenIcon, GitBranchPlusIcon, PanelLeftOpenIcon, PlusIcon, ShieldCheckIcon, ShieldOffIcon, TargetIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AttachButton, AttachmentDraftView, attachmentEvents, useAttachments } from "@/components/Attachments";
import { BranchLabel } from "@/components/BranchLabel";
import { clampEffort, levelsFor } from "@/components/EffortSelect";
import { FolderPicker } from "@/components/FolderPicker";
import { ModelSelect } from "@/components/ModelSelect";
import { activeProjects } from "@/components/OutcomeProjects";
import { PianoMark } from "@/components/PianoMark";
import { PickerCheck, PickerContent, PickerSearch } from "@/components/Picker";
import { SlashTextarea } from "@/components/SlashTextarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { WorktreesPopover } from "@/components/Worktrees";
import { abbrevHome } from "@/lib/format";
import { isSendKey } from "@/lib/keys";
import { readStorage, writeStorage } from "@/lib/storage";
import { composerAction, composerCard, composerInput, composerToolbar, picker } from "@/lib/styles";
import { useTypeToFocus } from "@/lib/typeToFocus";
import { useAutoGrow } from "@/lib/useAutoGrow";
import type { AppState } from "@/store";

interface Props {
  state: AppState;
  send: (m: ClientMessage) => void;
  onDraftChange: (key: string, text: string) => void;
  initialCwd?: string;
  /** The project a session started here joins; the page is that project's home. */
  outcomeProjectId?: string;
  onProjectChange: (outcomeProjectId?: string) => void;
  /** Open the New project dialog; the created project becomes this page's project. */
  onNewProject: () => void;
  onMenu: () => void;
  /** The chosen directory, so the command palette can offer its trust command. */
  onDirectoryChange?: (cwd: string) => void;
}

const LAST_DIR = "piano.lastDir";

/** New session: a composer. The first prompt creates the session in the chosen directory with the chosen model and effort. */
export function NewSession({ state, send, onDraftChange, initialCwd, outcomeProjectId, onProjectChange, onNewProject, onMenu, onDirectoryChange }: Props) {
  const [cwd, setCwd] = useState(() => {
    if (initialCwd) return initialCwd;
    // Opened for a project, the page starts without a directory; a directory already chosen here survives picking a project.
    if (outcomeProjectId) return "";
    return readStorage(LAST_DIR) ?? "";
  });
  const text = state.drafts["new-session"] ?? "";
  const setText = (value: string) => onDraftChange("new-session", value);
  const attachments = useAttachments("new-session");
  const [model, setModel] = useState<string | undefined>(undefined);
  const [effort, setEffort] = useState<ThinkingLevel | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialCwd) setCwd(initialCwd);
  }, [initialCwd]);
  useEffect(() => { onDirectoryChange?.(cwd); }, [cwd, onDirectoryChange]);

  useAutoGrow(textarea, text, 288);
  useTypeToFocus(textarea, useCallback((s: string) => onDraftChange("new-session", text + s), [onDraftChange, text]));
  // Fall back to the first known project when nothing is remembered.
  useEffect(() => {
    if (!outcomeProjectId && !cwd && state.projects[0]) setCwd(state.projects[0].path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.projects.length]);
  useEffect(() => {
    if (!creating) return;
    const t = setTimeout(() => setCreating(false), 15000);
    return () => clearTimeout(t);
  }, [creating]);

  const project = state.projects.find(p => p.worktrees.some(w => w.path === cwd));
  const outcome = outcomeProjectId ? state.outcomeProjects.find(p => p.id === outcomeProjectId) : undefined;
  const trust = directoryTrust(state, cwd);
  const catalog = state.catalogs[cwd] ?? null;
  useEffect(() => {
    setModel(undefined); setEffort(undefined);
  }, [cwd, state.connected]);
  useEffect(() => {
    if (state.connected && cwd) { send({ _tag: "models", cwd }); send({ _tag: "trust", cwd }); }
  }, [cwd, state.connected, state.catalogRevision, send]);
  const effectiveModel = model || catalog?.defaultModel;
  const levels = levelsFor(catalog, effectiveModel);
  const effectiveEffort = clampEffort(levels, effort || (catalog?.defaultThinkingLevel as ThinkingLevel | undefined) || "medium");
  const ready = state.connected && !!catalog && !catalog.error && cwd.trim().length > 0 && !!effectiveModel && (text.trim().length > 0 || attachments.items.length > 0) && !creating && !attachments.busy && !outcome?.archived;

  const submit = () => {
    if (!ready) return;
    writeStorage(LAST_DIR, cwd.trim());
    setCreating(true);
    send({ _tag: "create_session", cwd: cwd.trim(), outcomeProjectId, options: { model: effectiveModel, thinkingLevel: effectiveEffort }, text: text.trim(), attachments: attachments.items });
    setText("");
    attachments.clear();
  };

  return (
    <>
      {/* No header on this page; the sidebar sheet still needs its button on small screens. */}
      <Button variant="ghost" size="icon-sm" className="absolute top-2 left-2 md:hidden" aria-label="Show sidebar" onClick={onMenu}><PanelLeftOpenIcon /></Button>
      <div className="new-session-layout flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-14 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6 md:py-16">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col md:my-auto md:flex-none">
          <div className="new-session-welcome welcome-enter flex min-h-0 flex-1 flex-col items-center justify-center py-6 text-center md:mb-7 md:flex-none md:py-0">
            <PianoMark className="mb-5 hidden size-12 rounded-2xl md:inline-flex [&>span]:w-1 [&>span]:scale-y-125" />
            <h1 className="text-xl font-medium tracking-tight md:text-[2rem]">{outcome?.name ?? "What should we work on?"}</h1>
            {/* A project's goal is its only standing text, so it shows at every width; the tagline stays desktop-only. */}
            <p className={cn("mt-2 text-base text-ink-2", !outcome?.goal && "hidden md:block")}>{outcome?.goal || "A little progress starts with an idea."}</p>
          </div>
          <div className="shrink-0">
            {/* Left: where the session runs, with that directory's trust beside it. Right: which project it joins. */}
            <div className="mb-2 flex min-w-0 items-center gap-1">
              <div className="min-w-0 shrink">
                <DirectorySelect state={state} value={cwd} onChange={setCwd} onBrowse={() => setPickerOpen(true)} send={send} />
              </div>
              {trust?.required && (
                <TrustToggle trusted={trust.trusted} onChange={trusted => send({ _tag: "set_trust", path: cwd, trusted })} />
              )}
              <ProjectSelect state={state} value={outcomeProjectId} onChange={onProjectChange} onCreate={onNewProject} />
            </div>
            <div className={cn(composerCard, "welcome-enter welcome-composer")} {...attachmentEvents(attachments, creating || !state.connected)}>
              <AttachmentDraftView draft={attachments} disabled={creating || !state.connected} />
              <SlashTextarea
                ref={textarea}
                completion={state.connected && !creating ? { cwd, revision: `${trust?.trusted}:${catalog?.fetchedAt}` } : undefined}
                autoFocus={!window.matchMedia("(pointer: coarse)").matches}
                value={text}
                rows={1}
                aria-label="First message"
                className={cn(composerInput, "new-session-input md:max-h-[min(18rem,30dvh)] md:min-h-28 md:pt-5")}
                onValueChange={setText}
                onKeyDown={(e) => {
                  if (isSendKey(e)) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <div className={composerToolbar}>
                <AttachButton draft={attachments} disabled={creating || !state.connected} />
                <ModelSelect catalog={catalog} onRefresh={cwd ? () => send({ _tag: "models", cwd, refresh: true }) : undefined} value={model} onChange={setModel} effort={effectiveEffort} onEffortChange={setEffort} noDirectory={!cwd} />
                <Button size="icon" className={composerAction} aria-label="Send" disabled={!ready} onClick={submit}>
                  <span key={creating ? "busy" : "send"} className="control-enter inline-flex">{creating ? <Spinner /> : <ArrowUpIcon />}</span>
                </Button>
              </div>
            </div>
            {project?.discovery.status === "error" && (
              <Alert variant="destructive" className="mt-2 animate-in fade-in-0 slide-in-from-top-1">
                <AlertDescription>Git status unavailable. Open Worktrees to inspect and refresh.</AlertDescription>
              </Alert>
            )}
            {outcome?.archived && (
              <Alert className="mt-2 animate-in fade-in-0 slide-in-from-top-1">
                <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>This project is archived.</span>
                  <Button variant="link" size="sm" className="h-auto p-0" disabled={!state.connected} onClick={() => { if (outcome) send({ _tag: "archive_outcome_project", id: outcome.id, archived: false }); }}>Unarchive project</Button>
                </AlertDescription>
              </Alert>
            )}
            {creating && <p className="sr-only" role="status">Starting Pi</p>}
          </div>
        </div>
      </div>
      <FolderPicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={(path) => setCwd(path)} initialPath={cwd || undefined} />
    </>
  );
}

/** Which project the new session joins: the same searchable picker as the directory beside it, and the place to create the first one. */
function ProjectSelect({ state, value, onChange, onCreate }: { state: AppState; value?: string; onChange: (id?: string) => void; onCreate: () => void }) {
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const current = value ? state.outcomeProjects.find(p => p.id === value) : undefined;
  const choices = activeProjects(state);
  if (current?.archived) choices.push(current);
  const pick = (id?: string) => { onChange(id); setOpen(false); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" role="combobox" aria-expanded={open} aria-label="Project" className={cn(picker, "ml-auto max-w-[45%] shrink-0", current ? "text-ink-2" : "text-ink-3")} title={current?.goal || current?.name}>
          <TargetIcon className="text-ink-3" />
          <span className="truncate">{current ? current.name : "Project"}</span>
        </Button>
      </PopoverTrigger>
      <PickerContent align="end" aria-label="Choose a project" searchRef={search}>
        {choices.length === 0 ? (
          // Before the first project exists there is nothing to search; the page invites creating one instead.
          <Empty className="p-6 md:p-6">
            <EmptyHeader>
              <EmptyDescription>No projects yet. A project groups sessions from any folders around one outcome.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" disabled={!state.connected} onClick={() => { setOpen(false); onCreate(); }}><PlusIcon /> New project</Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Command>
            <PickerSearch ref={search} aria-label="Search projects" placeholder="Search projects">
              <Button variant="ghost" size="icon-sm" aria-label="New project" title="New project" disabled={!state.connected} onClick={() => { setOpen(false); onCreate(); }}>
                <PlusIcon aria-hidden />
              </Button>
            </PickerSearch>
            <CommandList className="max-h-[min(18rem,60dvh)]">
              <CommandEmpty>No project matches.</CommandEmpty>
              <CommandGroup>
                {choices.map(p => (
                  <CommandItem key={p.id} value={p.id} keywords={[p.name]} onSelect={() => pick(p.id)}>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {p.archived && <span className="text-xs text-ink-3">Archived</span>}
                    <PickerCheck selected={p.id === value} />
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem value="__none" keywords={["none", "no project"]} onSelect={() => pick(undefined)}>
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

/** Shown only for directories with `.pi` resources or `.agents/skills`, which Pi loads only when trusted. */
/** Pi's trust outcome for a directory: the latest probe, else what discovery recorded for a known worktree. */
export function directoryTrust(state: AppState, cwd: string) {
  return state.trusts[cwd] ?? state.projects.flatMap(p => p.worktrees).find(w => w.path === cwd)?.trust;
}

function TrustToggle({ trusted, onChange }: { trusted: boolean; onChange: (trusted: boolean) => void }) {
  return (
    <Button
      variant="ghost" size="sm" aria-pressed={trusted} aria-label="Directory trust"
      className={cn(picker, "shrink-0", trusted ? "text-ink-3" : "text-ink-2")}
      title={trusted ? "Pi loads this folder's .pi settings, extensions and skills. Click to untrust." : "Pi skips this folder's .pi settings, extensions and skills. Click to trust."}
      onClick={() => onChange(!trusted)}
    >
      {trusted ? <ShieldCheckIcon /> : <ShieldOffIcon />}
      <span className="max-[360px]:hidden">{trusted ? "Trusted" : "Untrusted"}</span>
    </Button>
  );
}

/** Project roots plus Browse and Worktrees escape hatches; a selected worktree is still named by project and branch. */
function DirectorySelect({ state, value, onChange, onBrowse, send }: { state: AppState; value: string; onChange: (cwd: string) => void; onBrowse: () => void; send: (m: ClientMessage) => void }) {
  const [open, setOpen] = useState(false);
  const [wtOpen, setWtOpen] = useState(false);
  const [wtPending, setWtPending] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const known = state.projects.flatMap((p) => p.worktrees.map((w) => ({ project: p.name, ...w })));
  const current = known.find((k) => k.path === value);
  const roots = known.filter((k) => k.root);
  return (
    <Popover open={open} onOpenChange={next => {
      if (wtPending) return;
      setOpen(next);
      if (!next) setWtOpen(false);
    }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" role="combobox" aria-expanded={open} aria-label="Directory" className={cn(picker, "w-full min-w-0 max-w-none justify-start")} title={value}>
          <FolderIcon className="text-ink-3" />
          {!value ? (
            <span>Choose a folder</span>
          ) : current ? (
            <>
              <span className="truncate font-mono">{current.project}</span>
              {!current.root && <BranchLabel branch={current.branch ?? (current.facts?.detached ? "Detached" : "Unknown branch")} className="text-ink-3" />}
            </>
          ) : (
            <span className="truncate font-mono">{abbrevHome(value)}</span>
          )}
        </Button>
      </PopoverTrigger>
      {wtOpen ? <WorktreesPopover
        onOpenChange={next => {
          setOpen(next);
          if (!next) { setWtOpen(false); setWtPending(false); }
        }}
        onPendingChange={setWtPending} state={state} currentCwd={value} send={send} onSelect={onChange}
      /> : <PickerContent aria-label="Choose a folder" searchRef={search}>
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
                    keywords={[k.project]}
                    disabled={k.status === "missing"}
                    onSelect={() => {
                      onChange(k.path);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{k.project}</span>
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
                  }}
                >
                  <GitBranchPlusIcon /> Worktrees
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PickerContent>}
    </Popover>
  );
}
