import { cn } from "cn";
import { ArrowLeftIcon, ChevronRightIcon, FolderInputIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import {
  CommandIcon,
  useCommands,
  useSessionCommands,
  useSessionProjectMenu,
} from "@/components/CommandHost";
import { SheetClose, SheetContent, SheetTitle } from "@/components/PianoSheet";
import { ProjectCommandIconView } from "@/components/Projects";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { returnFocusForKeyboard } from "@/lib/pointerClose";
import type { ProjectCommand } from "@/lib/projectCommands";
import { type SessionCommand, sessionHeaderMenu } from "@/lib/sessionCommands";
import { sessionContext } from "@/lib/sessionContext";

type Page = "actions" | "projects";

/** A full-width, 44px row; the sheet's own type size, not the 14px of a desktop menu. */
const row = "h-11 w-full justify-start gap-3 px-3 text-base font-normal";

/** The session's working directory, branch and ID, selectable, for the header menu and the phone sheet. */
export function SessionDetails({
  cwd,
  branch,
  sessionId,
  className,
}: {
  cwd?: string;
  /** Absent for a non-Git directory; the row then is not shown. */
  branch?: string;
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
        <dt className="sr-only">Working directory</dt>
        <dd className="break-all">{cwd}</dd>
      </div>
      {branch && (
        <div className="min-w-0">
          <dt className="sr-only">Git branch</dt>
          <dd className="break-all">{branch}</dd>
        </div>
      )}
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

/**
 * The phone session menu: a bottom sheet with every action on one level, the details and their
 * copy button on top as the desktop menu has them. Only the project picker pushes a second pane.
 */
export function MobileSessionSheet() {
  const { state } = useCommands();
  const { commands, run } = useSessionCommands();
  const { sessionId, branch } = sessionContext(state);
  const projects = useSessionProjectMenu();
  const session = state.session;
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
      onCloseAutoFocus={returnFocusForKeyboard}
    >
      <div ref={pane} className="flex flex-col">
        {page === "actions" && (
          <>
            <SheetTitle className="sr-only">Session</SheetTitle>
            <div className="flex items-start gap-1 pl-3">
              <SessionDetails cwd={session?.cwd} branch={branch} sessionId={sessionId} />
              {menu.details.map((c) => (
                <SheetClose asChild key={c.id}>
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    className="size-11 shrink-0"
                    aria-label={c.label}
                    onClick={() => run(c)}
                  >
                    <CommandIcon icon={c.icon} />
                  </Button>
                </SheetClose>
              ))}
            </div>
            <Separator className="my-1" />
            {rows(menu.open)}
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
        {page === "projects" && projects && (
          <>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-lg"
                className="size-11 shrink-0"
                aria-label="Back"
                onClick={() => setPage("actions")}
              >
                <ArrowLeftIcon />
              </Button>
              <SheetTitle className="min-w-0 truncate text-base">{projects.entry.label}</SheetTitle>
            </div>
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
    </SheetContent>
  );
}
