import type { ClientCommand as ClientMessage, ThinkingLevel } from "@shared/wire";
import { cn } from "cn";
import { ArrowUpIcon, CheckIcon, FolderIcon, FolderOpenIcon, GitBranchIcon, GitBranchPlusIcon, PanelLeftOpenIcon, ShieldCheckIcon, ShieldOffIcon, TargetIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AttachButton, AttachmentDraftView, attachmentEvents, useAttachments } from "@/components/Attachments";
import { clampEffort, levelsFor } from "@/components/EffortSelect";
import { FolderPicker } from "@/components/FolderPicker";
import { ModelSelect } from "@/components/ModelSelect";
import { activeProjects } from "@/components/OutcomeProjects";
import { PianoMark } from "@/components/PianoMark";
import { SlashTextarea } from "@/components/SlashTextarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { WorktreesPopover } from "@/components/Worktrees";
import { abbrevHome } from "@/lib/format";
import { composerAction, composerCard, composerInput, composerToolbar, picker } from "@/lib/styles";
import { useTypeToFocus } from "@/lib/typeToFocus";
import type { AppState } from "@/store";

interface Props {
  state: AppState;
  send: (m: ClientMessage) => void;
  initialCwd?: string;
  /** The project a session started here joins; the page is that project's home. */
  outcomeProjectId?: string;
  onProjectChange: (outcomeProjectId?: string) => void;
  onMenu: () => void;
}

const LAST_DIR = "piano.lastDir";

/** New session: a composer. The first prompt creates the session in the chosen directory with the chosen model and effort. */
export function NewSession({ state, send, initialCwd, outcomeProjectId, onProjectChange, onMenu }: Props) {
  const [cwd, setCwd] = useState(() => {
    if (initialCwd) return initialCwd;
    if (outcomeProjectId) return "";
    try {
      return localStorage.getItem(LAST_DIR) ?? "";
    } catch {
      return "";
    }
  });
  const [text, setText] = useState("");
  const attachments = useAttachments("new-session");
  const [model, setModel] = useState<string | undefined>(undefined);
  const [effort, setEffort] = useState<ThinkingLevel | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialCwd) setCwd(initialCwd);
  }, [initialCwd]);
  // A session for a project starts from an explicit directory choice, never a remembered or default one.
  const [explicit, setExplicit] = useState(!!initialCwd);
  useEffect(() => {
    if (outcomeProjectId && !explicit) setCwd("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomeProjectId]);
  const chooseCwd = useCallback((next: string) => { setExplicit(true); setCwd(next); }, []);
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 288)}px`;
  }, [text]);
  useTypeToFocus(textarea, useCallback((s: string) => setText((t) => t + s), []));
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
  const trust = state.trusts[cwd] ?? project?.worktrees.find(w => w.path === cwd)?.trust;
  const catalog = state.catalogs[cwd] ?? null;
  useEffect(() => {
    setModel(undefined); setEffort(undefined);
    if (state.connected && cwd) { send({ _tag: "models", cwd }); send({ _tag: "trust", cwd }); }
  }, [cwd, state.connected, send]);
  const effectiveModel = model || catalog?.defaultModel;
  const levels = levelsFor(catalog, effectiveModel);
  const effectiveEffort = clampEffort(levels, effort || (catalog?.defaultThinkingLevel as ThinkingLevel | undefined) || "medium");
  const ready = state.connected && cwd.trim().length > 0 && !!effectiveModel && (text.trim().length > 0 || attachments.items.length > 0) && !creating && !attachments.busy && !outcome?.archived;

  const submit = () => {
    if (!ready) return;
    try {
      localStorage.setItem(LAST_DIR, cwd.trim());
    } catch {
      /* ignore */
    }
    setCreating(true);
    send({ _tag: "create_session", cwd: cwd.trim(), outcomeProjectId, options: { model: effectiveModel, thinkingLevel: effectiveEffort }, text: text.trim(), attachments: attachments.items });
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
            <div className="mb-2 flex min-w-0 items-center gap-1">
              <div className="min-w-0 flex-1">
                <DirectorySelect state={state} value={cwd} onChange={chooseCwd} onBrowse={() => setPickerOpen(true)} send={send} />
              </div>
              {(outcome || activeProjects(state).length > 0) && <ProjectSelect state={state} value={outcomeProjectId} onChange={onProjectChange} />}
              {trust?.required && (
                <TrustToggle trusted={trust.trusted} onChange={trusted => send({ _tag: "set_trust", path: cwd, trusted })} />
              )}
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
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing &&
                      e.nativeEvent.keyCode !== 229 && !e.repeat && !window.matchMedia("(pointer: coarse)").matches) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <div className={composerToolbar}>
                <AttachButton draft={attachments} disabled={creating || !state.connected} />
                <ModelSelect catalog={catalog} onRefresh={cwd ? () => send({ _tag: "models", cwd, refresh: true }) : undefined} value={model} onChange={setModel} effort={effectiveEffort} onEffortChange={setEffort} />
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
                <AlertDescription>This project is archived. Reopen it from its menu in the sidebar to start sessions here.</AlertDescription>
              </Alert>
            )}
            {creating && <p className="sr-only" role="status">Starting Pi</p>}
          </div>
        </div>
      </div>
      <FolderPicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={chooseCwd} initialPath={cwd || undefined} />
    </>
  );
}

/** Which project the new session joins. Present only once a project exists, so the page stays as it was before. */
function ProjectSelect({ state, value, onChange }: { state: AppState; value?: string; onChange: (id?: string) => void }) {
  const current = value ? state.outcomeProjects.find(p => p.id === value) : undefined;
  const choices = activeProjects(state);
  if (current?.archived) choices.push(current);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Project" className={cn(picker, "h-11 max-w-[45%] shrink-0 md:h-8", current ? "text-ink-2" : "text-ink-3")} title={current?.goal || current?.name}>
          <TargetIcon className="text-ink-3" />
          <span className="truncate">{current ? current.name : "Project"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={id => onChange(id || undefined)}>
          {choices.map(p => <DropdownMenuRadioItem key={p.id} value={p.id}><span className="truncate">{p.name}</span>{p.archived && <span className="ml-1 text-muted-foreground">· Archived</span>}</DropdownMenuRadioItem>)}
          <DropdownMenuRadioItem value="">None</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Shown only for directories with `.pi` resources or `.agents/skills`, which Pi loads only when trusted. */
function TrustToggle({ trusted, onChange }: { trusted: boolean; onChange: (trusted: boolean) => void }) {
  return (
    <Button
      variant="ghost" size="sm" aria-pressed={trusted} aria-label="Directory trust"
      className={cn(picker, "h-11 shrink-0 md:h-8", trusted ? "text-ink-3" : "text-ink-2")}
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
  const content = useRef<HTMLDivElement>(null);
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
        <Button variant="ghost" size="sm" role="combobox" aria-expanded={open} aria-label="Directory" className={cn(picker, "h-11 w-full min-w-0 max-w-none justify-start md:h-8")} title={value}>
          <FolderIcon className="text-ink-3" />
          {!value ? (
            <span>Choose a directory</span>
          ) : current ? (
            <>
              <span className="truncate font-mono">{current.project}</span>
              {!current.root && (
                <span className="inline-flex min-w-0 items-center gap-1 font-mono text-ink-3">
                  <GitBranchIcon />
                  <span className="truncate">{current.branch ?? (current.facts?.detached ? "Detached" : "Unknown branch")}</span>
                </span>
              )}
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
      /> : <PopoverContent ref={content} align="start" tabIndex={-1} aria-label="Choose a directory"
        className="max-h-(--radix-popover-content-available-height) w-[380px] max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
        onOpenAutoFocus={event => {
          event.preventDefault();
          if (window.matchMedia("(pointer: coarse)").matches) content.current?.focus({ preventScroll: true });
          else search.current?.focus({ preventScroll: true });
        }}>
        <Command>
          <CommandInput ref={search} aria-label="Search directories" placeholder="Search directories" />
          <CommandList className="max-h-[min(18rem,60dvh)]">
            <CommandEmpty>No directory matches.</CommandEmpty>
            {roots.length > 0 && (
              <CommandGroup heading="Directories">
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
                    <CheckIcon className={cn("ml-auto", k.path === value ? "opacity-100" : "opacity-0")} />
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
              {state.projects.length > 0 && (
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
      </PopoverContent>}
    </Popover>
  );
}
