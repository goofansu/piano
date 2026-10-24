import { cn } from "cn";
import { MoreHorizontalIcon } from "lucide-react";
import { useRef } from "react";
import { BranchLabel } from "@/components/BranchLabel";
import {
  CommandIcon,
  SessionCommandMenuItem,
  useSessionCommands,
  useSessionProjectMenu,
} from "@/components/CommandHost";
import { MobileSessionSheet, SessionDetails } from "@/components/MobileSessionSheet";
import { PaneHeader } from "@/components/Pane";
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
import { ProjectMenu } from "@/components/Projects";
import { SessionPreviewControl } from "@/components/SessionPreview";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { sessionHeaderMenu } from "@/lib/sessionCommands";
import { sessionContext } from "@/lib/sessionContext";
import type { AppState } from "@/store";

/** The title with its menu glued to it: the row's first item, so it shrinks last and never drops. */
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
  /** Renders the PR control, given the session menu it returns focus to while no PR is linked. */
  pullRequest: (menuTrigger: React.RefObject<HTMLButtonElement | null>) => React.ReactNode;
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
  const projectMenu = useSessionProjectMenu();
  const openProject = projectMenu?.open;
  const { display } = menu;
  const menuButton = (
    <Button
      ref={menuTrigger}
      variant="ghost"
      size="icon-sm"
      className="max-md:size-11"
      aria-label="Session information and actions"
      disabled={!session}
    >
      <MoreHorizontalIcon />
    </Button>
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
        <DropdownMenuGroup className="flex items-start">
          <SessionDetails
            className="px-2"
            cwd={session?.cwd}
            branch={branch}
            sessionId={sessionId}
          />
          {menu.details.map((c) => (
            <DropdownMenuItem
              key={c.id}
              className="-mt-1 size-11 shrink-0 justify-center md:-mt-1.5"
              aria-label={c.label}
              onSelect={() => run(c)}
            >
              <CommandIcon icon={c.icon} />
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
          <div className="flex h-8 min-w-0 flex-1 flex-wrap content-start items-center gap-x-3 overflow-hidden max-md:h-11">
            {openProject && projectMenu?.current ? (
              <Breadcrumb className={titleGroup}>
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
                    {sessionMenu}
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            ) : (
              <div className={titleGroup}>
                {heading}
                {sessionMenu}
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
        <div className="flex shrink-0 items-center gap-0.5">
          <SessionPreviewControl />
          {pullRequest(menuTrigger)}
        </div>
      </PaneHeader>
    </>
  );
}
