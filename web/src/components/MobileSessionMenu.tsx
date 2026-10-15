import {
  ArrowLeftIcon,
  ChevronRightIcon,
  FolderInputIcon,
  FolderMinusIcon,
  InfoIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import {
  CommandIcon,
  SessionCommandMenuItem,
  useCommands,
  useSessionCommands,
} from "@/components/CommandHost";
import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/PianoDropdownMenu";
import { ProjectDestinationItems } from "@/components/Projects";
import {
  assignProjectCommand,
  newProjectCommand,
  projectDestinations,
} from "@/lib/projectCommands";
import { type SessionCommandId, sessionMenu } from "@/lib/sessionCommands";
import { sessionContext } from "@/lib/sessionContext";

type Page = "actions" | "projects" | "options" | "details";

/** A single column on phones: secondary pages replace rows, never add a sideways submenu. */
export function MobileSessionMenu() {
  const { state, run } = useCommands();
  const { commands } = useSessionCommands();
  const { display } = sessionMenu(commands, "header");
  const { project, sessionId } = sessionContext(state);
  const session = state.session;
  const [page, setPage] = useState<Page>("actions");
  const group = useRef<HTMLDivElement>(null);
  const previousPage = useRef(page);
  useLayoutEffect(() => {
    if (previousPage.current === page) return;
    previousPage.current = page;
    const menu = group.current?.closest('[role="menu"]');
    if (menu) menu.scrollTop = 0;
    // Replacing the focused row must not strand keyboard focus on the document body.
    group.current?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')?.focus();
  }, [page]);

  const rows = (ids: SessionCommandId[]) =>
    ids.flatMap((id) => {
      const command = commands.find((c) => c.id === id);
      return command ? [<SessionCommandMenuItem key={id} command={command} run={run} />] : [];
    });
  const back = () => setPage(page === "details" ? "options" : "actions");
  const destination = (next: Page, label: string, icon: React.ReactNode, disabled = false) => (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={(event) => {
        event.preventDefault();
        setPage(next);
      }}
    >
      {icon} {label} <ChevronRightIcon className="ml-auto" />
    </DropdownMenuItem>
  );
  const target = session?.sessionId
    ? { cwd: session.cwd, sessionId: session.sessionId }
    : undefined;
  const create = newProjectCommand(state, target);

  return (
    <DropdownMenuContent
      align="end"
      collisionPadding={16}
      className="w-64 max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))] [&_[role^=menuitem]]:min-h-11"
      onCloseAutoFocus={() => setPage("actions")}
      onEscapeKeyDown={(event) => {
        if (page !== "actions") {
          event.preventDefault();
          back();
        }
      }}
    >
      <DropdownMenuGroup ref={group}>
        {page !== "actions" && (
          <DropdownMenuGroup className="sticky -top-1 z-10 bg-popover">
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                back();
              }}
            >
              <ArrowLeftIcon /> Back
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
        )}
        {page === "actions" && (
          <>
            {rows(["rename", "pin", "share"])}
            {destination(
              "projects",
              project ? "Move to project" : "Add to project",
              <FolderInputIcon />,
              !target,
            )}
            {destination("options", "Session options", <SlidersHorizontalIcon />)}
            <DropdownMenuSeparator />
            {rows(["archive", "delete"])}
          </>
        )}
        {page === "projects" && target && (
          <>
            {project && <DropdownMenuLabel className="truncate">{project.name}</DropdownMenuLabel>}
            {project && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!state.connected}
                  onSelect={() => run(assignProjectCommand(state, target, null))}
                >
                  <FolderMinusIcon /> Remove from project
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <ProjectDestinationItems
              create={create}
              projects={projectDestinations(state, project, { keepCurrent: false })}
              disabled={!state.connected}
              onCreate={() => run(create)}
              onPick={(id) => run(assignProjectCommand(state, target, id))}
            />
          </>
        )}
        {page === "options" && (
          <>
            {rows(["changes", "pull-request"])}
            {destination("details", "Session details", <InfoIcon />)}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Display</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={display?.value ?? ""}
              onValueChange={(id) => {
                const choice = display?.items.find((c) => c.id === id);
                if (choice) run(choice);
              }}
            >
              {display?.items.map((c) => (
                <DropdownMenuRadioItem key={c.id} value={c.id}>
                  <CommandIcon icon={c.icon} /> {c.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
        {page === "details" && (
          <>
            {/* Static selectable metadata has no menu-item primitive. */}
            <dl className="flex select-text flex-col gap-3 px-2 py-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Working directory</dt>
                <dd className="break-all font-mono">{session?.cwd}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Session ID</dt>
                <dd className="break-all font-mono">{sessionId ?? "Not available"}</dd>
              </div>
            </dl>
            <DropdownMenuSeparator />
            {rows(["copy-all"])}
          </>
        )}
      </DropdownMenuGroup>
    </DropdownMenuContent>
  );
}
