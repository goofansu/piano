import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, FolderIcon, FolderOpenIcon, GitBranchIcon, GitBranchPlusIcon, MenuIcon, SendHorizonalIcon } from "lucide-react";
import type { ClientMessage, ThinkingLevel } from "@shared/wire";
import type { AppState } from "@/store";
import { abbrevHome } from "@/lib/format";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FolderPicker } from "@/components/FolderPicker";
import { ModelSelect } from "@/components/ModelSelect";

interface Props {
  state: AppState;
  send: (m: ClientMessage) => void;
  initialCwd?: string;
  onMenu: () => void;
}

const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
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

  const effectiveModel = model || state.catalog?.defaultModel;
  const effectiveEffort = effort || (state.catalog?.defaultThinkingLevel as ThinkingLevel | undefined) || "medium";
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
      <header className="flex items-center gap-2 border-b bg-card px-3 py-2 text-xs text-muted-foreground">
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Menu" onClick={onMenu}><MenuIcon /></Button>
        <span className="font-semibold text-foreground">New</span>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-6">
        <div className="w-full max-w-2xl space-y-4">
          <h1 className="text-center text-xl font-semibold tracking-tight">What should we work on?</h1>
          <div className="rounded-xl border bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring">
            <Textarea
              ref={textarea}
              autoFocus
              value={text}
              rows={3}
              className="max-h-64 min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
              onChange={(e) => {
                setText(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 256)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <div className="flex flex-wrap items-center gap-1 px-2 pb-2 text-xs text-muted-foreground">
              <DirectorySelect state={state} value={cwd} onChange={setCwd} onBrowse={() => setPickerOpen(true)} send={send} />
              <ModelSelect catalog={state.catalog} value={model} onChange={setModel} />
              <Select value={effectiveEffort} onValueChange={(v) => setEffort(v as ThinkingLevel)}>
                <SelectTrigger className="h-7 gap-1 border-0 bg-transparent px-1.5 text-xs shadow-none" aria-label="Effort">
                  <SelectValue>{effectiveEffort}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {LEVELS.map((l) => (
                    <SelectItem key={l} value={l} className="flex items-center gap-2">
                      <span className="flex-1">{l}</span>
                      {l === state.catalog?.defaultThinkingLevel && <span className="text-[10px] text-muted-foreground">default</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="flex-1" />
              <Button size="icon" className="size-8" aria-label="Send" disabled={!ready} onClick={submit}>
                <SendHorizonalIcon />
              </Button>
            </div>
          </div>
          <p className="text-center text-[11px] text-muted-foreground">
            {creating ? "Starting pi…" : "Enter to send. A new directory becomes a project."}
          </p>
        </div>
      </div>
      <FolderPicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={(path) => setCwd(path)} initialPath={cwd || undefined} />
    </>
  );
}

/** Known directories (project roots and their worktrees) plus a Browse… escape hatch. */
function DirectorySelect({ state, value, onChange, onBrowse, send }: { state: AppState; value: string; onChange: (cwd: string) => void; onBrowse: () => void; send: (m: ClientMessage) => void }) {
  const [open, setOpen] = useState(false);
  const [wtOpen, setWtOpen] = useState(false);
  const known = state.projects.flatMap((p) => p.worktrees.map((w) => ({ project: p.name, path: w.path, branch: w.branch, main: w.main })));
  const current = known.find((k) => k.path === value);
  const label = !value ? "choose directory" : current ? (current.main ? current.project : `${current.project} · ${current.branch}`) : abbrevHome(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" role="combobox" aria-expanded={open} aria-label="Directory" className="h-7 max-w-[280px] gap-1 px-1.5 text-xs font-normal" title={value}>
          <FolderIcon className="size-3.5 shrink-0 opacity-70" />
          <span className="truncate">{label}</span>
          <ChevronDownIcon className="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] p-0">
        <Command>
          <CommandInput placeholder="Search directories…" autoFocus />
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
                    className="flex items-center gap-2"
                  >
                    <CheckIcon className={cn("size-3.5 shrink-0", k.path === value ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1 truncate">
                      {k.project}
                      {!k.main && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 text-muted-foreground"><GitBranchIcon className="size-3" />{k.branch}</span>
                      )}
                    </span>
                    <span className="max-w-[140px] truncate font-mono text-[10px] text-muted-foreground">{abbrevHome(k.path)}</span>
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
                <FolderOpenIcon className="size-3.5" /> Browse…
              </CommandItem>
              {state.projects.length > 0 && (
                <CommandItem
                  value="__worktree"
                  onSelect={() => {
                    setOpen(false);
                    setWtOpen(true);
                  }}
                >
                  <GitBranchPlusIcon className="size-3.5" /> New worktree…
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
          <DialogDescription>Runs `wt switch --create` in the project and starts the session there.</DialogDescription>
        </DialogHeader>
        <form
          id="new-worktree-form"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="wt-project">Project</label>
            <Select value={project} onValueChange={setProject}>
              <SelectTrigger id="wt-project" className="w-full text-sm"><SelectValue placeholder="project" /></SelectTrigger>
              <SelectContent>
                {state.projects.map((p) => <SelectItem key={p.path} value={p.path}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="wt-branch">Branch</label>
            <Input id="wt-branch" autoFocus value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="feature-name" className="font-mono text-sm" />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={hooks} onChange={(e) => setHooks(e.target.checked)} /> run worktrunk hooks
          </label>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="new-worktree-form" disabled={!branch.trim() || !project}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
