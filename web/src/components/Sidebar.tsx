import { useEffect, useState } from "react";
import { ArchiveIcon, ChevronRightIcon, GitBranchIcon, MoreHorizontalIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import type { ClientCommand as ClientMessage, ProjectView } from "@shared/wire";
import { type AppState, sessionKey } from "@/store";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
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
      <ScrollArea className="min-h-0 flex-1">
      <nav className="px-3 pb-4" aria-label="Projects">
        {state.projects.length === 0 && (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyDescription>No projects yet. Start a session in any directory and it becomes a project here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        <div className="flex flex-col gap-3">
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
      </ScrollArea>
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
  const [renaming, setRenaming] = useState<{ cwd: string; sessionId: string; title: string } | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const startRename = (t: { cwd: string; sessionId: string; title?: string }) => {
    setDraftTitle(t.title ?? "");
    setRenaming({ cwd: t.cwd, sessionId: t.sessionId, title: t.title || "Untitled" });
  };
  const canRename = !!renaming && draftTitle.trim().length > 0 && draftTitle.trim() !== (renaming.title === "Untitled" ? "" : renaming.title);
  const commitRename = () => {
    if (!renaming || !canRename) return;
    send({ _tag: "rename_session", cwd: renaming.cwd, sessionId: renaming.sessionId, title: draftTitle.trim() });
    setRenaming(null);
  };

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
      {project.discovery.status === "error" && <Badge variant="destructive" className="ml-7 animate-in fade-in-0" title={project.discovery.detail}>Git status unavailable</Badge>}
      {project.discovery.status === "non-git" && <Badge variant="secondary" className="ml-7">Non-Git</Badge>}
      <CollapsibleContent className="disclosure-content">
        {project.sessions.length === 0 && <p className="py-2 pl-7 text-sm text-muted-foreground">No sessions yet</p>}
        <ul className="flex flex-col gap-1 py-1">
          {project.sessions.map((t) => {
            const selected = current?.cwd === t.cwd && current.sessionId === t.sessionId;
            // Live host state comes from the `hosts` broadcast, which changes more often than the project list.
            const host = state.hosts.find((h) => h.cwd === t.cwd && h.sessionId === t.sessionId);
            const done = state.done.includes(sessionKey(t));
            // Herdr's dots: yellow working, teal done, hollow green idle, nothing when no process.
            const dot = host?.streaming ? "animate-live bg-busy" : done ? "bg-done" : host ? "border border-ok" : null;
            // The branch is only news when the session runs somewhere other than the project root.
            const inWorktree = !project.worktrees.some((w) => w.root && w.path === t.cwd);
            // The same three actions sit behind a right-click (or long press) and the row's "…" button.
            const actions = <>
              <ContextMenuItem onClick={() => startRename(t)}><PencilIcon /> Rename</ContextMenuItem>
              <ContextMenuItem onClick={() => send({ _tag: "archive_session", cwd: t.cwd, sessionId: t.sessionId })}><ArchiveIcon /> Archive</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onClick={() => setDeleting({ cwd: t.cwd, sessionId: t.sessionId, title: t.title || "Untitled" })}><Trash2Icon /> Delete</ContextMenuItem>
            </>;
            return (
              <ContextMenu key={t.sessionId}>
                <ContextMenuTrigger asChild>
                  <li className={cn("group relative flex h-9 animate-in items-center rounded-lg pr-1 transition-[background-color,box-shadow] duration-150 fade-in-0 slide-in-from-left-1 after:absolute after:inset-y-2.5 after:left-0 after:w-0.5 after:rounded-full after:bg-brand after:opacity-0 after:transition-opacity after:duration-150 hover:bg-fill-hover", selected && "bg-conversation shadow-1 after:opacity-100")}>
                    <button
                      type="button"
                      title={t.title || t.sessionId}
                      aria-current={selected ? "page" : undefined}
                      onClick={() => select(t.cwd, t.sessionId)}
                      className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pl-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    >
                      <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
                        {dot && <span className={cn("size-2 rounded-full transition-[background-color,border-color] duration-300", dot)} />}
                      </span>
                      <span className={cn("min-w-0 flex-1 truncate", selected && "font-medium", !t.title && "text-ink-3")}>{t.title || "Untitled"}</span>
                      {t.branch && inWorktree && (
                        <span className="flex max-w-[38%] shrink-0 items-center gap-1 truncate font-mono text-sm text-ink-3">
                          <GitBranchIcon className="size-3 shrink-0" aria-hidden />
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
                        <DropdownMenuItem onClick={() => startRename(t)}>
                          <PencilIcon /> Rename
                        </DropdownMenuItem>
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
                </ContextMenuTrigger>
                <ContextMenuContent aria-label={`Session actions for ${t.title || t.sessionId}`}>{actions}</ContextMenuContent>
              </ContextMenu>
            );
          })}
        </ul>
      </CollapsibleContent>
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <form onSubmit={(e) => { e.preventDefault(); commitRename(); }} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Rename session</DialogTitle>
              <DialogDescription>The new name shows in the sidebar; Pi's history is unchanged.</DialogDescription>
            </DialogHeader>
            <Input aria-label="Session name" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} autoFocus onFocus={(e) => e.target.select()} maxLength={200} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>Cancel</Button>
              <Button type="submit" disabled={!canRename}>Rename</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
