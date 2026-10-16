import { GitBranchIcon, MoreHorizontalIcon, SplitIcon } from "lucide-react";
import { useRef } from "react";
import { CommandIcon, SessionCommandMenuItem, useSessionCommands } from "@/components/CommandHost";
import { MobileSessionSheet, SessionDetails } from "@/components/MobileSessionSheet";
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
import { ShowSidebarButton } from "@/components/ShowSidebarButton";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { sessionHeaderMenu } from "@/lib/sessionCommands";
import { sessionContext } from "@/lib/sessionContext";
import { useNavigation } from "@/lib/useNavigation";
import type { AppState } from "@/store";

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
  const { openNew } = useNavigation();
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const session = state.session;
  // `folder ⇄ worktree / ⑂ branch`; omit the redundant worktree segment for the root checkout.
  const {
    title,
    branch,
    sessionId,
    project,
    cwd,
    folderName: folder,
    worktreeName: worktree,
  } = sessionContext(state);
  const { commands, run } = useSessionCommands();
  const menu = sessionHeaderMenu(commands);
  const { display } = menu;
  const target = session?.sessionId
    ? { cwd: session.cwd, sessionId: session.sessionId }
    : undefined;
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
  return (
    <>
      {/* Outside the transcript scroller: stays visible without an overlay or scroll listener. */}
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3 md:px-6">
        <ShowSidebarButton className="-ml-2" />
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
          {cwd ? (
            <>
              <div className="col-span-2 flex min-w-0 flex-col gap-1 md:col-span-1">
                {/* The project is the way back to where this session was opened from. */}
                {project && (
                  <button
                    type="button"
                    className="-mb-0.5 max-w-full self-start truncate rounded text-xs text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => openNew(undefined, project.id)}
                  >
                    {project.name}
                  </button>
                )}
                <h1 className="truncate text-sm font-medium">{session ? title : "New session"}</h1>
              </div>
              {/* Plain workspace metadata has no dedicated UI primitive. */}
              <div className="col-start-1 row-start-2 flex min-w-0 items-center gap-2">
                {/* Full length while it fits. When space runs short each segment truncates to about 6rem, then
                drops out whole, branch first: the line may wrap, but only its first row shows. */}
                <div className="flex h-[1lh] min-w-0 flex-1 flex-wrap items-center gap-x-1.5 overflow-hidden text-xs text-muted-foreground">
                  <p className="max-w-full shrink-0 truncate">
                    <span className="sr-only">{worktree ? "Folder: " : "Working directory: "}</span>
                    {folder}
                  </p>
                  {worktree && (
                    <p className="flex min-w-0 max-w-max shrink grow basis-24 items-center gap-1 font-mono">
                      <SplitIcon aria-hidden="true" className="size-3 shrink-0 rotate-90" />
                      <span className="sr-only">Worktree: </span>
                      <span className="truncate">{worktree}</span>
                    </p>
                  )}
                  {branch && (
                    <p className="flex min-w-0 max-w-max shrink grow basis-24 items-center gap-1.5 font-mono">
                      {(folder || worktree) && (
                        <span aria-hidden="true" className="font-sans text-ink-3/60">
                          /
                        </span>
                      )}
                      <span className="flex min-w-0 items-center gap-1">
                        <GitBranchIcon aria-hidden="true" className="size-3 shrink-0" />
                        <span className="sr-only">Git branch: </span>
                        <span className="truncate">{branch}</span>
                      </span>
                    </p>
                  )}
                </div>
              </div>
              <div className="col-start-2 row-start-2 shrink-0 justify-self-end md:row-span-2 md:row-start-1">
                {pullRequest(menuTrigger)}
              </div>
            </>
          ) : (
            <>
              <Skeleton className="col-span-2 h-4 w-40" />
              <Skeleton className="col-span-2 h-3 w-28" />
            </>
          )}
        </div>
        <span role="status" className="sr-only">
          {status}
        </span>
        {mobile ? (
          <Sheet>
            <SheetTrigger asChild>{menuButton}</SheetTrigger>
            <MobileSessionSheet key={sessionId} />
          </Sheet>
        ) : (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>{menuButton}</DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              collisionPadding={16}
              className="w-96 max-w-[calc(100vw-2rem)]"
            >
              <DropdownMenuGroup className="flex items-start">
                <SessionDetails className="px-2" cwd={session?.cwd} sessionId={sessionId} />
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
                {target && <ProjectMenu state={state} session={target} run={run} />}
              </DropdownMenuGroup>
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
        )}
      </header>
    </>
  );
}
