import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpIcon, CheckIcon, ChevronDownIcon, FolderIcon, FolderOpenIcon, GitBranchIcon, GitBranchPlusIcon, PanelLeftOpenIcon } from "lucide-react";
import type { ClientCommand as ClientMessage, ThinkingLevel } from "@shared/wire";
import type { AppState } from "@/store";
import { abbrevHome } from "@/lib/format";
import { composerCard, picker } from "@/lib/styles";
import { useTypeToFocus } from "@/lib/typeToFocus";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { clampEffort, EffortSelect, levelsFor } from "@/components/EffortSelect";
import { FolderPicker } from "@/components/FolderPicker";
import { ModelSelect } from "@/components/ModelSelect";

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
  // A worktree created from this page becomes the directory.
  useEffect(() => {
    if (state.lastWorktree) setCwd(state.lastWorktree.path);
  }, [state.lastWorktree]);
  useEffect(() => {
    if (!creating) return;
    const t = setTimeout(() => setCreating(false), 15000);
    return () => clearTimeout(t);
  }, [creating]);

  const catalog = state.catalogs[cwd] ?? null;
  useEffect(() => {
    setModel(undefined); setEffort(undefined);
    if (state.connected && cwd) send({ _tag: "models", cwd });
  }, [cwd, state.connected, send]);
  const effectiveModel = model || catalog?.defaultModel;
  const levels = levelsFor(catalog, effectiveModel);
  const effectiveEffort = clampEffort(levels, effort || (catalog?.defaultThinkingLevel as ThinkingLevel | undefined) || "medium");
  const ready = state.connected && cwd.trim().length > 0 && !!effectiveModel && text.trim().length > 0 && !creating;

  const submit = () => {
    if (!ready) return;
    try {
      localStorage.setItem(LAST_DIR, cwd.trim());
    } catch {
      /* ignore */
    }
    setCreating(true);
    send({ _tag: "create_session", cwd: cwd.trim(), options: { model: effectiveModel, thinkingLevel: effectiveEffort }, text: text.trim() });
  };

  return (
    <>
      {/* No header on this page; the sidebar sheet still needs its button on small screens. */}
      <Button variant="ghost" size="icon-sm" className="absolute top-2 left-2 md:hidden" aria-label="Show sidebar" onClick={onMenu}><PanelLeftOpenIcon /></Button>
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-16 md:px-6">
        <div className="w-full max-w-2xl">
          <h1 className="mb-5 text-2xl font-medium tracking-tight">What should we work on?</h1>
          <div className={composerCard}>
            <Textarea
              ref={textarea}
              autoFocus
              value={text}
              rows={3}
              aria-label="First message"
              placeholder="Describe the work. Pi starts in the directory below."
              className="max-h-72 min-h-24 resize-none border-0 bg-transparent px-4 pt-3.5 shadow-none focus-visible:ring-0"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing &&
                    e.nativeEvent.keyCode !== 229 && !e.repeat && !window.matchMedia("(pointer: coarse)").matches) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <div className="flex flex-wrap items-center gap-1 px-2.5 pb-2.5 text-sm text-ink-2">
              <DirectorySelect state={state} value={cwd} onChange={setCwd} onBrowse={() => setPickerOpen(true)} send={send} />
              <ModelSelect catalog={catalog} value={model} onChange={setModel} />
              <EffortSelect value={effectiveEffort} onChange={setEffort} levels={levels} defaultLevel={catalog?.defaultThinkingLevel} />
              <span className="flex-1" />
              <Button size="icon-sm" className="rounded-full" aria-label="Send" disabled={!ready} onClick={submit}>
                <ArrowUpIcon />
              </Button>
            </div>
          </div>
          {creating && (
            <p className="mt-3 text-sm text-ink-3" role="status">
              Starting Pi
            </p>
          )}
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
  const known = state.projects.flatMap((p) => p.worktrees.map((w) => ({ project: p.name, path: w.path, branch: w.branch, main: w.main })));
  const current = known.find((k) => k.path === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" role="combobox" aria-expanded={open} aria-label="Directory" className={picker} title={value}>
          <FolderIcon className="size-3.5 shrink-0 text-ink-3" />
          {!value ? (
            <span>Choose a directory</span>
          ) : current ? (
            <>
              <span className="truncate">{current.project}</span>
              {!current.main && (
                <span className="inline-flex min-w-0 items-center gap-1 font-mono text-ink-3">
                  <GitBranchIcon className="size-3 shrink-0" />
                  <span className="truncate">{current.branch}</span>
                </span>
              )}
            </>
          ) : (
            <span className="truncate font-mono">{abbrevHome(value)}</span>
          )}
          <ChevronDownIcon className="size-3.5 text-ink-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[380px] max-w-[calc(100vw-2rem)] p-0">
        <Command>
          <CommandInput placeholder="Search directories" autoFocus />
          <CommandList className="max-h-72">
            <CommandEmpty>No directory matches.</CommandEmpty>
            {known.length > 0 && (
              <CommandGroup heading="Projects">
                {known.map((k) => (
                  <CommandItem
                    key={k.path}
                    value={k.path}
                    keywords={[k.project, k.branch]}
                    onSelect={() => {
                      onChange(k.path);
                      setOpen(false);
                    }}
                  >
                    <CheckIcon className={cn("size-4 shrink-0", k.path === value ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1 truncate">
                      {k.project}
                      {!k.main && (
                        <span className="ml-2 inline-flex items-center gap-1 font-mono text-ink-2"><GitBranchIcon className="size-3" />{k.branch}</span>
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
                  <GitBranchPlusIcon /> New worktree
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
      <NewWorktreeDialog open={wtOpen} onOpenChange={setWtOpen} state={state} currentCwd={value} send={send} />
    </Popover>
  );
}

/** Create a worktree with worktrunk in one of the known projects; the result becomes the directory. */
function NewWorktreeDialog({ open, onOpenChange, state, currentCwd, send }: { open: boolean; onOpenChange: (o: boolean) => void; state: AppState; currentCwd: string; send: (m: ClientMessage) => void }) {
  const owner = state.projects.find((p) => p.worktrees.some((w) => w.path === currentCwd))?.path ?? state.projects[0]?.path ?? "";
  const [project, setProject] = useState(owner);
  const [branch, setBranch] = useState("");
  const [hooks, setHooks] = useState(false);
  useEffect(() => {
    if (open) setProject(owner);
  }, [open, owner]);
  const submit = () => {
    const b = branch.trim();
    if (!b || !project) return;
    send({ _tag: "create_worktree", project, branch: b, hooks });
    setBranch("");
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New worktree</DialogTitle>
          <DialogDescription>Creates a branch and checkout with worktrunk, then starts the session there.</DialogDescription>
        </DialogHeader>
        <form
          id="new-worktree-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-ink-2" htmlFor="wt-project">Project</label>
            <Select value={project} onValueChange={setProject}>
              <SelectTrigger id="wt-project" className="w-full"><SelectValue placeholder="Project" /></SelectTrigger>
              <SelectContent>
                {state.projects.map((p) => <SelectItem key={p.path} value={p.path}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-ink-2" htmlFor="wt-branch">Branch</label>
            <Input id="wt-branch" autoFocus value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="feature-name" className="font-mono text-sm" autoComplete="off" data-1p-ignore data-lpignore="true" data-bwignore="true" data-form-type="other" />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" className="size-4 accent-brand" checked={hooks} onChange={(e) => setHooks(e.target.checked)} /> Run worktrunk hooks
          </label>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="new-worktree-form" disabled={!branch.trim() || !project}>Create worktree</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
