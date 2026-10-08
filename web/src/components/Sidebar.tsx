import type { ClientCommand as ClientMessage, OutcomeProject, ProjectView, SessionReference } from "@shared/wire";
import { cn } from "cn";
import { ArchiveIcon, ArchiveRestoreIcon, ChevronRightIcon, GitBranchIcon, MoreHorizontalIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PencilIcon, PlusIcon, SearchIcon, TextCursorInputIcon, Trash2Icon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type ProjectDialog, ProjectMenu } from "@/components/OutcomeProjects";
import { Keys, PianoMark } from "@/components/PianoMark";
import { useSessionActions } from "@/components/SessionActions";
import { Hint } from "@/components/Shortcut";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type AppState, sessionKey } from "@/store";

interface Props {
  state: AppState;
  send: (m: ClientMessage) => void;
  select: (cwd: string, sessionId: string | null) => void;
  /** The New page; with a project, the session started there joins it. */
  openNew: (cwd?: string, outcomeProjectId?: string) => void;
  onProjectDialog: (dialog: ProjectDialog) => void;
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
/** Project groups share the open-state store with directories, keyed apart from paths. */
const projectKey = (id: string) => `project:${id}`;

/** Row heights: 36px with a pointer, 44px on a touch screen. */
const row = "h-9 pointer-coarse:h-11";
/** Row actions live in a fixed slot on the right and appear on hover, so nothing shifts. */
const hoverSlot = "opacity-0 transition-opacity duration-(--dur-hover) group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100";
const groupRow = cn(row, "reveal-row group flex items-center gap-1 rounded-lg pr-1 transition-colors duration-(--dur-hover) hover:bg-fill-hover");
const groupTrigger = "flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg pl-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";
const sectionHeading = "group flex h-7 items-center pr-1 pl-2 text-xs text-muted-foreground";

export function Sidebar({ state, send, select, openNew, onProjectDialog, onHide, onPalette }: Props) {
  const [openProjects, setOpenProjects] = useState<Set<string>>(loadOpen);
  const current = state.session ?? state.selecting;

  const setOpen = (key: string, open: boolean) =>
    setOpenProjects((prev) => {
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });

  // The groups holding the selected session are always visible: its directory and its project.
  useEffect(() => {
    if (!current) return;
    const owner = state.projects.find((p) => p.worktrees.some((w) => w.path === current.cwd));
    if (owner && !openProjects.has(owner.path)) setOpen(owner.path, true);
    const member = state.sessionReferences.find(s => s.cwd === current.cwd && s.sessionId === current.sessionId);
    if (member?.outcomeProjectId && !openProjects.has(projectKey(member.outcomeProjectId))) setOpen(projectKey(member.outcomeProjectId), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.cwd, current?.sessionId, state.projects, state.sessionReferences]);

  // A project created in this view opens at once, so the session just filed in it is in sight.
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!state.projectsLoaded) return;
    const ids = state.outcomeProjects.map(p => p.id);
    if (known.current) for (const id of ids) if (!known.current.has(id)) setOpen(projectKey(id), true);
    known.current = new Set(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.projectsLoaded, state.outcomeProjects]);

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

  const active = state.outcomeProjects.filter(p => !p.archived);
  const archived = state.outcomeProjects.filter(p => p.archived);
  // Section headings exist only once there is a second kind of group to tell apart.
  const sectioned = state.outcomeProjects.length > 0;
  const groupProps = { state, send, select, openNew, reveal, onProjectDialog, current };

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
          className={cn("h-10 w-full justify-start rounded-xl border-line bg-conversation shadow-none transition-[background-color,border-color,color] duration-(--dur-hover)", state.view.kind === "new" && !state.view.cwd && !state.view.outcomeProjectId && "border-brand/25 bg-brand-soft text-brand hover:bg-brand-soft")}
          onClick={() => openNew()}
        >
          <PlusIcon /> New session
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
      <nav className="relative px-3 pb-4" aria-label="Projects and directories">
        {sectioned && state.projectsLoaded && (
          <section aria-label="Projects" className="mb-3">
            <div className={sectionHeading}>
              <h2 className="flex-1">Projects</h2>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" className={hoverSlot} aria-label="New project" disabled={!state.connected} onClick={() => onProjectDialog({})}><PlusIcon /></Button>
                </TooltipTrigger>
                <TooltipContent>New project</TooltipContent>
              </Tooltip>
            </div>
            <div className="flex flex-col gap-3">
              {active.map(p => <OutcomeGroup key={p.id} project={p} open={openProjects.has(projectKey(p.id))} onOpenChange={open => setOpen(projectKey(p.id), open)} {...groupProps} />)}
              {archived.length > 0 && (
                <Collapsible open={openProjects.has("project:archived")} onOpenChange={open => setOpen("project:archived", open)}>
                  <CollapsibleTrigger asChild>
                    <button type="button" className={cn(row, "flex w-full items-center gap-1.5 rounded-lg pl-1.5 text-left text-sm text-ink-3 outline-none transition-colors duration-(--dur-hover) hover:bg-fill-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset")}>
                      <ChevronRightIcon className={cn("size-4 shrink-0 transition-transform duration-(--dur-enter) ease-(--ease-enter) motion-reduce:transition-none", openProjects.has("project:archived") && "rotate-90")} />
                      <span className="min-w-0 flex-1 truncate">Archived</span>
                      <span className="pr-2 text-xs">{archived.length}</span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="disclosure-content">
                    <div className="flex flex-col gap-3 py-1 pl-3">
                      {archived.map(p => <OutcomeGroup key={p.id} project={p} open={openProjects.has(projectKey(p.id))} onOpenChange={open => setOpen(projectKey(p.id), open)} {...groupProps} />)}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          </section>
        )}
        {sectioned && state.projectsLoaded && <h2 className={sectionHeading}>Directories</h2>}
        {!state.projectsLoaded ? (
          <SidebarSkeleton />
        ) : state.projects.length === 0 ? (
          <Empty className="view-enter py-8">
            <EmptyHeader>
              <EmptyDescription>No directories yet. Start a session in any directory and it appears here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        <div className="flex flex-col gap-3">
          {state.projects.map((p) => (
            <Project key={p.path} project={p} open={openProjects.has(p.path)} onOpenChange={(open) => setOpen(p.path, open)} {...groupProps} />
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

/** The collapsed sidebar: a vertical rail with the expand control and activity mark. */
export function SidebarRail({ onShow, working }: { onShow: () => void; working: boolean }) {
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
      {/* With no rows in view, the mark itself says whether Pi is working somewhere. */}
      <div className="mt-auto pb-3">
        <PianoMark playing={working} className="size-6 rounded-md shadow-none" />
      </div>
    </div>
  );
}

interface GroupProps extends Pick<Props, "send" | "select" | "state" | "openNew" | "onProjectDialog"> {
  current: { cwd: string; sessionId: string | null } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reveal: () => React.CSSProperties | undefined;
}

type SessionTarget = { cwd: string; sessionId: string; title?: string };
type SessionActions = ReturnType<typeof useSessionActions>;

/** One session line, identical under a directory and under a project; only the trailing detail differs. */
function SessionRow({ t, trailing, selected, disabled, hint, state, send, select, actions, onProjectDialog, reveal }: {
  t: SessionTarget; trailing?: React.ReactNode; selected: boolean; disabled?: boolean; hint?: string; actions: SessionActions;
} & Pick<GroupProps, "state" | "send" | "select" | "onProjectDialog" | "reveal">) {
  const checkoutMissing = state.session?.cwd === t.cwd && state.session.state.checkoutMissing;
  // Live host state comes from the `hosts` broadcast, which changes more often than the project list.
  const host = state.hosts.find((h) => h.cwd === t.cwd && h.sessionId === t.sessionId);
  const done = state.done.includes(sessionKey(t));
  // The keys play while the session works; afterwards Herdr's dots: teal done, hollow green idle, nothing when no process.
  const dot = done ? "bg-done" : host ? "border border-ok" : null;
  return (
    <li
      style={reveal()}
      className={cn(row, "reveal-row group flex items-center rounded-lg pr-1 transition-[background-color,box-shadow] duration-(--dur-hover) hover:bg-fill-hover", selected && "bg-conversation shadow-1")}
    >
      <button
        type="button"
        title={hint ?? (t.title || t.sessionId)}
        aria-current={selected ? "page" : undefined}
        disabled={disabled}
        onClick={() => select(t.cwd, t.sessionId)}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pl-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:text-ink-3"
      >
        <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
          {host?.streaming ? <Keys playing className="text-brand" /> : dot && <span className={cn("size-2 rounded-full transition-[background-color,border-color] duration-300", dot)} />}
        </span>
        <span className={cn("min-w-0 flex-1 truncate", selected && "font-medium", !t.title && "text-ink-3")}>{t.title || "Untitled"}</span>
        {trailing}
        {host?.streaming ? <span className="sr-only">working</span> : done ? <span className="sr-only">done</span> : null}
        {hint && <span className="sr-only">{hint}</span>}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" className={hoverSlot} aria-label={`Session menu for ${t.title || t.sessionId}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <ProjectMenu state={state} send={send} session={t} onDialog={onProjectDialog} />
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
}

const Chevron = ({ open }: { open: boolean }) => <ChevronRightIcon className={cn("size-4 shrink-0 text-ink-3 transition-transform duration-(--dur-enter) ease-(--ease-enter) motion-reduce:transition-none", open && "rotate-90")} />;

/** An outcome project: the same disclosure group as a directory, whose rows come from any directory. */
function OutcomeGroup({ project, current, open, onOpenChange, state, send, select, openNew, reveal, onProjectDialog }: GroupProps & { project: OutcomeProject }) {
  const actions = useSessionActions(send, state.connected);
  const members = state.sessionReferences.filter(s => s.outcomeProjectId === project.id);
  const location = (s: SessionReference) => {
    const owner = state.projects.find(p => p.worktrees.some(w => w.path === s.cwd));
    const worktree = owner?.worktrees.find(w => w.path === s.cwd);
    // A worktree is named by its branch; a root (or an unregistered directory) by its directory name.
    if (worktree && !worktree.root && worktree.branch) return <span className="flex max-w-[38%] shrink-0 items-center gap-1 truncate font-mono text-sm text-ink-3"><GitBranchIcon className="size-3 shrink-0" aria-hidden /><span className="truncate">{worktree.branch}</span></span>;
    return <span className="max-w-[38%] shrink-0 truncate text-xs text-ink-3">{owner?.name ?? s.cwd.split("/").pop()}</span>;
  };
  const hint = (s: SessionReference) => s.unavailable === "history" ? "History unavailable. Restore the Pi session file to open it."
    : s.unavailable === "checkout" ? "Directory missing. History can be read; restore the directory to continue." : undefined;
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className={groupRow} style={reveal()}>
        <CollapsibleTrigger asChild>
          <button type="button" className={groupTrigger} title={project.goal || undefined}>
            <Chevron open={open} />
            <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", project.archived ? "text-ink-3" : "text-ink-2")}>{project.name}</span>
          </button>
        </CollapsibleTrigger>
        {!project.archived && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" className={hoverSlot} aria-label={`New session in ${project.name}`} onClick={() => openNew(undefined, project.id)}>
                <PlusIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New session in project</TooltipContent>
          </Tooltip>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" className={hoverSlot} aria-label={`Project menu for ${project.name}`}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={!state.connected} onSelect={() => onProjectDialog({ project })}><PencilIcon /> Edit project</DropdownMenuItem>
              <DropdownMenuItem disabled={!state.connected} onSelect={() => send({ _tag: "archive_outcome_project", id: project.id, archived: !project.archived })}>
                {project.archived ? <><ArchiveRestoreIcon /> Reopen project</> : <><ArchiveIcon /> Archive project</>}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <CollapsibleContent className="disclosure-content">
        {members.length === 0 && <p className="py-2 pl-7 text-sm text-muted-foreground">No sessions yet</p>}
        <ul className="flex flex-col gap-1 py-1">
          {members.map(s => (
            <SessionRow key={sessionKey(s)} t={s} trailing={location(s)} hint={hint(s)} disabled={s.unavailable === "history"}
              selected={current?.cwd === s.cwd && current.sessionId === s.sessionId}
              state={state} send={send} select={select} actions={actions} onProjectDialog={onProjectDialog} reveal={reveal} />
          ))}
        </ul>
      </CollapsibleContent>
      {actions.dialogs}
    </Collapsible>
  );
}

function Project({ project, current, open, onOpenChange, state, send, select, openNew, reveal, onProjectDialog }: GroupProps & { project: ProjectView }) {
  const actions = useSessionActions(send, state.connected);
  const [closing, setClosing] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className={groupRow} style={reveal()}>
        <CollapsibleTrigger asChild>
          <button type="button" className={groupTrigger} title={project.path}>
            <Chevron open={open} />
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
            <Button variant="ghost" size="icon-xs" className={hoverSlot} aria-label={`Directory menu for ${project.name}`}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={!state.connected} onSelect={() => setClosing(true)}>
                <XIcon /> Close
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {project.discovery.status === "error" && <Badge variant="destructive" className="ml-7 animate-in fade-in-0" title={project.discovery.detail}>Git status unavailable</Badge>}
      {project.discovery.status === "non-git" && <Badge variant="secondary" className="ml-7">Non-Git</Badge>}
      <CollapsibleContent className="disclosure-content">
        {project.sessions.length === 0 && <p className="py-2 pl-7 text-sm text-muted-foreground">No sessions yet</p>}
        <ul className="flex flex-col gap-1 py-1">
          {project.sessions.map((t) => {
            // The branch is only news when the session runs somewhere other than the project root.
            const inWorktree = !project.worktrees.some((w) => w.root && w.path === t.cwd);
            const trailing = t.branch && inWorktree ? (
              <span className="flex max-w-[38%] shrink-0 items-center gap-1 truncate font-mono text-sm text-ink-3">
                <GitBranchIcon className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{t.branch}</span>
              </span>
            ) : undefined;
            return (
              <SessionRow key={t.sessionId} t={t} trailing={trailing} selected={current?.cwd === t.cwd && current.sessionId === t.sessionId}
                state={state} send={send} select={select} actions={actions} onProjectDialog={onProjectDialog} reveal={reveal} />
            );
          })}
        </ul>
      </CollapsibleContent>
      {actions.dialogs}
      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Close this directory?</DialogTitle>
            <DialogDescription>"{project.name}" will be removed from the sidebar. Files and session history will not be deleted.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(false)}>Cancel</Button>
            <Button disabled={!state.connected} onClick={() => {
              if (!state.connected) return;
              send({ _tag: "remove_project", path: project.path });
              setClosing(false);
            }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Collapsible>
  );
}
