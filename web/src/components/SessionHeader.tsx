import { cn } from "cn";
import { ListIcon, MoreHorizontalIcon, XIcon } from "lucide-react";
import { useRef } from "react";
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
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/PianoSheet";
import { ProjectMenu } from "@/components/Projects";
import { type PullRequestControl, PullRequestLinkDialog } from "@/components/SessionPullRequest";
import { SessionRail } from "@/components/SessionRail";
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
import { sessionHeaderMenu } from "@/lib/sessionCommands";
import { sessionContext } from "@/lib/sessionContext";
import { useNavigation } from "@/lib/useNavigation";
import type { AppState } from "@/store";

/** The title (with its menu on desktop), shrinking to fit before the controls. */
const titleGroup = "flex min-w-0 items-center gap-0.5";

export function SessionHeader({
  state,
  status,
  pullRequest,
}: {
  state: AppState;
  status: string;
  /** The link dialog stays mounted even when Changes is hidden (the palette can open it). */
  pullRequest: PullRequestControl;
}) {
  const mobile = useIsMobile();
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const session = state.session;
  const { title, sessionId, cwd } = sessionContext(state);
  const { commands, run } = useSessionCommands();
  const menu = sessionHeaderMenu(commands);
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
       * One line: the project crumb and the title with its menu, then its controls at the end.
       * Where the session runs is in the session rail and, when shown, the sidebar row. */}
      <PaneHeader>
        {cwd ? (
          // Match header buttons by pointer capability: a landscape phone is wide but still touch.
          <div className="flex h-8 min-w-0 flex-1 items-center pointer-coarse:h-11">
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
          <SessionRailToggle state={state} />
          <ChangesToggle />
          {mobile && sessionMenu}
        </div>
      </PaneHeader>
      <PullRequestLinkDialog pr={pullRequest} fallbackTrigger={menuTrigger} />
    </>
  );
}

/**
 * The session rail's toggle, at the header's end beside the Agent area, over where the rail shows:
 * the saved column side by side, a transient sheet one area at a time. Both share content and
 * commands; only one presentation is mounted. The trigger is a button, never the composer.
 */
function SessionRailToggle({ state }: { state: AppState }) {
  const { commands, run } = useSessionCommands();
  const navigation = useNavigation();
  const { single, railSheet, surfaceRequest, closeRailSheet } = navigation;
  const shown = navigation.layout.rail;
  const trigger = useRef<HTMLButtonElement>(null);
  const command = commands.find((c) => c.id === "session-rail");
  if (!command) return null;
  return (
    <>
      <IconButton
        ref={trigger}
        data-rail-trigger
        size="header"
        label={command.label}
        aria-pressed={shown}
        aria-haspopup={single ? "dialog" : undefined}
        aria-expanded={single ? railSheet : undefined}
        onClick={() => run(command)}
        className="aria-pressed:bg-muted"
      >
        <ListIcon />
      </IconButton>
      <Sheet open={single && railSheet} onOpenChange={(open) => !open && closeRailSheet()}>
        {single && railSheet && (
          <SheetContent
            side="right"
            showCloseButton={false}
            aria-describedby={undefined}
            className="gap-0 pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              // A Surface destination owns focus after navigation. Dismissal (including resize)
              // returns to this stable button even when the sheet was opened from the palette.
              if (navigation.getState().surfaceRequest === surfaceRequest)
                trigger.current?.focus({ preventScroll: true });
            }}
          >
            <div className="flex shrink-0 items-center justify-between px-3 py-2">
              <SheetTitle>Session rail</SheetTitle>
              <SheetClose asChild>
                <IconButton size="header" label="Hide session rail">
                  <XIcon />
                </IconButton>
              </SheetClose>
            </div>
            <SessionRail state={state} sheet />
          </SheetContent>
        )}
      </Sheet>
    </>
  );
}

/**
 * Changes' toggle, always last at the header's end, on every layout: the Changes command, which
 * shows Changes in the Surface area, or, while Changes shows beside the Agent area, its tab's
 * Close ("Hide changes"), filled then, as the rail's toggle is. One area at a time it shows the
 * Changes area, and the tabs say which area shows. Left out while Changes cannot open; the
 * palette's Changes row says why.
 */
function ChangesToggle() {
  const { commands, run } = useSessionCommands();
  const navigation = useNavigation();
  const { single } = navigation.layout;
  const shown = navigation.shownTab === "changes";
  const command = commands.find((c) => c.id === "changes");
  if (!command?.enabled) return null;
  const closes = shown && !single;
  return (
    <IconButton
      data-changes-trigger
      size="header"
      label={closes ? surfaceTabNames("changes").close : command.label}
      aria-pressed={single ? undefined : shown}
      onClick={() => (closes ? navigation.closeTab("changes") : run(command))}
      className="aria-pressed:bg-muted"
    >
      <CommandIcon icon={command.icon} />
    </IconButton>
  );
}
