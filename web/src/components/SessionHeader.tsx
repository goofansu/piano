import { cn } from "cn";
import { ListIcon, MoreHorizontalIcon } from "lucide-react";
import { Fragment, useRef, useState } from "react";
import {
  CommandIcon,
  CommandLink,
  SessionCommandMenuItem,
  useOpenPreview,
  useSessionCommands,
  useSessionProjectMenu,
} from "@/components/CommandHost";
import { IconButton } from "@/components/IconButton";
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
import { ProjectMenu } from "@/components/Projects";
import { ArtifactsMenu } from "@/components/SessionArtifacts";
import { SessionDetails } from "@/components/SessionDetails";
import { SessionIdDetails } from "@/components/SessionIdDetails";
import { SessionMenuSheet } from "@/components/SessionMenuSheet";
import { type PullRequestControl, PullRequestLinkDialog } from "@/components/SessionPullRequest";
import { surfaceTabNames } from "@/components/SurfaceArea";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";
import { sessionHeaderMenu } from "@/lib/sessionCommands";
import { sessionContext, sessionPlace } from "@/lib/sessionContext";
import { useNarrowViewport } from "@/lib/useNarrowViewport";
import { useNavigation } from "@/lib/useNavigation";
import type { AppState } from "@/store";

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
  const openPreview = useOpenPreview();
  const narrowViewport = useNarrowViewport();
  const { single } = useNavigation();
  const sheet = narrowViewport || single;
  const [sheetOpen, setSheetOpen] = useState(false);
  if (!sheet && sheetOpen) setSheetOpen(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
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
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <SheetTrigger asChild>{menuButton}</SheetTrigger>
      <SessionMenuSheet
        key={sessionId}
        onLeave={() => setSheetOpen(false)}
        onDismissFocus={menuTrigger}
      />
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
          <SessionIdDetails className="px-2" sessionId={sessionId} />
          {menu.details.map((c) => (
            <DropdownMenuItem key={c.id} asChild disabled={!c.enabled} onSelect={() => run(c)}>
              <IconButton variant="ghost" size="row" className="shrink-0" label={c.label}>
                <CommandIcon icon={c.icon} />
              </IconButton>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {menu.sections.map((section) =>
          section === "project" && !projectMenu ? null : (
            <Fragment key={typeof section === "string" ? section : section[0]?.id}>
              <DropdownMenuSeparator />
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
        <span role="status" className="sr-only">
          {status}
        </span>
        <div className="-mr-(--glyph-pad) flex shrink-0 items-center gap-0.5">
          {openPreview && (
            <IconButton asChild size="header" label={openPreview.label}>
              <CommandLink command={openPreview}>
                <CommandIcon icon={openPreview.icon} />
              </CommandLink>
            </IconButton>
          )}
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
      label={closes ? surfaceTabNames("changes").close : command.label}
      aria-pressed={single ? undefined : shown}
      onClick={() => (closes ? navigation.closeTab("changes") : run(command))}
      className="aria-pressed:bg-muted"
    >
      <CommandIcon icon={command.icon} />
    </IconButton>
  );
}
