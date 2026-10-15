import { cn } from "cn";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderInputIcon,
  FolderMinusIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { CommandIcon, useCommands, useSessionCommands } from "@/components/CommandHost";
import { SheetClose, SheetContent, SheetTitle } from "@/components/PianoSheet";
import { ProjectCommandIconView } from "@/components/Projects";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { returnFocusForKeyboard } from "@/lib/pointerClose";
import {
  assignProjectCommand,
  newProjectCommand,
  projectDestinations,
} from "@/lib/projectCommands";
import type { SessionCommand, SessionCommandId } from "@/lib/sessionCommands";
import { sessionContext } from "@/lib/sessionContext";

type Page = "actions" | "projects";

/** A full-width, 44px row; the sheet's own type size, not the 14px of a desktop menu. */
const row = "h-11 w-full justify-start gap-3 px-3 text-base font-normal";

/** The session's working directory and ID, selectable, for the header menu and the phone sheet. */
export function SessionDetails({
  cwd,
  sessionId,
  className,
}: {
  cwd?: string;
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
        className={cn(
          row,
          command.group === "destructive" && "text-destructive hover:text-destructive",
        )}
        disabled={!command.enabled}
        onClick={() => run(command)}
      >
        <CommandIcon icon={command.icon} /> {command.label}
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
  const { commands, run, display } = useSessionCommands();
  const { project, sessionId } = sessionContext(state);
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

  const command = (id: SessionCommandId) => commands.find((c) => c.id === id);
  const rows = (ids: SessionCommandId[]) =>
    ids.flatMap((id) => {
      const c = command(id);
      return c ? [<SessionCommandRow key={id} command={c} run={run} />] : [];
    });
  const copy = command("copy-all");
  const messagesOnly = command("display-messages");
  const everything = command("display-everything");
  const target = session?.sessionId
    ? { cwd: session.cwd, sessionId: session.sessionId }
    : undefined;
  const create = newProjectCommand(state, target);
  const projectLabel = project ? "Move to project" : "Add to project";

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
              <SessionDetails cwd={session?.cwd} sessionId={sessionId} />
              {copy && (
                <SheetClose asChild>
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    className="size-11 shrink-0"
                    aria-label={copy.label}
                    onClick={() => run(copy)}
                  >
                    <CommandIcon icon={copy.icon} />
                  </Button>
                </SheetClose>
              )}
            </div>
            <Separator className="my-1" />
            {rows(["changes", "pull-request"])}
            <Separator className="my-1" />
            {rows(["rename", "pin", "share"])}
            <Button
              variant="ghost"
              className={row}
              disabled={!target}
              onClick={() => setPage("projects")}
            >
              <FolderInputIcon /> {projectLabel}
              <ChevronRightIcon className="ml-auto text-muted-foreground" />
            </Button>
            <Separator className="my-1" />
            {messagesOnly && everything && (
              <Label className={cn(row, "flex justify-between rounded-md")}>
                <span className="flex items-center gap-3">
                  <CommandIcon icon={messagesOnly.icon} /> {messagesOnly.label}
                </span>
                <Switch
                  checked={display === "messages"}
                  onCheckedChange={(checked) => run(checked ? messagesOnly : everything)}
                />
              </Label>
            )}
            <Separator className="my-1" />
            {rows(["archive", "delete"])}
          </>
        )}
        {page === "projects" && target && (
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
              <SheetTitle className="min-w-0 truncate text-base">{projectLabel}</SheetTitle>
            </div>
            <Separator className="my-1" />
            {project && (
              <>
                <SheetClose asChild>
                  <Button
                    variant="ghost"
                    className={row}
                    disabled={!state.connected}
                    onClick={() => run(assignProjectCommand(state, target, null))}
                  >
                    <FolderMinusIcon />
                    <span className="truncate">Remove from {project.name}</span>
                  </Button>
                </SheetClose>
                <Separator className="my-1" />
              </>
            )}
            <SheetClose asChild>
              <Button
                variant="ghost"
                className={row}
                disabled={!create.enabled}
                onClick={() => run(create)}
              >
                <ProjectCommandIconView icon={create.icon} /> {create.label}…
              </Button>
            </SheetClose>
            {projectDestinations(state, project, { keepCurrent: false }).map((p) => (
              <SheetClose asChild key={p.id}>
                <Button
                  variant="ghost"
                  className={row}
                  disabled={!state.connected}
                  onClick={() => run(assignProjectCommand(state, target, p.id))}
                >
                  <FolderIcon />
                  <span className="truncate">{p.name}</span>
                </Button>
              </SheetClose>
            ))}
          </>
        )}
      </div>
    </SheetContent>
  );
}
