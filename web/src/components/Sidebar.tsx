import { useState } from "react";
import { FolderGitIcon, FolderPlusIcon, GitBranchPlusIcon, PlusIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { ClientMessage, ProjectView, WorktreeView } from "@shared/wire";
import type { AppState } from "@/store";
import { abbrevHome, relTime } from "@/lib/format";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FolderPicker } from "@/components/FolderPicker";
import { ThemeToggle } from "@/components/ThemeToggle";

interface Props {
  state: AppState;
  send: (m: ClientMessage) => void;
  select: (cwd: string, sessionId: string | null) => void;
}

export function Sidebar({ state, send, select }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const current = state.thread ?? state.selecting;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <span className="text-base font-semibold tracking-tight">piano</span>
        <span className="text-xs text-muted-foreground">pi threads</span>
        <span className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Refresh" onClick={() => send({ _tag: "projects" })}>
              <RefreshCwIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
        <ThemeToggle />
      </div>
      <div className="border-b p-2">
        <Button variant="outline" className="w-full justify-start" onClick={() => setPickerOpen(true)}>
          <FolderPlusIcon /> Add project…
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-2">
          {state.projects.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No projects yet. Use “Add project…”; git repos get worktree support via worktrunk.
            </p>
          )}
          {state.projects.map((p) => (
            <Project key={p.path} project={p} current={current} send={send} select={select} />
          ))}
        </div>
      </ScrollArea>
      <FolderPicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={(path) => send({ _tag: "add_project", path })} />
    </div>
  );
}

function Project({ project, current, send, select }: { project: ProjectView; current: { cwd: string; sessionId: string | null } | null } & Pick<Props, "send" | "select">) {
  const [wtOpen, setWtOpen] = useState(false);
  const [branch, setBranch] = useState("");
  const [hooks, setHooks] = useState(false);

  const create = () => {
    const b = branch.trim();
    if (!b) return;
    toast(`Creating worktree ${b}…`);
    send({ _tag: "create_worktree", project: project.path, branch: b, hooks });
    setBranch("");
    setWtOpen(false);
  };

  return (
    <section>
      <div className="flex items-center gap-1 px-1 py-1">
        <FolderGitIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold" title={project.path}>{project.name}</div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">{abbrevHome(project.path)}</div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" aria-label="New worktree" onClick={() => setWtOpen((v) => !v)}>
              <GitBranchPlusIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New worktree (wt switch --create)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              aria-label="Remove project"
              onClick={() => confirm(`Remove ${project.path} from piano? Nothing on disk is touched.`) && send({ _tag: "remove_project", path: project.path })}
            >
              <XIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove from piano</TooltipContent>
        </Tooltip>
      </div>
      {wtOpen && (
        <form
          className="mb-1 flex items-center gap-1 px-1"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <Input autoFocus placeholder="branch name" value={branch} onChange={(e) => setBranch(e.target.value)} className="h-8 text-xs" />
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <input type="checkbox" checked={hooks} onChange={(e) => setHooks(e.target.checked)} /> hooks
          </label>
          <Button type="submit" size="sm" variant="secondary">Create</Button>
        </form>
      )}
      {project.worktrees.map((wt) => (
        <Worktree key={wt.path} wt={wt} current={current} select={select} />
      ))}
    </section>
  );
}

function Worktree({ wt, current, select }: { wt: WorktreeView; current: { cwd: string; sessionId: string | null } | null; select: Props["select"] }) {
  const isSel = (id: string | null) => current?.cwd === wt.path && current.sessionId === id;
  return (
    <div className="ml-2">
      <div className="flex items-center gap-2 px-2 py-1 text-xs">
        <span className={cn("font-semibold", wt.main ? "text-emerald-600 dark:text-emerald-400" : "text-violet-600 dark:text-violet-400")}>
          {wt.branch || (wt.main ? "root" : "?")}
        </span>
        <span className="truncate font-mono text-[10px] text-muted-foreground" title={wt.path}>{abbrevHome(wt.path)}</span>
      </div>
      <button
        type="button"
        onClick={() => select(wt.path, null)}
        className={cn("flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs text-primary hover:bg-sidebar-accent", isSel(null) && "bg-sidebar-accent")}
      >
        <PlusIcon className="size-3" /> new thread
      </button>
      {wt.threads.map((t) => {
        const title = t.name || t.firstMessage || "";
        return (
          <button
            type="button"
            key={t.sessionId}
            title={t.sessionId}
            onClick={() => select(wt.path, t.sessionId)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-sidebar-accent",
              isSel(t.sessionId) && "bg-sidebar-accent",
            )}
          >
            {t.hosted && <span className={cn("size-2 shrink-0 rounded-full", t.streaming ? "animate-pulse bg-amber-500" : "bg-emerald-500")} />}
            <span className={cn("min-w-0 flex-1 truncate", !title && "italic text-muted-foreground")}>{title || "(empty thread)"}</span>
            {t.hosted && <Badge variant="outline" className="h-4 px-1 text-[9px]">live</Badge>}
            <span className="shrink-0 text-[10px] text-muted-foreground">{relTime(t.modified)}</span>
          </button>
        );
      })}
    </div>
  );
}
