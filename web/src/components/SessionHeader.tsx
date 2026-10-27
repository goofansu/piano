import { cn } from "cn";
import { GitPullRequestIcon, ListIcon, MoreHorizontalIcon } from "lucide-react";
import { useRef } from "react";
import { BranchLabel } from "@/components/BranchLabel";
import {
  CommandIcon,
  SessionCommandMenuItem,
  useSessionCommands,
  useSessionProjectMenu,
} from "@/components/CommandHost";
import { IconButton } from "@/components/IconButton";
import { MobileSessionSheet, SessionDetails } from "@/components/MobileSessionSheet";
import { PaneHeader } from "@/components/Pane";
import { PianoButton } from "@/components/PianoButton";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { Sheet, SheetTrigger } from "@/components/PianoSheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { ProjectMenu } from "@/components/Projects";
import { SessionPreviewControl } from "@/components/SessionPreview";
import {
  type PullRequestControl,
  PullRequestLinkDialog,
  pullRequestStates,
  pullRequestViewOf,
} from "@/components/SessionPullRequest";
import { surfaceTabNames } from "@/components/SurfaceArea";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { reviewControl } from "@/lib/pullRequestView";
import { sessionHeaderMenu } from "@/lib/sessionCommands";
import { sessionContext } from "@/lib/sessionContext";
import { useNavigation } from "@/lib/useNavigation";
import type { AppState } from "@/store";

/** The title (with its menu on desktop): the row's first item, so it shrinks last and never drops. */
const titleGroup = "flex min-w-0 max-w-max shrink grow basis-52 items-center gap-0.5";

/** A fact about where the session runs: about 6rem on a tight row, else its own width. */
const fact = "flex min-w-0 max-w-max shrink grow basis-24 items-center text-xs text-ink-3";

export function SessionHeader({
  state,
  status,
  pullRequest,
}: {
  state: AppState;
  status: string;
  /** The session's pull request: the review control's face, and the link dialog the menu opens. */
  pullRequest: PullRequestControl;
}) {
  const mobile = useIsMobile();
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const session = state.session;
  const {
    title,
    branch,
    sessionId,
    cwd,
    folderName: folder,
    worktreeName: worktree,
  } = sessionContext(state);
  const { commands, run } = useSessionCommands();
  const menu = sessionHeaderMenu(commands);
  // The session rail's switch is offered only side by side, where the Agent area has a right side.
  const sideBySide = !!commands.find((c) => c.id === "session-rail")?.enabled;
  const projectMenu = useSessionProjectMenu();
  const openProject = projectMenu?.open;
  const { display } = menu;
  const menuButton = (
    <PianoButton
      ref={menuTrigger}
      variant="ghost"
      size="header"
      aria-label="Session information and actions"
      disabled={!session}
    >
      <MoreHorizontalIcon />
    </PianoButton>
  );
  const heading = (
    <h1 className="min-w-0 truncate text-sm font-medium text-ink">
      {session ? title : "New session"}
    </h1>
  );
  const sessionMenu = mobile ? (
    <Sheet>
      <SheetTrigger asChild>{menuButton}</SheetTrigger>
      <MobileSessionSheet key={sessionId} />
    </Sheet>
  ) : (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{menuButton}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={16}
        className="w-96 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuGroup className="flex items-center">
          <SessionDetails className="px-2" sessionId={sessionId} />
          {menu.details.map((c) => (
            <DropdownMenuItem key={c.id} asChild disabled={!c.enabled} onSelect={() => run(c)}>
              <PianoButton variant="ghost" size="row" className="shrink-0" aria-label={c.label}>
                <CommandIcon icon={c.icon} />
              </PianoButton>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {menu.open.map((c) => (
            <SessionCommandMenuItem key={c.id} command={c} run={run} />
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {menu.manage.map((c) => (
            <SessionCommandMenuItem key={c.id} command={c} run={run} />
          ))}
        </DropdownMenuGroup>
        {projectMenu && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <ProjectMenu menu={projectMenu} run={run} />
            </DropdownMenuGroup>
          </>
        )}
        {display && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuCheckboxItem
                checked={!!display.checked}
                onCheckedChange={() => run(display)}
              >
                <CommandIcon icon={display.icon} /> {display.label}
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {menu.destructive.map((c) => (
            <SessionCommandMenuItem key={c.id} command={c} run={run} />
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <>
      {/* Outside the transcript scroller: stays visible without an overlay or scroll listener.
       * One line: the project crumb and the title with its menu, then where the session runs,
       * then its controls at the end. */}
      <PaneHeader>
        {cwd ? (
          // Plain workspace metadata has no dedicated UI primitive. The row is one line tall and
          // wraps: an item that no longer fits moves to a second row the box hides, so each fact
          // drops out whole from the end, branch first, and only the title group shrinks.
          // Match header buttons by pointer capability: a landscape phone is wide but still touch.
          <div className="flex h-8 min-w-0 flex-1 flex-wrap content-start items-center gap-x-3 overflow-hidden pointer-coarse:h-11">
            {openProject && projectMenu?.current ? (
              <Breadcrumb className={cn(titleGroup, mobile && "h-full")}>
                <BreadcrumbList className="min-w-0 flex-nowrap gap-1.5 sm:gap-1.5">
                  {/* The crumb is the way up; on phones the sheet's project page covers it. */}
                  <BreadcrumbItem className="hidden min-w-0 max-w-32 shrink-0 md:inline-flex">
                    <BreadcrumbLink asChild>
                      <button
                        type="button"
                        className="min-w-0 truncate rounded-sm text-ink-3 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => run(openProject)}
                      >
                        <span className="sr-only">Project: </span>
                        {projectMenu.current.name}
                      </button>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className="hidden text-ink-3/60 md:block">
                    /
                  </BreadcrumbSeparator>
                  <BreadcrumbItem className="min-w-0 gap-0.5">
                    {heading}
                    {!mobile && sessionMenu}
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            ) : (
              <div className={cn(titleGroup, mobile && "h-full")}>
                {heading}
                {!mobile && sessionMenu}
              </div>
            )}
            <p className={fact}>
              <span className="sr-only">{worktree ? "Folder: " : "Working directory: "}</span>
              <span className="truncate">{folder}</span>
            </p>
            {branch && (
              <p className={cn(fact, "gap-1")}>
                <span className="sr-only">Git branch: </span>
                <BranchLabel branch={branch} className="min-w-0" />
              </p>
            )}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center">
            <Skeleton className="h-4 w-40" />
          </div>
        )}
        {/* The sidebar row shows the session's state; here it is only announced. */}
        <span role="status" className="sr-only">
          {status}
        </span>
        {/* Ghost controls: the group pulls out so the last one's content ends on the gutter. */}
        <div className="-mr-(--glyph-pad) flex shrink-0 items-center gap-0.5">
          <SessionPreviewControl />
          {sideBySide && <SessionRailToggle />}
          <ReviewToggle pr={pullRequest} />
          {mobile && sessionMenu}
        </div>
      </PaneHeader>
      <PullRequestLinkDialog pr={pullRequest} menuTrigger={menuTrigger} />
    </>
  );
}

/**
 * The session rail's toggle, at the header's end beside the Agent area, over where the rail shows:
 * the rail on or off for every session, its name ("Show session rail", "Hide session rail") saying
 * which, and filled while the rail shows, as Changes' Wrap toggle is while on.
 */
function SessionRailToggle() {
  const { commands, run } = useSessionCommands();
  const shown = useNavigation().layout.rail;
  const command = commands.find((c) => c.id === "session-rail");
  if (!command) return null;
  return (
    <IconButton
      size="header"
      label={command.label}
      aria-pressed={shown}
      onClick={() => run(command)}
      className="aria-pressed:bg-muted"
    >
      <ListIcon />
    </IconButton>
  );
}

/**
 * The review control, last at the header's end: the Changes command, which shows Changes in the
 * Surface area, or, while Changes shows beside the Agent area, its tab's Close ("Hide changes"),
 * filled then, as the rail's toggle is. Once a pull request is linked it wears the pull request's
 * face, the state's icon and `#123`, since the pull request is read in Changes; the state in
 * words is the row's. One area at a time it shows the Changes area, and the tabs say which
 * area shows. Left out while Changes cannot open; the palette's Changes row says why.
 */
function ReviewToggle({ pr }: { pr: PullRequestControl }) {
  const { commands, run } = useSessionCommands();
  const navigation = useNavigation();
  const { single } = navigation.layout;
  const shown = navigation.layout.surface && navigation.surface?.active === "changes";
  const command = commands.find((c) => c.id === "changes");
  if (!command?.enabled) return null;
  const face = reviewControl(pullRequestViewOf(pr), pr.loading);
  const label = shown && !single ? surfaceTabNames("changes").close : command.label;
  const onClick = () => (shown && !single ? navigation.closeTab("changes") : run(command));
  if (!face.text)
    return (
      <IconButton
        data-changes-trigger
        size="header"
        label={label}
        aria-pressed={single ? undefined : shown}
        onClick={onClick}
        className="aria-pressed:bg-muted"
      >
        <CommandIcon icon={command.icon} />
      </IconButton>
    );
  const Icon = face.state ? pullRequestStates[face.state].Icon : GitPullRequestIcon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PianoButton
          data-changes-trigger
          variant="ghost"
          size="sm"
          trailing
          aria-label={label}
          aria-description={face.description}
          aria-pressed={single ? undefined : shown}
          aria-busy={(pr.loading && !pr.value) || undefined}
          onClick={onClick}
          className="aria-pressed:bg-muted"
        >
          <Icon
            data-icon="inline-start"
            data-motion={pr.loading && !pr.value ? "pulse" : undefined}
            data-late=""
            className={face.state ? pullRequestStates[face.state].color : "text-muted-foreground"}
            aria-hidden
          />{" "}
          {face.text}
        </PianoButton>
      </TooltipTrigger>
      <TooltipContent className="max-w-80">
        <p className="text-wrap">{face.tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}
