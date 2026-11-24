import { type SessionCommand, sessionHeaderMenu } from "@features/commands/web";
import {
  CommandIcon,
  useCommands,
  useSessionCommands,
  useSessionProjectMenu,
} from "@features/commands/web/browser";
import { pullRequestView } from "@features/workspace/web/browser";
import { cn } from "cn";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  CircleMinusIcon,
  ExternalLinkIcon,
  GitPullRequestIcon,
  TargetIcon,
} from "lucide-react";
import { Fragment, type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { PianoLinkButton } from "@/shared/components/PianoButton";
import { SheetClose, SheetContent, SheetTitle } from "@/shared/components/PianoSheet";
import { ProjectCommandIconView } from "@/shared/components/ProjectCommandIcon";
import { keyboardFocusReturn } from "@/shared/lib/pointerClose";
import type { ProjectCommand } from "@/shared/state/projectCommandTypes";
import { sessionContext } from "@/shared/state/sessionContext";

type Page = "actions" | "projects";

const row =
  "h-11 w-full justify-start gap-3 border border-transparent px-3 text-base font-normal [&_svg]:size-4 [&_svg]:shrink-0";

const value = "truncate text-sm font-normal text-muted-foreground";

function SessionCommandRow({
  command,
  run,
}: {
  command: SessionCommand;
  run: (command: SessionCommand) => void;
}) {
  return (
    <SheetClose
      render={
        <Button
          variant="ghost"
          className={cn(row, command.destructive && "text-destructive hover:text-destructive")}
          disabled={!command.enabled}
          onClick={() => run(command)}
        >
          <CommandIcon icon={command.icon} /> {command.label}
        </Button>
      }
    />
  );
}

function ProjectCommandRow({
  command,
  run,
  icon,
  children,
}: {
  command: ProjectCommand;
  run: (command: ProjectCommand) => void;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <SheetClose
      render={
        <Button
          variant="ghost"
          className={row}
          disabled={!command.enabled}
          onClick={() => run(command)}
        >
          {icon ?? <ProjectCommandIconView icon={command.icon} />} {children ?? command.label}
        </Button>
      }
    />
  );
}

function PaneRow({
  icon,
  onClick,
  disabled,
  children,
}: {
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button variant="ghost" className={row} disabled={disabled} onClick={onClick}>
      {icon} {children}
      <ChevronRightIcon className="ml-auto text-muted-foreground" />
    </Button>
  );
}

function LinkRow({
  to,
  icon,
  value: rowValue,
  onOpen,
  children,
}: {
  to: string;
  icon: ReactNode;
  value?: ReactNode;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <PianoLinkButton
      variant="ghost"
      className={row}
      href={to}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onOpen}
    >
      {icon} {children}
      {rowValue && <span className={value}>{rowValue}</span>}
      <ExternalLinkIcon data-icon="inline-end" className="ml-auto text-muted-foreground" />
    </PianoLinkButton>
  );
}

function PaneHeader({ title, onBack }: { title: string; onBack: () => void }) {
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
      <SheetTitle className="min-w-0 flex-1 truncate text-base">{title}</SheetTitle>
    </div>
  );
}

export function SessionMenuSheet({
  onLeave,
  dismissed,
  onDismissFocus,
}: {
  onLeave: () => void;
  dismissed: RefObject<boolean>;
  onDismissFocus: RefObject<HTMLElement | null>;
}) {
  const { state } = useCommands();
  const { commands, run } = useSessionCommands();
  const { pullRequest } = sessionContext(state);
  const pr = pullRequestView({ link: pullRequest ?? null, pullRequest: null });
  const projects = useSessionProjectMenu();
  const left = useRef(false);
  const leave = () => {
    left.current = true;
    onLeave();
  };
  const [page, setPage] = useState<Page>("actions");
  const pane = useRef<HTMLDivElement>(null);
  const firstRow = () => pane.current?.querySelector<HTMLElement>("a[href], button:not(:disabled)");
  const previousPage = useRef(page);
  useLayoutEffect(() => {
    if (previousPage.current === page) return;
    previousPage.current = page;
    firstRow()?.focus();
  }, [page]);

  const menu = sessionHeaderMenu(commands);
  const { display } = menu;
  const rows = (section: SessionCommand[]) =>
    section.map((c) => <SessionCommandRow key={c.id} command={c} run={run} />);

  return (
    <SheetContent
      side="bottom"
      showCloseButton={false}
      className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl p-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      initialFocus={() => {
        left.current = false;
        setPage("actions");
        return firstRow() ?? true;
      }}
      finalFocus={() => {
        if (left.current) return false;
        if (dismissed.current) return onDismissFocus.current ?? false;
        return keyboardFocusReturn();
      }}
    >
      <div ref={pane} className="flex flex-col">
        {page === "actions" && (
          <>
            <SheetTitle className="sr-only">Session</SheetTitle>
            {pr && (
              <LinkRow
                to={pr.url}
                icon={<GitPullRequestIcon />}
                value={pr.reference && pr.name}
                onOpen={onLeave}
              >
                Pull request
              </LinkRow>
            )}
            {pr && <Separator className="my-1" />}
            {menu.sections.map((section, i) => {
              if (section === "project")
                return (
                  projects && (
                    <PaneRow
                      key={section}
                      icon={<TargetIcon />}
                      disabled={!projects.entry.enabled}
                      onClick={() => setPage("projects")}
                    >
                      {projects.entry.label}
                    </PaneRow>
                  )
                );
              return (
                <Fragment key={typeof section === "string" ? section : section[0]?.id}>
                  {i > 0 && <Separator className="my-1" />}
                  {section === "display"
                    ? display && (
                        <Label className={cn(row, "flex justify-between rounded-md")}>
                          <span className="flex items-center gap-3">
                            <CommandIcon icon={display.icon} /> {display.label}
                          </span>
                          <Switch
                            checked={!!display.checked}
                            onCheckedChange={() => run(display)}
                          />
                        </Label>
                      )
                    : rows(section)}
                </Fragment>
              );
            })}
          </>
        )}
        {page === "projects" && projects && (
          <>
            <PaneHeader title={projects.entry.label} onBack={() => setPage("actions")} />
            <Separator className="my-1" />
            {projects.current && projects.open && (
              <Button
                variant="ghost"
                className={row}
                onClick={() => {
                  if (projects.open) run(projects.open);
                  leave();
                }}
              >
                <TargetIcon /> <span className="truncate">{projects.current.name}</span>
              </Button>
            )}
            {projects.remove && (
              <>
                <ProjectCommandRow command={projects.remove} run={run} icon={<CircleMinusIcon />} />
                <Separator className="my-1" />
              </>
            )}
            {projects.create && <ProjectCommandRow command={projects.create} run={run} />}
            {projects.destinations.map((d) => (
              <ProjectCommandRow
                key={d.project.id}
                command={d.command}
                run={run}
                icon={<TargetIcon />}
              >
                <span className="truncate">{d.project.name}</span>
              </ProjectCommandRow>
            ))}
          </>
        )}
      </div>
    </SheetContent>
  );
}
