import { LayoutFooter, LayoutHeader } from "@features/navigation/web/AppLayout";
import type {
  SessionRowDetails,
  SidebarList,
  SidebarListModel,
  SidebarSection,
} from "@features/navigation/web/sidebar/sidebarList";
import {
  sidebarRowGapClassName as rowGap,
  SidebarSessionList,
} from "@features/navigation/web/sidebar/SidebarSessionList";
import type { FolderView, Project } from "@shared/wire";
import { cn } from "cn";
import { SearchIcon, SettingsIcon, SquarePenIcon, TargetIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { DisclosureChevron } from "@/shared/components/Disclosure";
import { IconButton } from "@/shared/components/IconButton";
import { PianoButton as Button } from "@/shared/components/PianoButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/PianoPopover";
import { RowActions, rowActionsWidth } from "@/shared/components/RowActions";
import { Hint } from "@/shared/components/Shortcut";
import { sidebarRowClassName as row } from "@/shared/lib/styles";
import type { Navigation } from "@/shared/navigation/navigation";
import { useNavigation } from "@/shared/navigation/useNavigation";
import type { SessionEntry } from "@/shared/state/sessionCatalog";
import type { AppState } from "@/shared/state/state";

interface Props {
  state: AppState;
}

type RowActionsList = readonly (React.ReactElement | false | null | undefined)[];

interface SessionsProps extends Props {
  list: SidebarList;
  toggle: SidebarListModel["toggle"];
  projectActions: (project: Project) => RowActionsList;
  folderActions: (folder: FolderView) => RowActionsList;
  sessionMenu: (session: SessionEntry) => React.ReactNode;
}

const rowActions = "inset-y-0 right-1";
const groupRow = cn(
  row,
  "group relative flex items-center gap-1 rounded-lg pr-1 hover:bg-fill-hover",
);
const groupTrigger =
  "flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg pl-(--glyph-pad) text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

export function Sidebar({
  searchLabel,
  viewMenu,
  ...props
}: SessionsProps & { searchLabel: string; viewMenu: React.ReactNode }) {
  const { state } = props;
  const { openNew, openProjects, openSettings, setPalette } = useNavigation();
  return (
    <div data-slot="session-sidebar" className="flex h-full flex-col">
      <LayoutHeader>
        <IconButton
          size="header"
          label={searchLabel}
          tooltip={<Hint of={["mod", "K"]}>{searchLabel}</Hint>}
          onClick={() => setPalette(true)}
        >
          <SearchIcon />
        </IconButton>
        {viewMenu}
        <IconButton size="header" label="New session" variant="default" onClick={() => openNew()}>
          <SquarePenIcon />
        </IconButton>
      </LayoutHeader>
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
        <nav className="relative px-(--row-inset) pb-4" aria-label="Sessions">
          <SidebarSessions {...props} />
        </nav>
      </ScrollArea>
      <LayoutFooter>
        <Button variant="ghost" leading className="flex-1" onClick={() => openSettings()}>
          <SettingsIcon data-icon="inline-start" />
          Settings
        </Button>
      </LayoutFooter>
    </div>
  );
}

function SidebarSessions({
  state,
  list: { pinned, body },
  toggle,
  projectActions,
  folderActions,
  sessionMenu,
}: SessionsProps) {
  const { select } = useNavigation();

  const groupProps = { state, select, sessionMenu };
  const section = (s: SidebarSection) => {
    const onOpenChange = (open: boolean) => toggle(s.key, open);
    switch (s.kind) {
      case "folder":
        return (
          <FolderGroup
            key={s.key}
            folder={s.folder}
            actions={folderActions(s.folder)}
            sessions={s.sessions}
            open={s.open}
            onOpenChange={onOpenChange}
            details={s.details}
            {...groupProps}
          />
        );
      case "project":
        return (
          <SidebarGroup
            key={s.key}
            label={s.project?.name ?? "No project"}
            selectionId={state.selectionId}
            muted={!s.project || s.done}
            done={s.done}
            sessions={s.sessions}
            open={s.open}
            onOpenChange={onOpenChange}
            details={s.details}
            select={select}
            sessionMenu={sessionMenu}
            actions={s.project ? projectActions(s.project) : undefined}
          />
        );
      case "date":
        return (
          <SidebarGroup
            key={s.key}
            label={s.label}
            selectionId={state.selectionId}
            aria-label={s.label}
            sessions={s.sessions}
            open={s.open}
            onOpenChange={onOpenChange}
            details={s.details}
            select={select}
            sessionMenu={sessionMenu}
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
        return <SidebarSkeleton />;
      case "empty":
        return empty(body.text);
      case "sections": {
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
          selectionId={state.selectionId}
          aria-label="Pinned"
          sessions={pinned.sessions}
          open={pinned.open}
          onOpenChange={(open) => toggle(pinned.key, open)}
          details={pinned.details}
          select={select}
          sessionMenu={sessionMenu}
          className="mb-1"
        />
      )}
      {list()}
    </>
  );
}

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
  sessionMenu: (session: SessionEntry) => React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  details: SessionRowDetails | undefined;
}

const Chevron = ({ open }: { open: boolean }) => (
  <DisclosureChevron open={open} className="size-4" />
);

function SidebarGroup({
  label,
  selectionId,
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
  sessionMenu,
}: Omit<GroupProps, "state"> & {
  label: string;
  selectionId: string | null;
  muted?: boolean;
  done?: boolean;
  title?: string;
  "aria-label"?: string;
  className?: string;
  actions?: readonly (React.ReactElement | false | null | undefined)[];
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
        <CollapsibleTrigger
          render={
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
          }
        />
        {shown.length > 0 && <RowActions className={rowActions}>{shown}</RowActions>}
      </div>
      {notice}
      <CollapsibleContent className="disclosure-content">
        {sessions.length === 0 ? (
          <ListEmpty>No sessions yet</ListEmpty>
        ) : (
          <SidebarSessionList
            grouped
            sessions={sessions}
            selectionId={selectionId}
            details={details}
            select={select}
            sessionMenu={sessionMenu}
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
  details,
  state,
  select,
  sessionMenu,
  actions,
}: GroupProps & {
  actions: RowActionsList;
  folder: FolderView;
  sessions: readonly SessionEntry[];
}) {
  return (
    <SidebarGroup
      label={folder.name}
      selectionId={state.selectionId}
      title={folder.path}
      sessions={sessions}
      open={open}
      onOpenChange={onOpenChange}
      details={details}
      select={select}
      sessionMenu={sessionMenu}
      actions={actions}
      notice={
        folder.discovery.status === "error" && (
          <Popover>
            <PopoverTrigger
              render={
                <Badge
                  variant="destructive"
                  className="ml-7 cursor-pointer"
                  render={<button type="button">Git status unavailable</button>}
                />
              }
            />
            <PopoverContent
              align="start"
              className="w-auto max-w-sm text-xs break-words whitespace-pre-wrap"
            >
              {folder.discovery.detail}
            </PopoverContent>
          </Popover>
        )
      }
    />
  );
}
