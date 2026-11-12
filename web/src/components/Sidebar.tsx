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
import { Fragment } from "react";
import { LayoutFooter, LayoutHeader } from "@/components/AppLayout";
import { useCommands, useGlobalCommands } from "@/components/CommandHost";
import { DisclosureChevron } from "@/components/Disclosure";
import { GlobalCommandIcon } from "@/components/GlobalCommandIcon";
import { IconButton } from "@/components/IconButton";
import { MachineSwitcher } from "@/components/MachineSwitcher";
import { PianoButton as Button } from "@/components/PianoButton";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { ProjectCommandIconView, ProjectCommandsMenu } from "@/components/Projects";
import { RowActions, rowActionsWidth } from "@/components/RowActions";
import { Hint } from "@/components/Shortcut";
import {
  sidebarRowClassName as row,
  sidebarRowGapClassName as rowGap,
  SidebarSessionList,
} from "@/components/SidebarSessionList";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { PALETTE_NAME } from "@/lib/commandPalette";
import type { RadioChoice } from "@/lib/commands";
import { folderCommands } from "@/lib/folderCommands";
import { type GlobalCommand, radioChoice } from "@/lib/globalCommands";
import type { Navigation } from "@/lib/navigation";
import { projectCommands } from "@/lib/projectCommands";
import type { SessionEntry } from "@/lib/sessionCatalog";
import type { SessionRowDetails, SidebarSection } from "@/lib/sidebarList";
import { useOffers } from "@/lib/useMachine";
import { useNarrowViewport } from "@/lib/useNarrowViewport";
import { useNavigation } from "@/lib/useNavigation";
import { useSidebarList } from "@/lib/useSidebarList";
import { useSidebarView } from "@/lib/useSidebarView";
import type { AppState } from "@/store";

interface Props {
  state: AppState;
}

/** Row actions sit over the row's end, inside its right padding (`RowActions`). */
const rowActions = "inset-y-0 right-1";
const groupRow = cn(
  row,
  "group relative flex items-center gap-1 rounded-lg pr-1 hover:bg-fill-hover",
);
const groupTrigger =
  "flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg pl-(--glyph-pad) text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

/**
 * The sidebar any machine shows, holding what its offers allow: Projects leads the list, and
 * Settings closes it only where it is offered, so a remote's sidebar lists its projects, catalog
 * and New session while the remote's own Piano manages the rest.
 */
export function Sidebar({ state }: Props) {
  const { openNew, openProjects, openSettings, setPalette } = useNavigation();
  const offers = useOffers();
  return (
    <div data-slot="session-sidebar" className="flex h-full flex-col">
      <LayoutHeader title={<MachineSwitcher />}>
        <IconButton
          size="header"
          label={PALETTE_NAME}
          tooltip={<Hint of={["mod", "K"]}>{PALETTE_NAME}</Hint>}
          onClick={() => setPalette(true)}
        >
          <SearchIcon />
        </IconButton>
        <ViewMenu />
        {/* The sidebar's one primary action, filled, at the header's end. */}
        <IconButton size="header" label="New session" variant="default" onClick={() => openNew()}>
          <SquarePenIcon />
        </IconButton>
      </LayoutHeader>
      {/* The way to the Projects index leads the list; it is the current row while the index is open, as a selected session row is. */}
      <div className="px-(--row-inset) py-2">
        <Button
          variant="ghost"
          leading
          className={cn(
            row,
            "w-full text-ink-2",
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
        {/* The list starts 8px below the Projects row and ends 16px above the footer or the sidebar's end. */}
        <nav className="relative px-(--row-inset) pb-4" aria-label="Sessions">
          <SidebarSessions state={state} />
        </nav>
      </ScrollArea>
      {offers.settings && (
        <LayoutFooter>
          <Button variant="ghost" leading className="flex-1" onClick={() => openSettings()}>
            <SettingsIcon data-icon="inline-start" />
            Settings
          </Button>
        </LayoutFooter>
      )}
    </div>
  );
}

/**
 * Pinned, then the catalog in this browser's grouping, sort and row details: one list for this
 * machine's catalog and a remote's. On a remote its groups carry no actions, since grouping by
 * folder or project only presents the remote's metadata. A machine that cannot be reached says
 * so in place of the loading rows; where folders are not offered, the empty state names the fact
 * alone, since its hints lead to starting in a folder this browser does not manage.
 */
export function SidebarSessions({ state }: Props) {
  const { select } = useNavigation();
  const offers = useOffers();
  const unavailable = state.unreachable ? "Machine unavailable" : undefined;
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
            details={s.details}
            {...groupProps}
          />
        );
      case "project":
        return (
          <ProjectGroup
            key={s.key}
            project={s.project}
            done={s.done}
            sessions={s.sessions}
            open={s.open}
            onOpenChange={onOpenChange}
            details={s.details}
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
            details={s.details}
            select={select}
          />
        );
      case "list":
        return (
          <SidebarSessionList
            key={s.key}
            sessions={s.sessions}
            details={s.details}
            select={select}
          />
        );
    }
  };
  const empty = (text: string) => (
    <Empty className="py-8">
      <EmptyHeader>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
  const list = () => {
    switch (body?.kind) {
      case undefined:
        return null;
      case "loading":
        return unavailable ? empty(unavailable) : <SidebarSkeleton />;
      case "empty":
        return empty(unavailable ?? (offers.folders ? body.text : "No sessions yet"));
      case "sections": {
        // Done projects' groups come last; one label says so for all of them.
        return (
          <div className="flex flex-col gap-1">
            {body.sections.map(section)}
            {body.done.length > 0 && (
              <div role="group" aria-labelledby="sidebar-done" className="flex flex-col gap-1">
                <div
                  id="sidebar-done"
                  className="px-(--glyph-pad) pt-3 pb-1 text-xs font-medium text-ink-3"
                >
                  Done
                </div>
                {body.done.map(section)}
              </div>
            )}
          </div>
        );
      }
    }
  };

  return (
    <>
      {pinned && (
        <SidebarGroup
          label="Pinned"
          aria-label="Pinned"
          sessions={pinned.sessions}
          open={pinned.open}
          onOpenChange={(open) => toggle(pinned.key, open)}
          details={pinned.details}
          select={select}
          className="mb-1"
        />
      )}
      {list()}
    </>
  );
}

/** One menu for grouping, sorting and what each row shows; appearance lives here too. Each choice is a global command, as the palette offers it. */
export function ViewMenu() {
  const { commands, run } = useGlobalCommands();
  const narrow = useNarrowViewport();
  const groupBy = radioChoice(commands, "group-by");
  const sortBy = radioChoice(commands, "sort-by");
  const appearance = radioChoice(commands, "appearance");
  const folderAndBranch = commands.find((c) => c.id === "folder-and-branch");
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
  // These bounded choices fit one scrollable menu; a side-opening submenu cannot fit a phone.
  const section = (label: string, items: React.ReactNode, current?: RadioChoice<GlobalCommand>) =>
    narrow ? (
      <DropdownMenuGroup aria-label={label}>
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {items}
      </DropdownMenuGroup>
    ) : (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{current ? choice(label, current) : label}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>{items}</DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="header" aria-label="View options">
              <SlidersHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>View options</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className={cn(
          "min-w-48",
          narrow && "max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto",
        )}
      >
        {section(
          "Group by",
          // No grouping comes last, set apart from the groupings.
          radio(groupBy, (c) => (
            <Fragment key={c.id}>
              {c.id === "group-none" && <DropdownMenuSeparator />}
              <DropdownMenuRadioItem value={c.id}>{c.menuLabel}</DropdownMenuRadioItem>
            </Fragment>
          )),
          groupBy,
        )}
        {section(
          "Sort by",
          radio(sortBy, (c) => (
            <DropdownMenuRadioItem key={c.id} value={c.id}>
              {c.menuLabel}
            </DropdownMenuRadioItem>
          )),
          sortBy,
        )}
        {folderAndBranch &&
          section(
            "Show",
            <DropdownMenuCheckboxItem
              checked={!!folderAndBranch.pressed}
              onCheckedChange={() => run(folderAndBranch)}
            >
              <GlobalCommandIcon icon={folderAndBranch.icon} /> {folderAndBranch.menuLabel}
            </DropdownMenuCheckboxItem>,
          )}
        <DropdownMenuSeparator />
        {section(
          "Appearance",
          // The chosen mode carries the check; the icons say what each one does.
          radio(appearance, (c) => (
            <DropdownMenuRadioItem key={c.id} value={c.id}>
              <GlobalCommandIcon icon={c.icon} /> {c.menuLabel}
            </DropdownMenuRadioItem>
          )),
          appearance,
        )}
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
          <div className={cn(row, "flex items-center gap-1.5 pl-(--glyph-pad)")}>
            <Skeleton className="size-4 rounded-sm" />
            <Skeleton className={cn("h-3.5", group ? "w-16" : "w-24")} />
          </div>
          {group === 0 && (
            <ul className={cn("flex flex-col py-1", rowGap)}>
              {[36, 44].map((w) => (
                <li key={w} className={cn(row, "flex items-center gap-2 pl-(--glyph-pad)")}>
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
  details: SessionRowDetails | undefined;
}

const Chevron = ({ open }: { open: boolean }) => (
  <DisclosureChevron open={open} className="size-4" />
);

/**
 * The sidebar's one disclosure group: a row whose name folds it, with the group's actions in the
 * hover slot after it, and its session rows beneath. Pinned, each date group, each folder and each
 * project are this group; an empty one (only a folder or project can be) says so in one row.
 */
function SidebarGroup({
  label,
  muted = false,
  done = false,
  title,
  "aria-label": ariaLabel,
  className,
  actions,
  notice,
  sessions,
  open,
  onOpenChange,
  details,
  select,
}: Omit<GroupProps, "state"> & {
  label: string;
  /** A group that stands for the absence of one (No project) reads quieter. */
  muted?: boolean;
  /** A done project's group: its name drops to regular weight, quieter without losing contrast. */
  done?: boolean;
  /** The trigger's tooltip, for a name that shortens something longer (a folder's path). */
  title?: string;
  "aria-label"?: string;
  className?: string;
  /** The row's actions, each an `icon-xs` button; `false` leaves one out. */
  actions?: readonly (React.ReactElement | false | null | undefined)[];
  /** A line between the row and its sessions, shown folded or not. */
  notice?: React.ReactNode;
  sessions: readonly SessionEntry[];
}) {
  const shown = (actions ?? []).filter((a) => !!a);
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      aria-label={ariaLabel}
      className={className}
    >
      <div
        data-row
        className={cn(
          groupRow,
          rowActionsWidth.row[shown.length as keyof typeof rowActionsWidth.row],
        )}
      >
        <CollapsibleTrigger asChild>
          <button type="button" className={groupTrigger} title={title}>
            <Chevron open={open} />
            <span
              data-motion="yield"
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                done ? "font-normal" : "font-medium",
                muted ? "text-ink-3" : "text-ink-2",
              )}
            >
              {label}
            </span>
          </button>
        </CollapsibleTrigger>
        {shown.length > 0 && <RowActions className={rowActions}>{shown}</RowActions>}
      </div>
      {notice}
      <CollapsibleContent className="disclosure-content">
        {sessions.length === 0 ? (
          <ListEmpty>No sessions yet</ListEmpty>
        ) : (
          <SidebarSessionList grouped sessions={sessions} details={details} select={select} />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A project: the same disclosure group as a folder, whose rows come from any folder. Without a project it is the No project group. */
function ProjectGroup({
  project,
  done,
  sessions,
  open,
  onOpenChange,
  details,
  state,
  select,
}: GroupProps & {
  project: Project | null;
  done: boolean;
  sessions: readonly SessionEntry[];
}) {
  const { run } = useCommands();
  const commands = project ? projectCommands(state, project) : [];
  const create = commands.find((c) => c.id === "new-session");
  // The group's name only folds it; its New session in project button opens the project's home.
  // A done project reads as quietly as No project: its sessions are listed, the project is set aside.
  return (
    <SidebarGroup
      label={project?.name ?? "No project"}
      muted={!project || done}
      done={done}
      sessions={sessions}
      open={open}
      onOpenChange={onOpenChange}
      details={details}
      select={select}
      actions={[
        create?.enabled && (
          <IconButton
            key="new"
            size="row"
            label={create.ariaLabel ?? create.label}
            tooltip={create.label}
            onClick={() => run(create)}
          >
            <ProjectCommandIconView icon={create.icon} />
          </IconButton>
        ),
        project && (
          <ProjectCommandsMenu
            key="menu"
            project={project}
            commands={commands}
            run={run}
            size="row"
          />
        ),
      ]}
    />
  );
}

function FolderGroup({
  folder,
  sessions,
  open,
  onOpenChange,
  details,
  state,
  select,
}: GroupProps & { folder: FolderView; sessions: readonly SessionEntry[] }) {
  const { run } = useCommands();
  // Where folders are not offered, a folder is presentation, not something to manage.
  const offers = useOffers();
  const { create, close } = folderCommands(state, folder);

  return (
    <SidebarGroup
      label={folder.name}
      title={folder.path}
      sessions={sessions}
      open={open}
      onOpenChange={onOpenChange}
      details={details}
      select={select}
      actions={[
        // Left out, not disabled, while the checkout is missing, as the Directory picker leaves it out.
        offers.folders && create.enabled && (
          <IconButton
            key="new"
            size="row"
            label={create.ariaLabel ?? create.label}
            tooltip={create.label}
            onClick={() => run(create)}
          >
            <SquarePenIcon />
          </IconButton>
        ),
        offers.folders && (
          <DropdownMenu key="menu">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="row" aria-label={`Folder menu for ${folder.name}`}>
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
        ),
      ]}
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
