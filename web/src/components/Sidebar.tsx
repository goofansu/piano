import { useEffect, useState } from "react";
import { ArchiveIcon, ChevronRightIcon, GitBranchIcon, MoreHorizontalIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import type { ClientCommand as ClientMessage, ProjectView } from "@shared/wire";
import { type AppState, sessionKey } from "@/store";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PianoMark } from "@/components/PianoMark";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface Props {
  state: AppState;
  send: (m: ClientMessage) => void;
  select: (cwd: string, sessionId: string | null) => void;
  openNew: (cwd?: string) => void;
  /** Hide the sidebar (or close the sheet it is shown in). */
  onHide: () => void;
}

const OPEN_KEY = "piano.openProjects";
const loadOpen = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
};

export function Sidebar({ state, send, select, openNew, onHide }: Props) {
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
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-4">
        <PianoMark />
        <span className="text-lg font-semibold tracking-tight">piano</span>
        <span className="flex-1" />
        <ThemeToggle />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Hide sidebar" onClick={onHide}>
              <PanelLeftCloseIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Hide sidebar</TooltipContent>
        </Tooltip>
      </div>
      <div className="px-3 pb-3">
        <Button variant="outline" className={cn("h-10 w-full justify-start rounded-xl border-line bg-conversation shadow-none", state.view.kind === "new" && !state.view.cwd && "border-brand/25 bg-brand-soft text-brand hover:bg-brand-soft")} onClick={() => openNew()}>
          <PlusIcon /> New session
        </Button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4" aria-label="Projects">
        {state.projects.length === 0 && (
          <p className="px-2 py-8 text-center text-sm text-ink-2">No projects yet. Start a session in any directory and it becomes a project here.</p>
        )}
        <div className="space-y-3">
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
      </nav>
    </div>
  );
}

/** The collapsed sidebar: a vertical rail with the two things you still reach for. */
export function SidebarRail({ onShow, onNew }: { onShow: () => void; onNew: () => void }) {
  return (
    <div className="flex h-full flex-col items-center gap-1 pt-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Show sidebar" onClick={onShow}>
            <PanelLeftOpenIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Show sidebar</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="New session" onClick={onNew}>
            <PlusIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">New session</TooltipContent>
      </Tooltip>
    </div>
  );
}

interface ProjectProps extends Pick<Props, "send" | "select" | "state" | "openNew"> {
  project: ProjectView;
  current: { cwd: string; sessionId: string | null } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Row actions live in a fixed slot on the right and appear on hover, so nothing shifts. */
const hoverSlot = "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100";

function Project({ project, current, open, onOpenChange, state, send, select, openNew }: ProjectProps) {
  const [deleting, setDeleting] = useState<{ cwd: string; sessionId: string; title: string } | null>(null);

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="group flex h-9 items-center gap-1 rounded-lg pr-1 transition-colors hover:bg-fill-hover">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg pl-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            title={project.path}
          >
            <ChevronRightIcon className={cn("size-4 shrink-0 text-ink-3 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-2">{project.name}</span>
          </button>
        </CollapsibleTrigger>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className={hoverSlot}
              aria-label={`New session in ${project.name}`}
              onClick={() => openNew(project.path)}
            >
              <PlusIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New session here</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" className={hoverSlot} aria-label={`Project menu for ${project.name}`}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => send({ _tag: "remove_project", path: project.path })}>
              <XIcon /> Close project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {project.discovery.status === "error" && <p className="pl-7 text-xs text-err" title={project.discovery.detail}>Git status unavailable</p>}
      {project.discovery.status === "non-git" && <p className="pl-7 text-xs text-ink-3">Non-Git</p>}
      <CollapsibleContent className="disclosure-content">
        {project.sessions.length === 0 && <p className="py-2 pl-7 text-sm text-ink-3">No sessions yet</p>}
        <ul className="space-y-1 py-1">
          {project.sessions.map((t) => {
            const selected = current?.cwd === t.cwd && current.sessionId === t.sessionId;
            // Live host state comes from the `hosts` broadcast, which changes more often than the project list.
            const host = state.hosts.find((h) => h.cwd === t.cwd && h.sessionId === t.sessionId);
            const done = state.done.includes(sessionKey(t));
            // Herdr's dots: yellow working, teal done, hollow green idle, nothing when no process.
            const dot = host?.streaming ? "animate-live bg-busy" : done ? "bg-done" : host ? "border border-ok" : null;
            // The branch is only news when the session runs somewhere other than the project root.
            const inWorktree = !project.worktrees.some((w) => w.root && w.path === t.cwd);
            return (
              <li key={t.sessionId} className={cn("group relative flex h-9 items-center rounded-lg pr-1 transition-colors duration-150 hover:bg-fill-hover", selected && "bg-conversation shadow-1 after:absolute after:inset-y-2.5 after:left-0 after:w-0.5 after:rounded-full after:bg-brand")}>
                <button
                  type="button"
                  title={t.title || t.sessionId}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => select(t.cwd, t.sessionId)}
                  className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pl-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
                    {dot && <span className={cn("size-2 rounded-full", dot)} />}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate", selected && "font-medium", !t.title && "text-ink-3")}>{t.title || "Untitled"}</span>
                  {t.branch && inWorktree && (
                    <span className="flex max-w-[38%] shrink-0 items-center gap-1 truncate font-mono text-sm text-ink-3">
                      <GitBranchIcon className="size-3 shrink-0" />
                      <span className="truncate">{t.branch}</span>
                    </span>
                  )}
                  {host?.streaming ? <span className="sr-only">working</span> : done ? <span className="sr-only">done</span> : null}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs" className={hoverSlot} aria-label={`Session menu for ${t.title || t.sessionId}`}>
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => send({ _tag: "archive_session", cwd: t.cwd, sessionId: t.sessionId })}>
                      <ArchiveIcon /> Archive
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleting({ cwd: t.cwd, sessionId: t.sessionId, title: t.title || "Untitled" })}>
                      <Trash2Icon /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      </CollapsibleContent>
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete this session?</DialogTitle>
            <DialogDescription>
              "{deleting?.title}" and its transcript are removed from Pi's session store. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) send({ _tag: "delete_session", cwd: deleting.cwd, sessionId: deleting.sessionId });
                setDeleting(null);
              }}
            >
              Delete session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Collapsible>
  );
}
