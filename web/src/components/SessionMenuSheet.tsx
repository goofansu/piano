import type { SessionPreview } from "@shared/wire";
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
import {
  CommandIcon,
  CommandLink,
  useCommands,
  useOpenPreview,
  useSessionCommands,
  useSessionProjectMenu,
} from "@/components/CommandHost";
import { SheetClose, SheetContent, SheetTitle } from "@/components/PianoSheet";
import { ProjectCommandIconView } from "@/components/Projects";
import { dotTone, PreviewStatus, useSeenPreview } from "@/components/SessionPreview";
import { StatusDot } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { returnFocusForKeyboard } from "@/lib/pointerClose";
import { previewObservation } from "@/lib/previewObservation";
import type { ProjectCommand } from "@/lib/projectCommands";
import { pullRequestView } from "@/lib/pullRequestView";
import { type SessionCommand, sessionHeaderMenu } from "@/lib/sessionCommands";
import { sessionContext } from "@/lib/sessionContext";
import {
  type PreviewClaim,
  previewClaim,
  previewClaimHolds,
  previewFace,
  previewHost,
} from "@/lib/sessionPreview";

type Page = "actions" | "projects" | "preview";

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

/**
 * A project command as a sheet row, by its icon and label unless `icon` or `children` names it. A
 * project is drawn with the Target icon, as the breadcrumb and the Projects page draw it.
 */
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
    <SheetClose asChild>
      <Button
        variant="ghost"
        className={row}
        disabled={!command.enabled}
        onClick={() => run(command)}
      >
        {icon ?? <ProjectCommandIconView icon={command.icon} />} {children ?? command.label}
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
  name,
  onOpen,
}: {
  url: string;
  /** The pull request's name ("#42"), once the link names a number. */
  name: string | undefined;
  onOpen: () => void;
}) {
  return (
    <Button asChild variant="ghost" className={row}>
      <a href={url} target="_blank" rel="noreferrer" onClick={onOpen}>
        <GitPullRequestIcon /> Pull request
        {name && <span className={value}>{name}</span>}
        <ExternalLinkIcon data-icon="inline-end" className="ml-auto text-muted-foreground" />
      </a>
    </Button>
  );
}

/** Preview pushes inspection in this sheet, without embedding the app. */
function PreviewRow({ preview, onShow }: { preview: SessionPreview; onShow: () => void }) {
  const face = previewFace(preview);
  return (
    <Button variant="ghost" className={row} aria-label="Preview" onClick={onShow}>
      <span className="flex size-4 shrink-0 items-center justify-center">
        <StatusDot tone={dotTone[face.tone]} />
      </span>
      <span data-slot="row-title">Preview</span>
      <span className={value}>{preview.url ? previewHost(preview.url) : face.status}</span>
      <ChevronRightIcon className="ml-auto text-muted-foreground" />
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
 * menu's session ID. Project and Preview rows push panes within this sheet. Opening details or
 * a confirmation calls `onLeave`, closing the sheet and leaving focus to that destination.
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
  const openPreview = useOpenPreview();
  const [previewPage, setPreviewPage] = useState<PreviewClaim | null>(null);
  const pagePreview = previewPage && previewClaimHolds(state, previewPage) ? preview : undefined;
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
  const facts = !!pr || !!preview;

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
            {pr && <PullRequestRow url={pr.url} name={pr.reference && pr.name} onOpen={onLeave} />}
            {preview && (
              <PreviewRow
                preview={preview}
                onShow={() => {
                  setPreviewPage(previewClaim(state) ?? null);
                  setPage("preview");
                  previewObservation.refresh();
                }}
              />
            )}
            {facts && <Separator className="my-1" />}
            {menu.sections.map((section, i) => {
              if (section === "project")
                // The project entry opens its own page, so it continues the manage rows unseparated.
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
        {page === "preview" && (
          <>
            <PaneHeader title="Preview" onBack={() => setPage("actions")} />
            <Separator className="my-1" />
            {pagePreview ? (
              <>
                <div className="flex min-w-0 flex-col gap-1 px-3 py-2">
                  <PreviewStatus
                    preview={pagePreview}
                    className="flex items-center gap-2 text-sm"
                  />
                  {pagePreview.url && (
                    <span className={cn(value, "font-mono")}>{previewHost(pagePreview.url)}</span>
                  )}
                </div>
                {openPreview && (
                  <Button asChild variant="ghost" className={row}>
                    <CommandLink command={openPreview} onClick={onLeave}>
                      {openPreview.label}
                      <ExternalLinkIcon data-icon="inline-end" className="ml-auto" />
                    </CommandLink>
                  </Button>
                )}
                {commands
                  .filter((c) => c.id === "preview-details" || c.id === "stop-preview")
                  .map((command) => (
                    <Fragment key={command.id}>
                      {command.destructive && <Separator className="my-1" />}
                      <SessionCommandRow
                        command={command}
                        run={(c) => {
                          leave();
                          run(c);
                        }}
                      />
                    </Fragment>
                  ))}
              </>
            ) : (
              <p className="px-3 py-2 text-sm text-muted-foreground">Preview unavailable</p>
            )}
          </>
        )}
        {page === "projects" && projects && (
          <>
            <PaneHeader title={projects.entry.label} onBack={() => setPage("actions")} />
            <Separator className="my-1" />
            {/* Below md the header has no breadcrumb, so this row is the way to the project's home. */}
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
            <ProjectCommandRow command={projects.create} run={run} />
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
