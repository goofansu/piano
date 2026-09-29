import { useEffect, useState } from "react";
import { ArchiveIcon, ChevronRightIcon, FolderGitIcon, MoreHorizontalIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import type { ClientMessage, ProjectView } from "@shared/wire";
import type { AppState } from "@/store";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ThemeToggle";

interface Props {
  state: AppState;
  send: (m: ClientMessage) => void;
  select: (cwd: string, sessionId: string | null) => void;
  openNew: (cwd?: string) => void;
}

const OPEN_KEY = "piano.openProjects";
const loadOpen = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
};

export function Sidebar({ state, send, select, openNew }: Props) {
  const [openProjects, setOpenProjects] = useState<Set<string>>(loadOpen);
  const current = state.session ?? state.selecting;

  const setOpen = (path: string, open: boolean) =>
    setOpenProjects((prev) => {
      const next = new Set(prev);
      if (open) next.add(path);
      else next.delete(path);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });

  // The project holding the selected session is always visible.
  useEffect(() => {
    if (!current) return;
    const owner = state.projects.find((p) => p.worktrees.some((w) => w.path === current.cwd));
    if (owner && !openProjects.has(owner.path)) setOpen(owner.path, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.cwd, state.projects]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <span className="text-base font-semibold tracking-tight">piano</span>
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
        <Button variant="outline" className={cn("w-full justify-start", state.view.kind === "new" && "bg-sidebar-accent")} onClick={() => openNew()}>
          <PlusIcon /> New
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-2 p-2">
          {state.projects.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No projects yet. Start a session in any directory and it becomes a project here.
            </p>
          )}
          {state.projects.map((p) => (
            <Project
              key={p.path}
              project={p}
              current={current}
              open={openProjects.has(p.path)}
              onOpenChange={(open) => setOpen(p.path, open)}
              state={state}
              send={send}
              select={select}
              openNew={openNew}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface ProjectProps extends Pick<Props, "send" | "select" | "state" | "openNew"> {
  project: ProjectView;
  current: { cwd: string; sessionId: string | null } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Project({ project, current, open, onOpenChange, state, send, select, openNew }: ProjectProps) {
  const isNewSelected = state.view.kind === "new" && state.view.cwd === project.path;

  return (
    <section>
      <div className="flex items-center gap-1 px-1 py-1">
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md py-0.5 text-left hover:bg-sidebar-accent"
          title={project.path}
        >
          <ChevronRightIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          <FolderGitIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{project.name}</span>
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("size-7", isNewSelected && "bg-sidebar-accent")}
              aria-label={`New session in ${project.name}`}
              onClick={() => openNew(project.path)}
            >
              <PlusIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New session</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" aria-label={`Project menu for ${project.name}`}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              variant="destructive"
              onClick={() => confirm(`Remove ${project.path} from piano? Nothing on disk is touched.`) && send({ _tag: "remove_project", path: project.path })}
            >
              <Trash2Icon /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {open && project.sessions.length === 0 && <p className="px-3 py-1 text-xs italic text-muted-foreground">no sessions yet</p>}
      {open &&
        project.sessions.map((t) => {
          const selected = current?.cwd === t.cwd && current.sessionId === t.sessionId;
          // Live host state comes from the `hosts` broadcast, which changes more often than the project list.
          const host = state.hosts.find((h) => h.cwd === t.cwd && h.sessionId === t.sessionId);
          return (
            <div key={t.sessionId} className={cn("group ml-2 flex items-center gap-1 rounded-md pr-1 hover:bg-sidebar-accent", selected && "bg-sidebar-accent")}>
              <button
                type="button"
                title={`${t.branch || "root"} · ${t.sessionId}`}
                onClick={() => select(t.cwd, t.sessionId)}
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs"
              >
                {host && <span className={cn("size-2 shrink-0 rounded-full", host.streaming ? "animate-pulse bg-amber-500" : "bg-emerald-500")} />}
                <span className={cn("min-w-0 flex-1 truncate", !t.title && "italic text-muted-foreground")}>{t.title || "(empty session)"}</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" aria-label={`Session menu for ${t.title || t.sessionId}`}>
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => send({ _tag: "archive_session", cwd: t.cwd, sessionId: t.sessionId })}>
                    <ArchiveIcon /> Archive
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
    </section>
  );
}
