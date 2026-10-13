import type { FolderView, Project } from "@shared/wire";
import { cn } from "cn";
import {
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  TargetIcon,
  XIcon,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { LayoutHeader, LayoutRail } from "@/components/AppLayout";
import {
  SessionCommandMenuItem,
  useCommands,
  useGlobalCommands,
  useSessionCommands,
} from "@/components/CommandHost";
import { DisclosureChevron } from "@/components/Disclosure";
import { GlobalCommandIcon } from "@/components/GlobalCommandIcon";
import { IconButton } from "@/components/IconButton";
import { PianoButton as Button } from "@/components/PianoButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { Keys } from "@/components/PianoMark";
import { PianoSkeleton as Skeleton } from "@/components/PianoSkeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { PickerRadioItem as DropdownMenuRadioItem } from "@/components/PickerRadioItem";
import { ProjectCommandIconView } from "@/components/Projects";
import { Hint } from "@/components/Shortcut";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { folderCommands } from "@/lib/folderCommands";
import type { GlobalCommand, GlobalCommandGroup } from "@/lib/globalCommands";
import type { Navigation } from "@/lib/navigation";
import { createPreference, parseJson } from "@/lib/preference";
import {
  assignProjectCommand,
  newProjectCommand,
  projectChoices,
  projectCommands,
} from "@/lib/projectCommands";
import type { SessionEntry } from "@/lib/sessionCatalog";
import { pickCommands, SESSION_ROW_COMMANDS, type SessionTarget } from "@/lib/sessionCommands";
import { sessionProject } from "@/lib/sessionContext";
import { projectKey } from "@/lib/sidebarGroups";
import { sidebarSections } from "@/lib/sidebarSections";
import { useNavigation } from "@/lib/useNavigation";
import { usePreference } from "@/lib/usePreference";
import { useSidebarGroups } from "@/lib/useSidebarGroups";
import { useSidebarView } from "@/lib/useSidebarView";
import { type AppState, sessionKey } from "@/store";

interface Props {
  state: AppState;
}

/** Row heights: 36px with a pointer, 44px on touch desktops, 48px on phones. */
const row = "h-9 pointer-coarse:h-11 max-md:h-12";
/** Row actions live in a fixed slot on the right and appear on hover, so nothing shifts. */
const hoverSlot =
  "opacity-0 transition-opacity duration-(--dur-hover) group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100";
const groupRow = cn(
  row,
  "group flex items-center gap-1 rounded-lg pr-1 transition-colors duration-(--dur-hover) hover:bg-fill-hover",
);
/** The Pinned group starts open and stays as the user leaves it, per browser. */
const pinnedOpenPreference = createPreference<boolean>({
  key: "piano.pinnedOpen",
  decode: (raw) => parseJson(raw) !== false,
});
const groupTrigger =
  "flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg pl-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

export function Sidebar({ state }: Props) {
  const { select, openNew, openSettings, setPalette } = useNavigation();
  const { view } = useSidebarView();
  const { openGroups, setOpen } = useSidebarGroups(state, view.groupBy);
  const [pinnedOpen, togglePinned] = usePreference(pinnedOpenPreference);
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
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [view.groupBy]);

  // Rows already there when the list first loads appear at once, so a reload does not flash;
  // a row added later enters. Each row decides when it mounts (`useState(reveal)`).
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (state.registryLoaded) setSettled(true);
  }, [state.registryLoaded]);
  const reveal = () => (settled ? "reveal-row" : undefined);

  const { pinned, body } = useMemo(
    () => sidebarSections(state, view, dateNow),
    [state, view, dateNow],
  );
  const groupProps = { state, select, reveal };
  const groups = (children: React.ReactNode) => (
    <div className="flex flex-col gap-1">{children}</div>
  );
  const list = () => {
    switch (body?.kind) {
      case undefined:
        return null;
      case "loading":
        return <SidebarSkeleton />;
      case "empty":
        return (
          <Empty className="view-enter py-8">
            <EmptyHeader>
              <EmptyDescription>{body.text}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        );
      case "folders":
        return groups(
          body.groups.map(({ folder, sessions }) => (
            <FolderGroup
              key={folder.path}
              folder={folder}
              sessions={sessions}
              open={openGroups.has(folder.path)}
              onOpenChange={(open) => setOpen(folder.path, open)}
              {...groupProps}
            />
          )),
        );
      case "projects":
        return groups(
          body.groups.map((g) => {
            const key = projectKey(g.project?.id ?? "");
            return (
              <ProjectGroup
                key={key}
                project={g.project}
                sessions={g.sessions}
                open={openGroups.has(key)}
                onOpenChange={(open) => setOpen(key, open)}
                {...groupProps}
              />
            );
          }),
        );
      case "dates":
        return groups(
          body.groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              {/* No standalone shadcn heading fits this noninteractive list section. */}
              <h2 className="px-2 pt-3 pb-2 text-xs font-medium text-muted-foreground">
                {g.label}
              </h2>
              <SessionList sessions={g.sessions} {...groupProps} />
            </section>
          )),
        );
      case "list":
        return <SessionList sessions={body.sessions} {...groupProps} />;
    }
  };

  return (
    <div data-slot="session-sidebar" className="flex h-full flex-col">
      <LayoutHeader>
        <IconButton
          label="Search sessions"
          tooltip={<Hint of={["mod", "K"]}>Search and commands</Hint>}
          onClick={() => setPalette(true)}
        >
          <SearchIcon />
        </IconButton>
        <ViewMenu />
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
          {pinned.length > 0 && (
            <Collapsible
              open={pinnedOpen}
              onOpenChange={togglePinned}
              aria-label="Pinned"
              className="mb-1"
            >
              <div className={groupRow}>
                <CollapsibleTrigger asChild>
                  <button type="button" className={groupTrigger}>
                    <Chevron open={pinnedOpen} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-2">
                      Pinned
                    </span>
                  </button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent className="disclosure-content">
                <SessionRows
                  className="flex flex-col gap-1 py-1"
                  sessions={pinned}
                  {...groupProps}
                />
              </CollapsibleContent>
            </Collapsible>
          )}
          {list()}
        </nav>
      </ScrollArea>
      <div className="shrink-0 p-3">
        <Button variant="ghost" className="w-full justify-start" onClick={() => openSettings()}>
          <SettingsIcon data-icon="inline-start" />
          Settings
        </Button>
      </div>
    </div>
  );
}

/** One menu for grouping and sorting the list; appearance lives here too. Each choice is a global command, as the palette offers it. */
function ViewMenu() {
  const { commands, run } = useGlobalCommands();
  const choices = (group: GlobalCommandGroup) => commands.filter((c) => c.group === group);
  // The label takes the slack so the current value sits beside the trigger's own chevron.
  const choice = (label: string, group: GlobalCommandGroup) => (
    <>
      <span className="flex-1">{label}</span>
      <span className="text-muted-foreground">
        {choices(group).find((c) => c.checked)?.menuLabel ?? ""}
      </span>
    </>
  );
  const radio = (group: GlobalCommandGroup, item: (c: GlobalCommand) => React.ReactNode) => (
    <DropdownMenuRadioGroup
      value={choices(group).find((c) => c.checked)?.id ?? ""}
      onValueChange={(id) => {
        const c = commands.find((c) => c.id === id);
        if (c) run(c);
      }}
    >
      {choices(group).map(item)}
    </DropdownMenuRadioGroup>
  );
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
          <DropdownMenuSubTrigger>{choice("Group by", "group-by")}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {/* No grouping comes last, set apart from the groupings. */}
            {radio("group-by", (c) => (
              <Fragment key={c.id}>
                {c.id === "group-none" && <DropdownMenuSeparator />}
                <DropdownMenuRadioItem value={c.id}>{c.menuLabel}</DropdownMenuRadioItem>
              </Fragment>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{choice("Sort by", "sort-by")}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {radio("sort-by", (c) => (
              <DropdownMenuRadioItem key={c.id} value={c.id}>
                {c.menuLabel}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{choice("Appearance", "appearance")}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {/* The chosen mode carries the check; the icons say what each one does. */}
            {radio("appearance", (c) => (
              <DropdownMenuRadioItem key={c.id} value={c.id}>
                <GlobalCommandIcon icon={c.icon} /> {c.menuLabel}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** shadcn's Empty composed down to one list row, so an empty group keeps the list's rhythm and indent. */
function ListEmpty({ children }: { children: React.ReactNode }) {
  return (
    <Empty
      className={cn(
        row,
        "items-start justify-center gap-0 rounded-none p-0 pl-7 text-left md:p-0 md:pl-7",
      )}
    >
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
                  <span className="flex size-4 items-center justify-center">
                    <Skeleton className="size-2 rounded-full" />
                  </span>
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
export function SidebarRail({ working }: { working: boolean }) {
  const { openSettings } = useNavigation();
  return (
    <LayoutRail
      working={working}
      footer={
        <IconButton label="Settings" side="right" onClick={() => openSettings()}>
          <SettingsIcon />
        </IconButton>
      }
    />
  );
}

interface GroupProps extends Pick<Props, "state">, Pick<Navigation, "select"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reveal: () => string | undefined;
}

/** One line per session: the title alone. Location and project live in the session header and the groupings. */
function SessionRow({
  t,
  state,
  select,
  reveal,
}: {
  t: SessionEntry;
} & Pick<GroupProps, "state" | "select" | "reveal">) {
  const [enter] = useState(reveal);
  const target = { cwd: t.cwd, sessionId: t.sessionId, title: t.title };
  const { commands, run } = useSessionCommands(target);
  const menu = pickCommands(commands, SESSION_ROW_COMMANDS);
  const item = (c: (typeof menu)[number]) => (
    <SessionCommandMenuItem key={c.id} command={c} run={run} />
  );
  const { selected, disabled, hint, activity } = t;
  // The keys play while the session works; afterwards Herdr's dots: tidal-blue done, hollow sage idle, nothing when no process.
  const dot = activity === "done" ? "bg-done" : activity === "idle" ? "border border-ok" : null;
  return (
    <li
      className={cn(
        row,
        enter,
        "group flex items-center rounded-lg pr-1 transition-[background-color,box-shadow] duration-(--dur-hover) hover:bg-fill-hover",
        selected && "bg-(--selected) hover:bg-(--selected)",
      )}
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
          {activity === "working" ? (
            <Keys playing className="text-brand" />
          ) : (
            dot && (
              <span
                className={cn(
                  "size-2 rounded-full transition-[background-color,border-color] duration-300",
                  dot,
                )}
              />
            )
          )}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            selected && "font-medium",
            !t.title && "text-ink-3",
          )}
        >
          {t.title || "Untitled"}
        </span>
        {activity === "working" ? (
          <span className="sr-only">working</span>
        ) : activity === "done" ? (
          <span className="sr-only">done</span>
        ) : null}
        {hint && <span className="sr-only">{hint}</span>}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className={hoverSlot}
            aria-label={`Session menu for ${t.title || t.sessionId}`}
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            {menu.filter((c) => c.id === "rename" || c.id === "pin").map(item)}
          </DropdownMenuGroup>
          {menu.some((c) => c.id === "share") && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {menu.filter((c) => c.id === "share").map(item)}
              </DropdownMenuGroup>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {menu.filter((c) => c.id === "archive" || c.id === "delete").map(item)}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <ProjectMenu state={state} session={target} />
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/**
 * Membership lives in the session's own menu, like Rename or Archive. Choosing a project is a radio
 * pick; "New project…" creates one and files the session in it. The command palette carries no
 * project commands yet: which ones are wanted is left to daily use.
 */
function ProjectMenu({ state, session }: { state: AppState; session: SessionTarget }) {
  const { run } = useCommands();
  const current = sessionProject(state, session);
  const choices = projectChoices(state, current);
  const create = newProjectCommand(state, session);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={!create.enabled}>
        <TargetIcon /> Project
        {current && (
          <span className="ml-1 min-w-0 max-w-32 truncate text-muted-foreground">
            {current.name}
          </span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-w-[calc(100vw-2rem)]">
        {choices.length > 0 && (
          <>
            <DropdownMenuRadioGroup
              value={current?.id ?? ""}
              onValueChange={(id) => run(assignProjectCommand(state, session, id || null))}
            >
              {choices.map((p) => (
                <DropdownMenuRadioItem key={p.id} value={p.id}>
                  <span className="truncate">{p.name}</span>
                  {p.archived && <span className="ml-1 text-muted-foreground">· Archived</span>}
                </DropdownMenuRadioItem>
              ))}
              <DropdownMenuRadioItem value="">None</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem disabled={!create.enabled} onSelect={() => run(create)}>
          <ProjectCommandIconView icon={create.icon} /> {create.label}…
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

const Chevron = ({ open }: { open: boolean }) => (
  <DisclosureChevron open={open} className="size-4" />
);

/** Session rows from the catalog; each entry already says how it appears. */
function SessionRows({
  sessions,
  className,
  ...row
}: Pick<GroupProps, "state" | "select" | "reveal"> & {
  sessions: readonly SessionEntry[];
  className: string;
}) {
  return (
    <ul className={className}>
      {sessions.map((s) => (
        <SessionRow key={sessionKey(s)} t={s} {...row} />
      ))}
    </ul>
  );
}

/** Every listed session in one list. */
function SessionList({
  sessions,
  state,
  select,
  reveal,
}: Omit<GroupProps, "open" | "onOpenChange"> & { sessions: readonly SessionEntry[] }) {
  return (
    <SessionRows
      className="flex flex-col gap-1"
      sessions={sessions}
      state={state}
      select={select}
      reveal={reveal}
    />
  );
}

/** A project: the same disclosure group as a folder, whose rows come from any folder. Without a project it is the No project group. */
function ProjectGroup({
  project,
  sessions,
  open,
  onOpenChange,
  state,
  select,
  reveal,
}: GroupProps & { project: Project | null; sessions: readonly SessionEntry[] }) {
  const [enter] = useState(reveal);
  const { run } = useCommands();
  const members = sessions;
  const commands = project ? projectCommands(state, project) : [];
  const create = commands.find((c) => c.id === "new-session");
  const menu = commands.filter((c) => c.id !== "new-session");
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className={cn(groupRow, enter)}>
        <CollapsibleTrigger asChild>
          <button type="button" className={groupTrigger}>
            <Chevron open={open} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm font-medium",
                !project || project.archived ? "text-ink-3" : "text-ink-2",
              )}
            >
              {project?.name ?? "No project"}
            </span>
          </button>
        </CollapsibleTrigger>
        {create?.enabled && (
          <IconButton
            size="icon-xs"
            className={hoverSlot}
            label={create.ariaLabel ?? create.label}
            tooltip={create.label}
            onClick={() => run(create)}
          >
            <ProjectCommandIconView icon={create.icon} />
          </IconButton>
        )}
        {project && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className={hoverSlot}
                aria-label={`Project menu for ${project.name}`}
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {menu.map((c) => (
                  <DropdownMenuItem key={c.id} disabled={!c.enabled} onSelect={() => run(c)}>
                    <ProjectCommandIconView icon={c.icon} /> {c.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <CollapsibleContent className="disclosure-content">
        {members.length === 0 ? (
          <ListEmpty>No sessions yet</ListEmpty>
        ) : (
          <SessionRows
            className="flex flex-col gap-1 py-1"
            sessions={members}
            state={state}
            select={select}
            reveal={reveal}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function FolderGroup({
  folder,
  sessions,
  open,
  onOpenChange,
  state,
  select,
  reveal,
}: GroupProps & { folder: FolderView; sessions: readonly SessionEntry[] }) {
  const [enter] = useState(reveal);
  const { run } = useCommands();
  const [create, close] = folderCommands(state, folder);

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className={cn(groupRow, enter)}>
        <CollapsibleTrigger asChild>
          <button type="button" className={groupTrigger} title={folder.path}>
            <Chevron open={open} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-2">
              {folder.name}
            </span>
          </button>
        </CollapsibleTrigger>
        <IconButton
          size="icon-xs"
          className={hoverSlot}
          label={create.ariaLabel ?? create.label}
          tooltip={create.label}
          onClick={() => run(create)}
        >
          <PlusIcon />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className={hoverSlot}
              aria-label={`Folder menu for ${folder.name}`}
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={!close.enabled} onSelect={() => run(close)}>
                <XIcon /> {close.label}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {folder.discovery.status === "error" && (
        <Badge
          variant="destructive"
          className="ml-7 animate-in fade-in-0"
          title={folder.discovery.detail}
        >
          Git status unavailable
        </Badge>
      )}
      <CollapsibleContent className="disclosure-content">
        {sessions.length === 0 ? (
          <ListEmpty>No sessions yet</ListEmpty>
        ) : (
          <SessionRows
            className="flex flex-col gap-1 py-1"
            sessions={sessions}
            state={state}
            select={select}
            reveal={reveal}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
