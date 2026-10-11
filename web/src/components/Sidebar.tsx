import type { ClientCommand as ClientMessage, FolderView, Project } from "@shared/wire";
import { cn } from "cn";
import { ArchiveIcon, ArchiveRestoreIcon, MonitorIcon, MoonIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, SearchIcon, SettingsIcon, SlidersHorizontalIcon, SunIcon, XIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutHeader, LayoutRail } from "@/components/AppLayout";
import { DisclosureChevron } from "@/components/Disclosure";
import { IconButton } from "@/components/IconButton";
import { Keys } from "@/components/PianoMark";
import { type ProjectDialog, ProjectMenu } from "@/components/Projects";
import { SessionCommandMenuItem, useSessionCommands } from "@/components/SessionCommandHost";
import { Hint } from "@/components/Shortcut";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Navigation } from "@/lib/navigation";
import { type SessionEntry, sessionCatalog } from "@/lib/sessionCatalog";
import { pickCommands, SESSION_ROW_COMMANDS } from "@/lib/sessionCommands";
import { folderFor, sessionReference } from "@/lib/sessionContext";
import { dateGroups, folderGroups, GROUP_BY, type GroupBy, projectGroups, SORT_BY, type SortBy, sortSessions } from "@/lib/sidebarView";
import { readJson, writeJson } from "@/lib/storage";
import { useNavigation } from "@/lib/useNavigation";
import { useSidebarView } from "@/lib/useSidebarView";
import { type AppState, sessionKey } from "@/store";

interface Props {
  state: AppState;
  send: (m: ClientMessage) => void;
  onProjectDialog: (dialog: ProjectDialog) => void;
  /** Hide the sidebar (or close the sheet it is shown in). */
  onHide: () => void;
}

const OPEN_KEY = "piano.openProjects";
const loadOpen = (): Set<string> => new Set(readJson<string[]>(OPEN_KEY, []));
/** Project groups share the open-state store with folders, keyed apart from paths; the empty id is the No project group. */
const projectKey = (id: string) => `project:${id}`;

/** Row heights: 36px with a pointer, 44px on a touch screen. */
const row = "h-9 pointer-coarse:h-11";
/** Row actions live in a fixed slot on the right and appear on hover, so nothing shifts. */
const hoverSlot = "opacity-0 transition-opacity duration-(--dur-hover) group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100";
const groupRow = cn(row, "group flex items-center gap-1 rounded-lg pr-1 transition-colors duration-(--dur-hover) hover:bg-fill-hover");
const groupTrigger = "flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg pl-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

export function Sidebar({ state, send, onProjectDialog, onHide }: Props) {
  const { select, openNew, openSettings, setPalette } = useNavigation();
  const [openGroups, setOpenGroups] = useState<Set<string>>(loadOpen);
  const { view, setView } = useSidebarView();
  const current = state.session ?? state.selecting;
  const [dateNow, setDateNow] = useState(() => new Date());

  // Refresh an idle date view at local midnight; focus also catches sleep and clock changes.
  useEffect(() => {
    if (view.groupBy !== "date") return;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = new Date();
      setDateNow(now);
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(refresh, midnight.getTime() - now.getTime());
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { clearTimeout(timer); window.removeEventListener("focus", refresh); };
  }, [view.groupBy]);

  const setOpen = (key: string, open: boolean) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      writeJson(OPEN_KEY, [...next]);
      return next;
    });

  // The group holding the selected session is always open: its folder, or its project.
  useEffect(() => {
    if (!current) return;
    const owner = folderFor(state, current.cwd);
    const member = current.sessionId ? sessionReference(state, { cwd: current.cwd, sessionId: current.sessionId }) : undefined;
    const key = view.groupBy === "folder" ? owner?.path : view.groupBy === "project" ? projectKey(member?.projectId ?? "") : undefined;
    if (key && !openGroups.has(key)) setOpen(key, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.cwd, current?.sessionId, state.folders, state.sessionReferences, view.groupBy]);

  // A project created in this view opens at once, so the session just filed in it is in sight.
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!state.registryLoaded) return;
    const ids = state.projects.map(p => p.id);
    if (known.current) for (const id of ids) if (!known.current.has(id)) setOpen(projectKey(id), true);
    known.current = new Set(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.registryLoaded, state.projects]);

  // Rows already there when the list first loads appear at once, so a reload does not flash;
  // a row added later enters. Each row decides when it mounts (`useState(reveal)`).
  const [settled, setSettled] = useState(false);
  useEffect(() => { if (state.registryLoaded) setSettled(true); }, [state.registryLoaded]);
  const reveal = () => (settled ? "reveal-row" : undefined);

  // One catalog for every grouping, so switching the grouping never changes which sessions are listed.
  const listed = useMemo(() => sessionCatalog(state).filter(s => s.listed),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.folders, state.sessionReferences, state.projects, state.hosts, state.done, current?.cwd, current?.sessionId]);
  const groupProps = { state, send, select, openNew, reveal, onProjectDialog };
  const empty = (text: string) => (
    <Empty className="view-enter py-8">
      <EmptyHeader>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
  const groups = (children: React.ReactNode) => <div className="flex flex-col gap-1">{children}</div>;
  const list = () => {
    if (!state.registryLoaded) return <SidebarSkeleton />;
    if (view.groupBy === "folder") {
      if (state.folders.length === 0) return empty("No folders yet. Start a session in any folder and it appears here.");
      return groups(folderGroups(state.folders, listed, view.sortBy).map(({ folder, sessions }) => (
        <FolderGroup key={folder.path} folder={folder} sessions={sessions} open={openGroups.has(folder.path)} onOpenChange={(open) => setOpen(folder.path, open)} {...groupProps} />
      )));
    }
    if (view.groupBy === "project") {
      // Archived projects are not listed; a place for archived projects and sessions is still to be designed.
      const active = state.projects.filter(p => !p.archived);
      const all = projectGroups(active, listed, view.sortBy);
      if (active.length === 0 && all.every(g => g.sessions.length === 0)) return empty("No sessions yet. Start one and it appears here.");
      return groups(all.map(g => {
        const key = projectKey(g.project?.id ?? "");
        return <ProjectGroup key={key} project={g.project} sessions={g.sessions} open={openGroups.has(key)} onOpenChange={open => setOpen(key, open)} {...groupProps} />;
      }));
    }
    if (view.groupBy === "date") {
      const dated = dateGroups(listed, view.sortBy, dateNow);
      if (dated.length === 0) return empty("No sessions yet. Start one and it appears here.");
      return groups(dated.map(g => (
        <section key={g.label} aria-label={g.label}>
          {/* No standalone shadcn heading fits this noninteractive list section. */}
          <h2 className="px-2 pt-3 pb-2 text-xs font-medium text-muted-foreground">{g.label}</h2>
          <SessionList sessions={g.sessions} {...groupProps} />
        </section>
      )));
    }
    const sessions = sortSessions(listed, view.sortBy);
    if (sessions.length === 0) return empty("No sessions yet. Start one and it appears here.");
    return <SessionList sessions={sessions} {...groupProps} />;
  };

  return (
    <div className="flex h-full flex-col">
      <LayoutHeader onHide={onHide}>
        <IconButton label="Search sessions" tooltip={<Hint of={["mod", "K"]}>Search and commands</Hint>} onClick={() => setPalette(true)}>
          <SearchIcon />
        </IconButton>
        <ViewMenu groupBy={view.groupBy} sortBy={view.sortBy} onChange={setView} />
      </LayoutHeader>
      <div className="px-3 pb-3">
        <Button
          variant="rail-action"
          className="h-10 w-full justify-start rounded-xl pointer-coarse:h-11"
          onClick={() => openNew()}
        >
          <PlusIcon data-icon="inline-start" /> New session
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
      <nav className="relative px-3 pb-4" aria-label="Sessions">
        {list()}
      </nav>
      </ScrollArea>
      <div className="shrink-0 p-3">
        <Button variant="ghost" className="w-full justify-start" onClick={() => openSettings()}><SettingsIcon data-icon="inline-start" />Settings</Button>
      </div>
    </div>
  );
}

const APPEARANCES = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const;

/** One menu for grouping and sorting the list; appearance lives here too. */
function ViewMenu({ groupBy, sortBy, onChange }: { groupBy: GroupBy; sortBy: SortBy; onChange: (change: { groupBy?: GroupBy; sortBy?: SortBy }) => void }) {
  const { setTheme, theme } = useTheme();
  const sortLabel = SORT_BY.find(s => s.value === sortBy)?.label ?? "";
  // The label takes the slack so the current value sits beside the trigger's own chevron.
  const choice = (label: string, value: string) => <><span className="flex-1">{label}</span><span className="text-muted-foreground">{value}</span></>;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="View options">
              <SlidersHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>View options</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{choice("Group by", GROUP_BY.find(g => g.value === groupBy)?.label ?? "")}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={groupBy} onValueChange={value => onChange({ groupBy: value as GroupBy })}>
              {GROUP_BY.filter(g => g.value !== "none").map(g => <DropdownMenuRadioItem key={g.value} value={g.value}>{g.label}</DropdownMenuRadioItem>)}
              <DropdownMenuSeparator />
              <DropdownMenuRadioItem value="none">None</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{choice("Sort by", sortLabel)}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={sortBy} onValueChange={value => onChange({ sortBy: value as SortBy })}>
              {SORT_BY.map(s => <DropdownMenuRadioItem key={s.value} value={s.value}>{s.label}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{choice("Appearance", APPEARANCES.find(a => a.value === (theme ?? "system"))?.label ?? "")}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {/* The chosen mode carries the check; the icons say what each one does. */}
            <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
              {APPEARANCES.map(({ value, label, icon: Icon }) => <DropdownMenuRadioItem key={value} value={value}><Icon /> {label}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** shadcn's Empty composed down to one list row, so an empty group keeps the list's rhythm and indent. */
function ListEmpty({ children }: { children: React.ReactNode }) {
  return (
    <Empty className={cn(row, "items-start justify-center gap-0 rounded-none p-0 pl-7 text-left md:p-0 md:pl-7")}>
      <EmptyDescription className="text-sm/normal">{children}</EmptyDescription>
    </Empty>
  );
}

/** Skeleton rows in the real row geometry: a folder line, two session lines, another folder. */
function SidebarSkeleton() {
  return (
    <div aria-hidden className="late-enter flex flex-col gap-1">
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
  const { openSettings } = useNavigation();
  return <LayoutRail onShow={onShow} working={working} footer={<IconButton label="Settings" side="right" onClick={() => openSettings()}><SettingsIcon /></IconButton>} />;
}

interface GroupProps extends Pick<Props, "send" | "state" | "onProjectDialog">, Pick<Navigation, "select" | "openNew"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reveal: () => string | undefined;
}

/** One line per session: the title alone. Location and project live in the session header and the groupings. */
function SessionRow({ t, state, send, select, onProjectDialog, reveal }: {
  t: SessionEntry;
} & Pick<GroupProps, "state" | "send" | "select" | "onProjectDialog" | "reveal">) {
  const [enter] = useState(reveal);
  const target = { cwd: t.cwd, sessionId: t.sessionId, title: t.title };
  const { commands, run } = useSessionCommands(target);
  const menu = pickCommands(commands, SESSION_ROW_COMMANDS);
  const item = (c: (typeof menu)[number]) => <SessionCommandMenuItem key={c.id} command={c} run={run} />;
  const { selected, disabled, hint, activity } = t;
  // The keys play while the session works; afterwards Herdr's dots: tidal-blue done, hollow sage idle, nothing when no process.
  const dot = activity === "done" ? "bg-done" : activity === "idle" ? "border border-ok" : null;
  return (
    <li
      className={cn(row, enter, "group flex items-center rounded-lg pr-1 transition-[background-color,box-shadow] duration-(--dur-hover) hover:bg-fill-hover", selected && "bg-(--selected) hover:bg-(--selected)")}
    >
      <button
        type="button"
        title={hint}
        aria-current={selected ? "page" : undefined}
        disabled={disabled}
        onClick={() => select(t.cwd, t.sessionId)}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pl-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:text-ink-3"
      >
        <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
          {activity === "working" ? <Keys playing className="text-brand" /> : dot && <span className={cn("size-2 rounded-full transition-[background-color,border-color] duration-300", dot)} />}
        </span>
        <span className={cn("min-w-0 flex-1 truncate", selected && "font-medium", !t.title && "text-ink-3")}>{t.title || "Untitled"}</span>
        {activity === "working" ? <span className="sr-only">working</span> : activity === "done" ? <span className="sr-only">done</span> : null}
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
            <ProjectMenu state={state} send={send} session={target} onDialog={onProjectDialog} />
            {menu.filter(c => c.group !== "destructive").map(item)}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {menu.filter(c => c.group === "destructive").map(item)}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

const Chevron = ({ open }: { open: boolean }) => <DisclosureChevron open={open} className="size-4" />;

/** Session rows from the catalog; each entry already says how it appears. */
function SessionRows({ sessions, className, ...row }: Pick<GroupProps, "state" | "send" | "select" | "onProjectDialog" | "reveal"> & { sessions: readonly SessionEntry[]; className: string }) {
  return (
    <ul className={className}>
      {sessions.map(s => <SessionRow key={sessionKey(s)} t={s} {...row} />)}
    </ul>
  );
}

/** Every listed session in one list. */
function SessionList({ sessions, state, send, select, reveal, onProjectDialog }: Omit<GroupProps, "open" | "onOpenChange" | "openNew"> & { sessions: readonly SessionEntry[] }) {
  return <SessionRows className="flex flex-col gap-1" sessions={sessions} state={state} send={send} select={select} onProjectDialog={onProjectDialog} reveal={reveal} />;
}

/** A project: the same disclosure group as a folder, whose rows come from any folder. Without a project it is the No project group. */
function ProjectGroup({ project, sessions, open, onOpenChange, state, send, select, openNew, reveal, onProjectDialog }: GroupProps & { project: Project | null; sessions: readonly SessionEntry[] }) {
  const [enter] = useState(reveal);
  const members = sessions;
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className={cn(groupRow, enter)}>
        <CollapsibleTrigger asChild>
          <button type="button" className={groupTrigger}>
            <Chevron open={open} />
            <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", !project || project.archived ? "text-ink-3" : "text-ink-2")}>{project?.name ?? "No project"}</span>
          </button>
        </CollapsibleTrigger>
        {project && !project.archived && (
          <IconButton size="icon-xs" className={hoverSlot} label={`New session in ${project.name}`} tooltip="New session in project" onClick={() => openNew(undefined, project.id)}>
            <PlusIcon />
          </IconButton>
        )}
        {project && <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" className={hoverSlot} aria-label={`Project menu for ${project.name}`}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={!state.connected} onSelect={() => onProjectDialog({ project })}><PencilIcon /> Edit project</DropdownMenuItem>
              <DropdownMenuItem disabled={!state.connected} onSelect={() => send({ _tag: "archive_project", id: project.id, archived: !project.archived })}>
                {project.archived ? <><ArchiveRestoreIcon /> Unarchive project</> : <><ArchiveIcon /> Archive project</>}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
      <CollapsibleContent className="disclosure-content">
        {members.length === 0 ? <ListEmpty>No sessions yet</ListEmpty>
          : <SessionRows className="flex flex-col gap-1 py-1" sessions={members} state={state} send={send} select={select} onProjectDialog={onProjectDialog} reveal={reveal} />}
      </CollapsibleContent>
    </Collapsible>
  );
}

function FolderGroup({ folder, sessions, open, onOpenChange, state, send, select, openNew, reveal, onProjectDialog }: GroupProps & { folder: FolderView; sessions: readonly SessionEntry[] }) {
  const [enter] = useState(reveal);
  const [closing, setClosing] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className={cn(groupRow, enter)}>
        <CollapsibleTrigger asChild>
          <button type="button" className={groupTrigger} title={folder.path}>
            <Chevron open={open} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-2">{folder.name}</span>
          </button>
        </CollapsibleTrigger>
        <IconButton size="icon-xs" className={hoverSlot} label={`New session in ${folder.name}`} tooltip="New session here" onClick={() => openNew(folder.path)}>
          <PlusIcon />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" className={hoverSlot} aria-label={`Folder menu for ${folder.name}`}>
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
      {folder.discovery.status === "error" && <Badge variant="destructive" className="ml-7 animate-in fade-in-0" title={folder.discovery.detail}>Git status unavailable</Badge>}
      {folder.discovery.status === "non-git" && <Badge variant="secondary" className="ml-7">Non-Git</Badge>}
      <CollapsibleContent className="disclosure-content">
        {sessions.length === 0 ? <ListEmpty>No sessions yet</ListEmpty>
          : <SessionRows className="flex flex-col gap-1 py-1" sessions={sessions} state={state} send={send} select={select} onProjectDialog={onProjectDialog} reveal={reveal} />}
      </CollapsibleContent>
      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Close this folder?</DialogTitle>
            <DialogDescription>"{folder.name}" will be removed from the sidebar. Files and session history will not be deleted.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(false)}>Cancel</Button>
            <Button disabled={!state.connected} onClick={() => {
              if (!state.connected) return;
              send({ _tag: "remove_folder", path: folder.path });
              setClosing(false);
            }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Collapsible>
  );
}
