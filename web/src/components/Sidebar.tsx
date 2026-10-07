import { useEffect, useState } from "react";
import { ArchiveIcon, ChevronRightIcon, GitBranchIcon, MoreHorizontalIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, TextCursorInputIcon, PlusIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import type { ClientCommand as ClientMessage, ProjectView } from "@shared/wire";
import { type AppState, sessionKey } from "@/store";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSessionActions } from "@/components/SessionActions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Keys, PianoMark } from "@/components/PianoMark";
import { Hint } from "@/components/Shortcut";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface Props {
  state: AppState;
  send: (m: ClientMessage) => void;
  select: (cwd: string, sessionId: string | null) => void;
  openNew: (cwd?: string) => void;
  /** Hide the sidebar (or close the sheet it is shown in). */
  onHide: () => void;
  /** Open the command palette. */
  onPalette: () => void;
}

const OPEN_KEY = "piano.openProjects";
const loadOpen = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
};

/** Row heights: 36px with a pointer, 44px on a touch screen. */
const row = "h-9 pointer-coarse:h-11";

export function Sidebar({ state, send, select, openNew, onHide, onPalette }: Props) {
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

  // First load is one orchestrated sequence: skeleton rows at once, then the real rows a beat
  // apart. The stagger applies only to that first reveal, not to every later list change.
  const [revealing, setRevealing] = useState(true);
  useEffect(() => {
    if (!state.projectsLoaded) return;
    const timer = setTimeout(() => setRevealing(false), 700);
    return () => clearTimeout(timer);
  }, [state.projectsLoaded]);
  const order = { i: 0 };
  const reveal = () => (revealing ? ({ "--i": String(order.i++) } as React.CSSProperties) : undefined);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-4">
        <PianoMark />
        <span className="text-lg font-semibold tracking-tight">Piano</span>
        <span className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Search sessions" onClick={onPalette}>
              <SearchIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent><Hint of={["mod", "K"]}>Search and commands</Hint></TooltipContent>
        </Tooltip>
        <ThemeToggle />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Hide sidebar" onClick={onHide}>
              <XIcon className="md:hidden" />
              <PanelLeftCloseIcon className="hidden md:block" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Hide sidebar</TooltipContent>
        </Tooltip>
      </div>
      <div className="px-3 pb-3">
        <Button
          variant="outline"
          className={cn("h-10 w-full justify-start rounded-xl border-line bg-conversation shadow-none transition-[background-color,border-color,color] duration-(--dur-hover)", state.view.kind === "new" && !state.view.cwd && "border-brand/25 bg-brand-soft text-brand hover:bg-brand-soft")}
          onClick={() => openNew()}
        >
          <PlusIcon /> New session
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
      <nav className="relative px-3 pb-4" aria-label="Projects">
        {!state.projectsLoaded ? (
          <SidebarSkeleton />
        ) : state.projects.length === 0 ? (
          <Empty className="view-enter py-8">
            <EmptyHeader>
              <EmptyDescription>No projects yet. Start a session in any directory and it becomes a project here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
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
              reveal={reveal}
            />
          ))}
        </div>
      </nav>
      </ScrollArea>
    </div>
  );
}

/** Skeleton rows in the real row geometry: a project line, two session lines, another project. */
function SidebarSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      {[0, 1].map((group) => (
        <div key={group} className="flex flex-col">
          <div className={cn(row, "flex items-center gap-1.5 pl-1.5")}>
            <Skeleton className="size-4 rounded-sm" />
            <Skeleton className={cn("h-3.5", group ? "w-16" : "w-24")} />
          </div>
          {group === 0 && (
            <ul className="flex flex-col gap-1 py-1">
              {[36, 44].map((w) => (
                <li key={w} className={cn(row, "flex items-center gap-2 pl-2")}>
                  <span className="flex size-4 items-center justify-center"><Skeleton className="size-2 rounded-full" /></span>
                  <Skeleton className="h-3.5" style={{ width: `${w}%` }} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

/** The collapsed sidebar: a vertical rail with the mark and the two things you still reach for. */
export function SidebarRail({ onShow, onNew, working }: { onShow: () => void; onNew: () => void; working: boolean }) {
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
      {/* With no rows in view, the mark itself says whether Pi is working somewhere. */}
      <div className="mt-auto pb-3">
        <PianoMark playing={working} className="size-6 rounded-md shadow-none" />
      </div>
    </div>
  );
}

interface ProjectProps extends Pick<Props, "send" | "select" | "state" | "openNew"> {
  project: ProjectView;
  current: { cwd: string; sessionId: string | null } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reveal: () => React.CSSProperties | undefined;
}

/** Row actions live in a fixed slot on the right and appear on hover, so nothing shifts. */
const hoverSlot = "opacity-0 transition-opacity duration-(--dur-hover) group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100";

function Project({ project, current, open, onOpenChange, state, send, select, openNew, reveal }: ProjectProps) {
  const actions = useSessionActions(send, state.connected);

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className={cn(row, "reveal-row group flex items-center gap-1 rounded-lg pr-1 transition-colors duration-(--dur-hover) hover:bg-fill-hover")} style={reveal()}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg pl-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            title={project.path}
          >
            <ChevronRightIcon className={cn("size-4 shrink-0 text-ink-3 transition-transform duration-(--dur-enter) ease-(--ease-enter) motion-reduce:transition-none", open && "rotate-90")} />
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
            const checkoutMissing = state.session?.cwd === t.cwd && state.session.state.checkoutMissing;
            // Live host state comes from the `hosts` broadcast, which changes more often than the project list.
            const host = state.hosts.find((h) => h.cwd === t.cwd && h.sessionId === t.sessionId);
            const done = state.done.includes(sessionKey(t));
            // The keys play while the session works; afterwards Herdr's dots: teal done, hollow green idle, nothing when no process.
            const dot = done ? "bg-done" : host ? "border border-ok" : null;
            // The branch is only news when the session runs somewhere other than the project root.
            const inWorktree = !project.worktrees.some((w) => w.root && w.path === t.cwd);
            return (
              <li
                key={t.sessionId}
                style={reveal()}
                className={cn(row, "reveal-row group flex items-center rounded-lg pr-1 transition-[background-color,box-shadow] duration-(--dur-hover) hover:bg-fill-hover", selected && "bg-conversation shadow-1")}
              >
                <button
                  type="button"
                  title={t.title || t.sessionId}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => select(t.cwd, t.sessionId)}
                  className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pl-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
                    {host?.streaming ? <Keys playing className="text-brand" /> : dot && <span className={cn("size-2 rounded-full transition-[background-color,border-color] duration-300", dot)} />}
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
                    <DropdownMenuGroup>
                      <DropdownMenuItem disabled={!state.connected || checkoutMissing} onSelect={() => actions.rename(t)}><TextCursorInputIcon /> Rename</DropdownMenuItem>
                      <DropdownMenuItem disabled={!state.connected} onSelect={() => actions.archive(t)}><ArchiveIcon /> Archive</DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem variant="destructive" disabled={!state.connected} onSelect={() => actions.delete(t)}><Trash2Icon /> Delete</DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      </CollapsibleContent>
      {actions.dialogs}
    </Collapsible>
  );
}
