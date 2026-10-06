import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpIcon, CheckIcon, ChevronDownIcon, FolderIcon, FolderOpenIcon, GitBranchIcon, GitBranchPlusIcon, LoaderCircleIcon, PanelLeftOpenIcon } from "lucide-react";
import type { ClientCommand as ClientMessage, ThinkingLevel } from "@shared/wire";
import type { AppState } from "@/store";
import { abbrevHome } from "@/lib/format";
import { composerAction, composerCard, composerInput, composerToolbar, picker } from "@/lib/styles";
import { useTypeToFocus } from "@/lib/typeToFocus";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WorktreesDialog } from "@/components/Worktrees";
import { Textarea } from "@/components/ui/textarea";
import { clampEffort, levelsFor } from "@/components/EffortSelect";
import { FolderPicker } from "@/components/FolderPicker";
import { ModelSelect } from "@/components/ModelSelect";
import { AttachButton, AttachmentDraftView, attachmentEvents, useAttachments } from "@/components/Attachments";
import { PianoMark } from "@/components/PianoMark";

interface Props {
  state: AppState;
  send: (m: ClientMessage) => void;
  initialCwd?: string;
  onMenu: () => void;
}

const LAST_DIR = "piano.lastDir";

/** New session: a composer. The first prompt creates the session in the chosen directory with the chosen model and effort. */
export function NewSession({ state, send, initialCwd, onMenu }: Props) {
  const [cwd, setCwd] = useState(() => {
    if (initialCwd) return initialCwd;
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
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 288)}px`;
  }, [text]);
  useTypeToFocus(textarea, useCallback((s: string) => setText((t) => t + s), []));
  // Fall back to the first known project when nothing is remembered.
  useEffect(() => {
    if (!cwd && state.projects[0]) setCwd(state.projects[0].path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.projects.length]);
  useEffect(() => {
    if (!creating) return;
    const t = setTimeout(() => setCreating(false), 15000);
    return () => clearTimeout(t);
  }, [creating]);

  const project = state.projects.find(p => p.worktrees.some(w => w.path === cwd));
  const catalog = state.catalogs[cwd] ?? null;
  useEffect(() => {
    setModel(undefined); setEffort(undefined);
    if (state.connected && cwd) send({ _tag: "models", cwd });
  }, [cwd, state.connected, send]);
  const effectiveModel = model || catalog?.defaultModel;
  const levels = levelsFor(catalog, effectiveModel);
  const effectiveEffort = clampEffort(levels, effort || (catalog?.defaultThinkingLevel as ThinkingLevel | undefined) || "medium");
  const ready = state.connected && cwd.trim().length > 0 && !!effectiveModel && (text.trim().length > 0 || attachments.items.length > 0) && !creating && !attachments.busy;

  const submit = () => {
    if (!ready) return;
    try {
      localStorage.setItem(LAST_DIR, cwd.trim());
    } catch {
      /* ignore */
    }
    setCreating(true);
    send({ _tag: "create_session", cwd: cwd.trim(), options: { model: effectiveModel, thinkingLevel: effectiveEffort }, text: text.trim(), attachments: attachments.items });
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
            <h1 className="text-xl font-medium tracking-tight md:text-[2rem]">What should we work on?</h1>
            <p className="mt-2 hidden text-base text-ink-2 md:block">A little progress starts with an idea.</p>
          </div>
          <div className="shrink-0">
            <div className="mb-2 min-w-0">
              <DirectorySelect state={state} value={cwd} onChange={setCwd} onBrowse={() => setPickerOpen(true)} send={send} />
            </div>
            <div className={cn(composerCard, "welcome-enter welcome-composer")} {...attachmentEvents(attachments, creating || !state.connected)}>
              <AttachmentDraftView draft={attachments} disabled={creating || !state.connected} />
              <Textarea
                ref={textarea}
                autoFocus={!window.matchMedia("(pointer: coarse)").matches}
                value={text}
                rows={1}
                aria-label="First message"
                className={cn(composerInput, "new-session-input md:max-h-[min(18rem,30dvh)] md:min-h-28 md:pt-5")}
                onChange={(e) => setText(e.target.value)}
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
                <ModelSelect catalog={catalog} value={model} onChange={setModel} effort={effectiveEffort} onEffortChange={setEffort} />
                <Button size="icon" className={composerAction} aria-label="Send" disabled={!ready} onClick={submit}>
                  {creating ? <LoaderCircleIcon className="animate-spin" /> : <ArrowUpIcon />}
                </Button>
              </div>
            </div>
            {project?.discovery.status === "error" && <p role="alert" className="mt-2 text-sm text-err">Git status unavailable. Open Worktrees to inspect and refresh.</p>}
            {creating && <p className="sr-only" role="status">Starting Pi</p>}
          </div>
        </div>
      </div>
      <FolderPicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={(path) => setCwd(path)} initialPath={cwd || undefined} />
    </>
  );
}

/** Known directories (project roots and their worktrees) plus a Browse escape hatch. */
function DirectorySelect({ state, value, onChange, onBrowse, send }: { state: AppState; value: string; onChange: (cwd: string) => void; onBrowse: () => void; send: (m: ClientMessage) => void }) {
  const [open, setOpen] = useState(false);
  const [wtOpen, setWtOpen] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const known = state.projects.flatMap((p) => p.worktrees.map((w) => ({ project: p.name, ...w })));
  const current = known.find((k) => k.path === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" role="combobox" aria-expanded={open} aria-label="Directory" className={cn(picker, "h-11 w-full min-w-0 max-w-none justify-start md:h-8")} title={value}>
          <FolderIcon className="size-3.5 shrink-0 text-ink-3" />
          {!value ? (
            <span>Choose a directory</span>
          ) : current ? (
            <>
              <span className="truncate">{current.project}</span>
              {!current.root && (
                <span className="inline-flex min-w-0 items-center gap-1 font-mono text-ink-3">
                  <GitBranchIcon className="size-3 shrink-0" />
                  <span className="truncate">{current.branch ?? (current.facts?.detached ? "Detached" : "Unknown branch")}</span>
                </span>
              )}
            </>
          ) : (
            <span className="truncate font-mono">{abbrevHome(value)}</span>
          )}
          <ChevronDownIcon className="size-3.5 text-ink-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent ref={content} align="start" tabIndex={-1} aria-label="Choose a directory"
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
            {known.length > 0 && (
              <CommandGroup heading="Projects">
                {known.map((k) => (
                  <CommandItem
                    key={k.path}
                    value={k.path}
                    keywords={[k.project, k.branch ?? ""]}
                    disabled={k.status === "missing"}
                    onSelect={() => {
                      onChange(k.path);
                      setOpen(false);
                    }}
                  >
                    <CheckIcon className={cn("size-4 shrink-0", k.path === value ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1 truncate">
                      {k.project}
                      {!k.root && (
                        <span className="ml-2 inline-flex items-center gap-1 font-mono text-ink-2"><GitBranchIcon className="size-3" />{k.branch ?? (k.facts?.detached ? "Detached" : "Unknown branch")}</span>
                      )}
                    </span>
                    <span className="max-w-[150px] truncate font-mono text-ink-3">{abbrevHome(k.path)}</span>
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
                <FolderOpenIcon /> Browse for a directory
              </CommandItem>
              {state.projects.length > 0 && (
                <CommandItem
                  value="__worktree"
                  onSelect={() => {
                    setOpen(false);
                    setWtOpen(true);
                  }}
                >
                  <GitBranchPlusIcon /> Worktrees
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
      <WorktreesDialog open={wtOpen} onOpenChange={setWtOpen} state={state} currentCwd={value} send={send} onSelect={onChange} />
    </Popover>
  );
}
