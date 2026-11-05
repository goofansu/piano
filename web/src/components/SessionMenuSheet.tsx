import type { SessionPreview } from "@shared/wire";
import { cn } from "cn";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FolderInputIcon,
  GitPullRequestIcon,
} from "lucide-react";
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from "react";
import {
  CommandIcon,
  useCommands,
  useSessionCommands,
  useSessionProjectMenu,
} from "@/components/CommandHost";
import { SheetClose, SheetContent, SheetTitle } from "@/components/PianoSheet";
import { ProjectCommandIconView } from "@/components/Projects";
import { dotTone, useSeenPreview } from "@/components/SessionPreview";
import { StatusDot } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { returnFocusForKeyboard } from "@/lib/pointerClose";
import type { ProjectCommand } from "@/lib/projectCommands";
import { pullRequestView } from "@/lib/pullRequestView";
import { type SessionCommand, sessionHeaderMenu } from "@/lib/sessionCommands";
import { sessionContext } from "@/lib/sessionContext";
import { previewFace, previewHost } from "@/lib/sessionPreview";

type Page = "actions" | "projects";

/** A full-width, 44px row with 16px icons, shared by buttons and the display switch's label. */
const row =
  "h-11 w-full justify-start gap-3 border border-transparent px-3 text-base font-normal [&_svg]:size-4 [&_svg]:shrink-0";

/** A row's muted value after its label: the pull request's number, the preview's host. */
const value = "truncate text-sm font-normal text-muted-foreground";

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

/** A row that pushes a second pane: its icon and name, then a chevron. */
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

/** The linked pull request, opened on GitHub in a new tab: the sheet's one way out of Piano. */
function PullRequestRow({
  url,
  number,
  onOpen,
}: {
  url: string;
  /** The pull request's number, once the link names one. */
  number: string | undefined;
  onOpen: () => void;
}) {
  return (
    <Button asChild variant="ghost" className={row}>
      <a href={url} target="_blank" rel="noreferrer" onClick={onOpen}>
        <GitPullRequestIcon /> Pull request
        {number && <span className={value}>#{number}</span>}
        <ExternalLinkIcon data-icon="inline-end" className="ml-auto text-muted-foreground" />
      </a>
    </Button>
  );
}

/** Show preview as a row: the app's state dot in the icon column, then its name and host. */
function PreviewRow({ preview, onShow }: { preview: SessionPreview; onShow: () => void }) {
  const face = previewFace(preview);
  return (
    <Button variant="ghost" className={row} aria-label="Show preview" onClick={onShow}>
      <span className="flex size-4 shrink-0 items-center justify-center">
        <StatusDot tone={dotTone[face.tone]} pulse={face.tone === "pending"} />
      </span>
      <span data-slot="row-title">Preview</span>
      <span className={value}>{preview.url ? previewHost(preview.url) : face.status}</span>
    </Button>
  );
}

/** A pushed pane's header: Back, then its title. */
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

/**
 * The session menu for one-area-at-a-time or a narrow viewport: a bottom sheet, one level deep.
 * The header's second line says where the session runs. The sheet includes the linked pull
 * request and known Preview, not the rail's Outputs or Environment copy menus, nor the dropdown
 * menu's session ID. Add to project pushes the project picker. A row that goes elsewhere in the
 * session (Preview) calls `onLeave`, which closes the sheet and leaves focus to that destination.
 */
export function SessionMenuSheet({
  onLeave,
  onDismissFocus,
}: {
  onLeave: () => void;
  /** Where focus returns when Escape or a tap outside dismisses the sheet. */
  onDismissFocus: RefObject<HTMLElement | null>;
}) {
  const { state } = useCommands();
  const { commands, run } = useSessionCommands();
  const { pullRequest } = sessionContext(state);
  const pr = pullRequestView({ link: pullRequest ?? null, pullRequest: null });
  const preview = useSeenPreview(state);
  const showPreview = commands.find((c) => c.id === "show-preview");
  const projects = useSessionProjectMenu();
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
  const facts = !!pr || !!(preview && showPreview);

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
      <div ref={pane} className="flex flex-col">
        {page === "actions" && (
          <>
            <SheetTitle className="sr-only">Session</SheetTitle>
            {/* The pull request opens in a browser tab, so the sheet closes as after an action. */}
            {pr && (
              <PullRequestRow url={pr.url} number={pr.reference && pr.name} onOpen={onLeave} />
            )}
            {preview && showPreview && (
              <PreviewRow
                preview={preview}
                onShow={() => {
                  run(showPreview);
                  leave();
                }}
              />
            )}
            {facts && <Separator className="my-1" />}
            {rows(menu.manage)}
            {projects && (
              <PaneRow
                icon={<FolderInputIcon />}
                disabled={!projects.entry.enabled}
                onClick={() => setPage("projects")}
              >
                {projects.entry.label}
              </PaneRow>
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
    </SheetContent>
  );
}
