import type { FolderView, Project } from "@shared/wire";
import { cn } from "cn";
import {
  MoreHorizontalIcon,
  SearchIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SquarePenIcon,
  TargetIcon,
  XIcon,
} from "lucide-react";
import { Fragment, memo } from "react";
import { LayoutFooter, LayoutHeader } from "@/components/AppLayout";
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
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { Keys } from "@/components/PianoMark";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { ProjectCommandIconView, ProjectCommandsMenu, ProjectMenu } from "@/components/Projects";
import { Hint } from "@/components/Shortcut";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { RadioChoice } from "@/lib/commands";
import { folderCommands } from "@/lib/folderCommands";
import { type GlobalCommand, radioChoice } from "@/lib/globalCommands";
import type { Navigation } from "@/lib/navigation";
import { projectCommands, sessionProjectMenu } from "@/lib/projectCommands";
import type { SessionEntry } from "@/lib/sessionCatalog";
import { sessionRowMenu } from "@/lib/sessionCommands";
import type { SidebarSection } from "@/lib/sidebarList";
import { useNavigation } from "@/lib/useNavigation";
import { useSidebarList } from "@/lib/useSidebarList";
import { useSidebarView } from "@/lib/useSidebarView";
import { type AppState, sessionKey } from "@/store";

interface Props {
  state: AppState;
}

/** Row heights: 36px with a pointer, 44px on touch desktops, 48px on phones. */
const row = "h-9 pointer-coarse:h-11 max-md:h-12";
/** Row actions live in a fixed slot on the right and appear on hover, so nothing shifts. */
const hoverSlot =
  "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100";
const groupRow = cn(row, "group flex items-center gap-1 rounded-lg pr-1 hover:bg-fill-hover");
const groupTrigger =
  "flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg pl-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

export function Sidebar({ state }: Props) {
  const { select, openNew, openProjects, openSettings, setPalette } = useNavigation();
  const { view } = useSidebarView();
  const {
    list: { pinned, body },
    toggle,
  } = useSidebarList(state, view);

  const groupProps = { state, select };
  const section = (s: SidebarSection) => {
    const onOpenChange = (open: boolean) => toggle(s.key, open);
    switch (s.kind) {
      case "folder":
        return (
          <FolderGroup
            key={s.key}
            folder={s.folder}
            sessions={s.sessions}
            open={s.open}
            onOpenChange={onOpenChange}
            {...groupProps}
          />
        );
      case "project":
        return (
          <ProjectGroup
            key={s.key}
            project={s.project}
            sessions={s.sessions}
            open={s.open}
            onOpenChange={onOpenChange}
            {...groupProps}
          />
        );
      case "date":
        return (
          <SidebarGroup
            key={s.key}
            label={s.label}
            aria-label={s.label}
            sessions={s.sessions}
            open={s.open}
            onOpenChange={onOpenChange}
            select={select}
          />
        );
      case "list":
        return <SessionList key={s.key} sessions={s.sessions} {...groupProps} />;
    }
  };
  const list = () => {
    switch (body?.kind) {
      case undefined:
        return null;
      case "loading":
        return <SidebarSkeleton />;
      case "empty":
        return (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyDescription>{body.text}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        );
      case "sections":
        return <div className="flex flex-col gap-1">{body.sections.map(section)}</div>;
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
        {/* The sidebar's one primary action, filled, at the header's end. */}
        <IconButton label="New session" variant="default" onClick={() => openNew()}>
          <SquarePenIcon />
        </IconButton>
      </LayoutHeader>
      {/* The way to the Projects index leads the list; it is the current row while the index is open, as a selected session row is. */}
      <div className="px-(--gutter) py-2">
        <Button
          variant="ghost"
          className={cn(
            row,
            "w-full justify-start text-ink-2",
            state.view.kind === "projects" &&
              "bg-(--selected) font-medium text-ink hover:bg-(--selected)",
          )}
          aria-current={state.view.kind === "projects" ? "page" : undefined}
          onClick={() => openProjects()}
        >
          <TargetIcon data-icon="inline-start" /> Projects
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav className="relative px-(--gutter) pb-4" aria-label="Sessions">
          {pinned && (
            <SidebarGroup
              label="Pinned"
              aria-label="Pinned"
              sessions={pinned.sessions}
              open={pinned.open}
              onOpenChange={(open) => toggle(pinned.key, open)}
              select={select}
              className="mb-1"
            />
          )}
          {list()}
        </nav>
      </ScrollArea>
      <LayoutFooter>
        <Button variant="ghost" className="flex-1 justify-start" onClick={() => openSettings()}>
          <SettingsIcon data-icon="inline-start" />
          Settings
        </Button>
      </LayoutFooter>
    </div>
  );
}

/** One menu for grouping and sorting the list; appearance lives here too. Each choice is a global command, as the palette offers it. */
function ViewMenu() {
  const { commands, run } = useGlobalCommands();
  const groupBy = radioChoice(commands, "group-by");
  const sortBy = radioChoice(commands, "sort-by");
  const appearance = radioChoice(commands, "appearance");
  // The label takes the slack so the current value sits beside the trigger's own chevron.
  const choice = (label: string, { currentLabel }: RadioChoice<GlobalCommand>) => (
    <>
      <span className="flex-1">{label}</span>
      <span className="text-muted-foreground">{currentLabel}</span>
    </>
  );
  const radio = (
    { value, items }: RadioChoice<GlobalCommand>,
    item: (c: GlobalCommand) => React.ReactNode,
  ) => (
    <DropdownMenuRadioGroup
      value={value}
      onValueChange={(id) => {
        const c = items.find((c) => c.id === id);
        if (c) run(c);
      }}
    >
      {items.map(item)}
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
          <DropdownMenuSubTrigger>{choice("Group by", groupBy)}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {/* No grouping comes last, set apart from the groupings. */}
            {radio(groupBy, (c) => (
              <Fragment key={c.id}>
                {c.id === "group-none" && <DropdownMenuSeparator />}
                <DropdownMenuRadioItem value={c.id}>{c.menuLabel}</DropdownMenuRadioItem>
              </Fragment>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{choice("Sort by", sortBy)}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {radio(sortBy, (c) => (
              <DropdownMenuRadioItem key={c.id} value={c.id}>
                {c.menuLabel}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{choice("Appearance", appearance)}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {/* The chosen mode carries the check; the icons say what each one does. */}
            {radio(appearance, (c) => (
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

interface GroupProps extends Pick<Props, "state">, Pick<Navigation, "select"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** One line per session: the title alone. Location and project live in the session header and the groupings. */
const SessionRow = memo(
  function SessionRow({
    t,
    select,
  }: {
    t: SessionEntry;
  } & Pick<GroupProps, "select">) {
    const target = { cwd: t.cwd, sessionId: t.sessionId, title: t.title };
    const { selected, disabled, hint, activity } = t;
    // The keys play while the session works; afterwards Herdr's dots: tidal-blue done, hollow sage idle, nothing when no process.
    const dot = activity === "done" ? "bg-done" : activity === "idle" ? "border border-ok" : null;
    return (
      <li
        className={cn(
          row,
          "group flex items-center rounded-lg pr-1 hover:bg-fill-hover",
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
              dot && <span className={cn("size-2 rounded-full", dot)} />
            )}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              selected && "font-medium",
              !t.title && "text-ink-3",
            )}
          >
            {t.label}
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
              className={cn(hoverSlot, "max-md:hidden")}
              aria-label={`Session menu for ${t.label}`}
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <SessionMenu target={target} />
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    );
  },
  (previous, next) =>
    previous.select === next.select &&
    // Compare every catalog field, not the changing AppState.
    Object.keys(previous.t).every(
      (key) => previous.t[key as keyof SessionEntry] === next.t[key as keyof SessionEntry],
    ),
);

/** Closed row menus must not subscribe to every streamed token or compute commands. */
function SessionMenu({
  target,
}: {
  target: { cwd: string; sessionId: string; title: string | undefined };
}) {
  const { state } = useCommands();
  const { commands, run } = useSessionCommands(target);
  const { sections } = sessionRowMenu(commands);
  return (
    <>
      {sections.map((section) => (
        <Fragment key={section[0]?.id}>
          <DropdownMenuGroup>
            {section.map((c) => (
              <SessionCommandMenuItem key={c.id} command={c} run={run} />
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </Fragment>
      ))}
      <DropdownMenuGroup>
        <ProjectMenu menu={sessionProjectMenu(state, target)} run={run} />
      </DropdownMenuGroup>
    </>
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
}: Pick<GroupProps, "select"> & {
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
  select,
}: Omit<GroupProps, "open" | "onOpenChange"> & { sessions: readonly SessionEntry[] }) {
  return <SessionRows className="flex flex-col gap-1" sessions={sessions} select={select} />;
}

/**
 * The sidebar's one disclosure group: a row whose name folds it, with the group's actions in the
 * hover slot after it, and its session rows beneath. Pinned, each date group, each folder and each
 * project are this group; an empty one (only a folder or project can be) says so in one row.
 */
function SidebarGroup({
  label,
  muted = false,
  title,
  "aria-label": ariaLabel,
  className,
  actions,
  notice,
  sessions,
  open,
  onOpenChange,
  select,
}: Omit<GroupProps, "state"> & {
  label: string;
  /** A group that stands for the absence of one (No project) reads quieter. */
  muted?: boolean;
  /** The trigger's tooltip, for a name that shortens something longer (a folder's path). */
  title?: string;
  "aria-label"?: string;
  className?: string;
  actions?: React.ReactNode;
  /** A line between the row and its sessions, shown folded or not. */
  notice?: React.ReactNode;
  sessions: readonly SessionEntry[];
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      aria-label={ariaLabel}
      className={className}
    >
      <div className={groupRow}>
        <CollapsibleTrigger asChild>
          <button type="button" className={groupTrigger} title={title}>
            <Chevron open={open} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm font-medium",
                muted ? "text-ink-3" : "text-ink-2",
              )}
            >
              {label}
            </span>
          </button>
        </CollapsibleTrigger>
        {actions}
      </div>
      {notice}
      <CollapsibleContent className="disclosure-content">
        {sessions.length === 0 ? (
          <ListEmpty>No sessions yet</ListEmpty>
        ) : (
          <SessionRows className="flex flex-col gap-1 py-1" sessions={sessions} select={select} />
        )}
      </CollapsibleContent>
    </Collapsible>
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
}: GroupProps & { project: Project | null; sessions: readonly SessionEntry[] }) {
  const { run } = useCommands();
  const commands = project ? projectCommands(state, project) : [];
  const create = commands.find((c) => c.id === "new-session");
  // The group's name only folds it; its New session in project button opens the project's home.
  return (
    <SidebarGroup
      label={project?.name ?? "No project"}
      muted={!project}
      sessions={sessions}
      open={open}
      onOpenChange={onOpenChange}
      select={select}
      actions={
        <>
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
            <ProjectCommandsMenu
              project={project}
              commands={commands}
              run={run}
              size="icon-xs"
              className={hoverSlot}
            />
          )}
        </>
      }
    />
  );
}

function FolderGroup({
  folder,
  sessions,
  open,
  onOpenChange,
  state,
  select,
}: GroupProps & { folder: FolderView; sessions: readonly SessionEntry[] }) {
  const { run } = useCommands();
  const { create, close } = folderCommands(state, folder);

  return (
    <SidebarGroup
      label={folder.name}
      title={folder.path}
      sessions={sessions}
      open={open}
      onOpenChange={onOpenChange}
      select={select}
      actions={
        <>
          <IconButton
            size="icon-xs"
            className={hoverSlot}
            label={create.ariaLabel ?? create.label}
            tooltip={create.label}
            onClick={() => run(create)}
          >
            <SquarePenIcon />
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
        </>
      }
      notice={
        folder.discovery.status === "error" && (
          <Badge variant="destructive" className="ml-7" title={folder.discovery.detail}>
            Git status unavailable
          </Badge>
        )
      }
    />
  );
}
