import { isWorking } from "@shared/sessionProjection";
import { cn } from "cn";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  FilesIcon,
  FolderInputIcon,
  LinkIcon,
} from "lucide-react";
import { type ReactNode, type RefObject, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CommandIcon,
  useCommands,
  useSessionCommands,
  useSessionProjectMenu,
} from "@/components/CommandHost";
import { PianoButton } from "@/components/PianoButton";
import { SheetClose, SheetContent, SheetTitle } from "@/components/PianoSheet";
import { ProjectCommandIconView } from "@/components/Projects";
import { SessionLinks, SessionLinksBrowser } from "@/components/SessionLinks";
import { SessionOutputs } from "@/components/SessionOutputs";
import { PreviewRailRow, useSeenPreview } from "@/components/SessionPreview";
import { SessionEnvironment } from "@/components/SessionRail";
import { RailLeaveProvider } from "@/components/SessionRailList";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { returnFocusForKeyboard } from "@/lib/pointerClose";
import type { ProjectCommand } from "@/lib/projectCommands";
import { type SessionCommand, sessionHeaderMenu } from "@/lib/sessionCommands";
import { sessionContext } from "@/lib/sessionContext";
import { sessionLinks } from "@/lib/sessionLinks";
import { useSessionFiles } from "@/lib/useSessionFiles";

type Page = "actions" | "projects" | "outputs" | "links" | "all-links";

/** Links' recent entries before Show all, as in the session rail. */
const RECENT_LINKS = 5;

/** A full-width, 44px row with 16px icons, shared by buttons and the display switch's label. */
const row =
  "h-11 w-full justify-start gap-3 border border-transparent px-3 text-base font-normal [&_svg]:size-4 [&_svg]:shrink-0";

/** The selectable session ID, shared by the header menu and the phone sheet. */
export function SessionDetails({
  sessionId,
  className,
}: {
  sessionId?: string;
  className?: string;
}) {
  return (
    // Static, selectable metadata has no menu-item primitive; a definition list keeps field names accessible.
    <dl
      className={cn(
        "flex min-w-0 flex-1 select-text flex-col gap-1 py-2 font-mono text-xs",
        className,
      )}
    >
      <div className="min-w-0">
        <dt className="sr-only">Session ID</dt>
        <dd className="break-all text-muted-foreground">{sessionId ?? "Not available"}</dd>
      </div>
    </dl>
  );
}

/** A descriptor as a sheet row; running it closes the sheet, as choosing a menu item would. */
function SessionCommandRow({
  command,
  run,
}: {
  command: SessionCommand;
  run: (command: SessionCommand) => void;
}) {
  return (
    <SheetClose asChild>
      <Button
        variant="ghost"
        className={cn(row, command.destructive && "text-destructive hover:text-destructive")}
        disabled={!command.enabled}
        onClick={() => run(command)}
      >
        <CommandIcon icon={command.icon} /> {command.label}
      </Button>
    </SheetClose>
  );
}

/** A project command as a sheet row, by its icon and label unless `children` names it. */
function ProjectCommandRow({
  command,
  run,
  children,
}: {
  command: ProjectCommand;
  run: (command: ProjectCommand) => void;
  children?: React.ReactNode;
}) {
  return (
    <SheetClose asChild>
      <Button
        variant="ghost"
        className={row}
        disabled={!command.enabled}
        onClick={() => run(command)}
      >
        <ProjectCommandIconView icon={command.icon} /> {children ?? command.label}
      </Button>
    </SheetClose>
  );
}

/** A row that pushes a second pane: its icon and name, an optional count, then a chevron. */
function PaneRow({
  icon,
  count,
  onClick,
  disabled,
  children,
}: {
  icon: ReactNode;
  count?: number;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button variant="ghost" className={row} disabled={disabled} onClick={onClick}>
      {icon} {children}
      {count !== undefined && <span className="text-sm text-muted-foreground">{count}</span>}
      <ChevronRightIcon className="ml-auto text-muted-foreground" />
    </Button>
  );
}

/** A pushed pane's header: Back, then its title, an optional count and an action at the end. */
function PaneHeader({
  title,
  count,
  onBack,
  action,
}: {
  title: string;
  count?: number;
  onBack: () => void;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-lg"
        className="size-11 shrink-0"
        aria-label="Back"
        onClick={onBack}
      >
        <ArrowLeftIcon />
      </Button>
      <SheetTitle className="flex min-w-0 flex-1 items-center gap-2 text-base">
        <span className="truncate">{title}</span>
        {count !== undefined && (
          <span className="text-sm font-normal text-muted-foreground">{count}</span>
        )}
      </SheetTitle>
      {action}
    </div>
  );
}

/**
 * The phone session menu: a bottom sheet with every action on one level. On top, the session
 * rail's facts, which the header has no room for: Environment's rows and, while a preview is
 * known, App's; Outputs and Links push a pane of their own. Then the details and their copy
 * button, as the desktop menu has them, and the actions. The project picker also pushes a pane.
 * A rail row that goes elsewhere in the session (a file, Preview, a message) calls `onLeave`,
 * which closes the sheet and leaves focus to that destination.
 */
export function MobileSessionSheet({
  onLeave,
  onDismissFocus,
}: {
  onLeave: () => void;
  /** Where focus returns when Escape or a tap outside dismisses the sheet. */
  onDismissFocus: RefObject<HTMLElement | null>;
}) {
  const { state } = useCommands();
  const { commands, run } = useSessionCommands();
  const { sessionId } = sessionContext(state);
  const projects = useSessionProjectMenu();
  const preview = useSeenPreview(state);
  const files = useSessionFiles();
  const messages = state.session?.messages ?? [];
  const working = !!state.session && isWorking(state.session.state);
  const links = useMemo(() => sessionLinks(messages).reverse(), [messages]);
  const left = useRef(false);
  const dismissed = useRef(false);
  const leave = () => {
    left.current = true;
    onLeave();
  };
  const [page, setPage] = useState<Page>("actions");
  const pane = useRef<HTMLDivElement>(null);
  const previousPage = useRef(page);
  useLayoutEffect(() => {
    if (previousPage.current === page) return;
    previousPage.current = page;
    // Replacing the pressed row must not strand focus on the document body.
    pane.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, [page]);

  const menu = sessionHeaderMenu(commands);
  const { display } = menu;
  const rows = (section: SessionCommand[]) =>
    section.map((c) => <SessionCommandRow key={c.id} command={c} run={run} />);

  return (
    <SheetContent
      side="bottom"
      showCloseButton={false}
      aria-describedby={undefined}
      className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl p-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      onOpenAutoFocus={() => {
        // Each opening starts on the first pane with nothing chosen yet.
        left.current = false;
        dismissed.current = false;
        setPage("actions");
      }}
      onEscapeKeyDown={() => {
        dismissed.current = true;
      }}
      onInteractOutside={() => {
        dismissed.current = true;
      }}
      onCloseAutoFocus={(event) => {
        // A destination owns focus; a dismissal returns it to the menu's button, as the rail's
        // toggle did; choosing an action returns it only when the keyboard chose.
        if (left.current) event.preventDefault();
        else if (dismissed.current) {
          event.preventDefault();
          onDismissFocus.current?.focus({ preventScroll: true });
        } else returnFocusForKeyboard(event);
      }}
    >
      <RailLeaveProvider value={leave}>
        <div ref={pane} className="flex flex-col">
          {page === "actions" && (
            <>
              <SheetTitle className="sr-only">Session</SheetTitle>
              {state.session && (
                <div className="flex flex-col gap-2 p-1 pb-2">
                  <SessionEnvironment state={state} />
                  {preview && <PreviewRailRow preview={preview} />}
                </div>
              )}
              {files.length > 0 && (
                <PaneRow icon={<FilesIcon />} onClick={() => setPage("outputs")}>
                  Outputs
                </PaneRow>
              )}
              {links.length > 0 && (
                <PaneRow icon={<LinkIcon />} count={links.length} onClick={() => setPage("links")}>
                  Links
                </PaneRow>
              )}
              {(files.length > 0 || links.length > 0) && <Separator className="my-1" />}
              <div className="flex items-center gap-1 pl-3">
                <SessionDetails sessionId={sessionId} />
                {menu.details.map((c) => (
                  <SheetClose asChild key={c.id}>
                    <PianoButton
                      variant="ghost"
                      size="row"
                      className="shrink-0"
                      aria-label={c.label}
                      disabled={!c.enabled}
                      onClick={() => run(c)}
                    >
                      <CommandIcon icon={c.icon} />
                    </PianoButton>
                  </SheetClose>
                ))}
              </div>
              <Separator className="my-1" />
              {rows(menu.manage)}
              {projects && (
                <Button
                  variant="ghost"
                  className={row}
                  disabled={!projects.entry.enabled}
                  onClick={() => setPage("projects")}
                >
                  <FolderInputIcon /> {projects.entry.label}
                  <ChevronRightIcon className="ml-auto text-muted-foreground" />
                </Button>
              )}
              {display && (
                <>
                  <Separator className="my-1" />
                  <Label className={cn(row, "flex justify-between rounded-md")}>
                    <span className="flex items-center gap-3">
                      <CommandIcon icon={display.icon} /> {display.label}
                    </span>
                    <Switch checked={!!display.checked} onCheckedChange={() => run(display)} />
                  </Label>
                </>
              )}
              <Separator className="my-1" />
              {rows(menu.destructive)}
            </>
          )}
          {page === "outputs" && (
            <>
              <PaneHeader title="Outputs" onBack={() => setPage("actions")} />
              <Separator className="my-1" />
              <div className="p-1">
                <SessionOutputs files={files} cwd={state.session?.cwd} />
              </div>
            </>
          )}
          {page === "links" && (
            <>
              <PaneHeader
                title="Links"
                count={links.length}
                onBack={() => setPage("actions")}
                action={
                  links.length > RECENT_LINKS && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-11"
                      onClick={() => setPage("all-links")}
                    >
                      Show all
                    </Button>
                  )
                }
              />
              <Separator className="my-1" />
              <div className="p-1">
                <SessionLinks
                  links={links.slice(0, RECENT_LINKS)}
                  messages={messages}
                  working={working}
                />
              </div>
            </>
          )}
          {page === "all-links" && (
            <>
              <SheetTitle className="sr-only">Links</SheetTitle>
              <SessionLinksBrowser
                links={links}
                messages={messages}
                working={working}
                focusSearch={false}
                backLabel="Back"
                onBack={() => setPage("links")}
              />
            </>
          )}
          {page === "projects" && projects && (
            <>
              <PaneHeader title={projects.entry.label} onBack={() => setPage("actions")} />
              <Separator className="my-1" />
              {projects.current && (
                <p className="truncate px-3 py-1 text-xs text-muted-foreground">
                  {projects.current.name}
                </p>
              )}
              {projects.remove && (
                <>
                  <ProjectCommandRow command={projects.remove} run={run} />
                  <Separator className="my-1" />
                </>
              )}
              <ProjectCommandRow command={projects.create} run={run}>
                {projects.create.label}…
              </ProjectCommandRow>
              {projects.destinations.map((d) => (
                <ProjectCommandRow key={d.project.id} command={d.command} run={run}>
                  <span className="truncate">{d.project.name}</span>
                </ProjectCommandRow>
              ))}
            </>
          )}
        </div>
      </RailLeaveProvider>
    </SheetContent>
  );
}
