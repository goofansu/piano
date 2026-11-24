import { sessionHeaderMenu } from "@features/commands/web";
import {
  CommandIcon,
  SessionCommandMenuItem,
  useSessionCommands,
  useSessionProjectMenu,
} from "@features/commands/web/browser";
import { ProjectMenu } from "@features/projects/web/browser";
import { ArtifactsMenu } from "@features/radius/web/browser";
import { sessionPlace } from "@features/sessions/web/browser";
import { type PullRequestControl, PullRequestLinkDialog } from "@features/workspace/web/browser";
import { cn } from "cn";
import { ListIcon, MoreHorizontalIcon } from "lucide-react";
import { Fragment, useRef, useState } from "react";
import { SessionMenuSheet } from "@/app/sessions/SessionMenuSheet";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";
import { IconButton } from "@/shared/components/IconButton";
import { inspectorTabNames } from "@/shared/components/Inspector";
import { PaneHeader } from "@/shared/components/Pane";
import { PianoButton } from "@/shared/components/PianoButton";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/PianoDropdownMenu";
import { Sheet, SheetTrigger } from "@/shared/components/PianoSheet";
import { SessionDetails } from "@/shared/components/SessionDetails";
import { useNarrowViewport } from "@/shared/lib/useNarrowViewport";
import { useNavigation } from "@/shared/navigation/useNavigation";
import { sessionContext } from "@/shared/state/sessionContext";
import type { AppState } from "@/shared/state/state";

const titleGroup = "flex min-w-0 items-center gap-0.5";

export function SessionHeader({
  state,
  status,
  pullRequest,
}: {
  state: AppState;
  status: string;
  pullRequest: PullRequestControl;
}) {
  const narrowViewport = useNarrowViewport();
  const { single } = useNavigation();
  const sheet = narrowViewport || single;
  const [sheetOpen, setSheetOpen] = useState(false);
  if (!sheet && sheetOpen) setSheetOpen(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const sheetDismissed = useRef(false);
  const session = state.session;
  const context = sessionContext(state);
  const { title, sessionId, cwd } = context;
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
      data-session-menu
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
  const place = sheet && session ? sessionPlace(context) : undefined;
  const titleBlock = place ? (
    <div className="flex min-w-0 flex-col">
      {heading}
      <p className="flex min-w-0 items-center gap-2 text-xs text-ink-3">
        <SessionDetails folder={context.folderName} branch={place.ref?.name} />
      </p>
    </div>
  ) : (
    heading
  );
  const sessionMenu = sheet ? (
    <Sheet
      open={sheetOpen}
      onOpenChange={(open, { reason }) => {
        sheetDismissed.current = reason === "escape-key" || reason === "outside-press";
        setSheetOpen(open);
      }}
    >
      <SheetTrigger render={menuButton} />
      <SessionMenuSheet
        key={sessionId}
        onLeave={() => setSheetOpen(false)}
        dismissed={sheetDismissed}
        onDismissFocus={menuTrigger}
      />
    </Sheet>
  ) : (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger render={menuButton} />
      <DropdownMenuContent align="start" className="w-56 max-w-[calc(100vw-2rem)]">
        {menu.sections.map((section, i) =>
          section === "project" && !projectMenu ? null : (
            <Fragment key={typeof section === "string" ? section : section[0]?.id}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuGroup>
                {section === "project"
                  ? projectMenu && <ProjectMenu menu={projectMenu} run={run} />
                  : section === "display"
                    ? display && (
                        <DropdownMenuCheckboxItem
                          checked={!!display.checked}
                          onCheckedChange={() => run(display)}
                        >
                          <CommandIcon icon={display.icon} /> {display.label}
                        </DropdownMenuCheckboxItem>
                      )
                    : section.map((c) => (
                        <SessionCommandMenuItem key={c.id} command={c} run={run} />
                      ))}
              </DropdownMenuGroup>
            </Fragment>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <>
      <PaneHeader>
        {cwd ? (
          <div className="flex h-8 min-w-0 flex-1 items-center pointer-coarse:h-11">
            {openProject && projectMenu?.current ? (
              <Breadcrumb className={cn(titleGroup, narrowViewport && "h-full")}>
                <BreadcrumbList className="min-w-0 flex-nowrap gap-1.5 sm:gap-1.5">
                  <BreadcrumbItem className="hidden min-w-0 max-w-32 shrink-0 md:inline-flex">
                    <BreadcrumbLink
                      render={
                        <button
                          type="button"
                          className="min-w-0 truncate rounded-sm text-ink-3 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => run(openProject)}
                        >
                          <span className="sr-only">Project: </span>
                          {projectMenu.current.name}
                        </button>
                      }
                    />
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className="hidden text-ink-3/60 md:block">
                    /
                  </BreadcrumbSeparator>
                  <BreadcrumbItem className="min-w-0 gap-0.5">
                    {titleBlock}
                    {!narrowViewport && sessionMenu}
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            ) : (
              <div className={cn(titleGroup, narrowViewport && "h-full")}>
                {titleBlock}
                {!narrowViewport && sessionMenu}
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center">
            <Skeleton className="h-4 w-40" />
          </div>
        )}
        {!state.reconnecting && (
          <span role="status" className="sr-only">
            {status}
          </span>
        )}
        <div className="-mr-(--glyph-pad) flex shrink-0 items-center gap-0.5">
          <ArtifactsMenu state={state} />
          <ChangesToggle />
          <SessionRailToggle />
          {narrowViewport && sessionMenu}
        </div>
      </PaneHeader>
      <PullRequestLinkDialog pr={pullRequest} fallbackTrigger={menuTrigger} />
    </>
  );
}

function SessionRailToggle() {
  const { commands, run } = useSessionCommands();
  const navigation = useNavigation();
  const command = commands.find((c) => c.id === "session-rail");
  if (!command || command.hidden) return null;
  return (
    <IconButton
      data-rail-trigger
      size="header"
      label={command.label}
      aria-pressed={navigation.layout.rail}
      onClick={() => run(command)}
      className="aria-pressed:bg-muted"
    >
      <ListIcon />
    </IconButton>
  );
}

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
      label={closes ? inspectorTabNames("changes").close : command.label}
      aria-pressed={single ? undefined : shown}
      onClick={() => (closes ? navigation.closeTab("changes") : run(command))}
      className="aria-pressed:bg-muted"
    >
      <CommandIcon icon={command.icon} />
    </IconButton>
  );
}
