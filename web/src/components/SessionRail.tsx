import { cn } from "cn";
import {
  ChevronDownIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { SessionCommandMenuItem, useSessionCommands } from "@/components/CommandHost";
import { DisclosureChevron } from "@/components/Disclosure";
import { MiddleEllipsis } from "@/components/MiddleEllipsis";
import { PianoButton } from "@/components/PianoButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { SessionOutputs } from "@/components/SessionOutputs";
import { PreviewRailRow, useSeenPreview } from "@/components/SessionPreview";
import { RailList, RailRowTitle, railRow } from "@/components/SessionRailList";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Item, ItemContent, ItemMedia } from "@/components/ui/item";
import { createPreference, parseJson } from "@/lib/preference";
import { pullRequestView } from "@/lib/pullRequestView";
import { type EnvironmentRowKind, environmentRowMenu } from "@/lib/sessionCommands";
import { sessionContext, sessionPlace } from "@/lib/sessionContext";
import type { TranscriptViewport } from "@/lib/transcriptViewport";
import { usePreference } from "@/lib/usePreference";
import { useSessionFiles } from "@/lib/useSessionFiles";
import { useTranscriptViewport } from "@/lib/useTranscriptViewport";
import { type AppState, sessionKey } from "@/store";

/** The rail's sections, each folding on its own. */
type RailSectionName = "workspace" | "app" | "outputs";
const SECTIONS: readonly RailSectionName[] = ["workspace", "app", "outputs"];

/** The sections the user folded, remembered across sessions and reloads; every section starts
 * open. The key predates the rail's name. */
const collapsedPreference = createPreference<readonly RailSectionName[]>({
  key: "piano.detailsCollapsed",
  decode: (raw) => {
    const value = parseJson(raw);
    return Array.isArray(value) ? SECTIONS.filter((section) => value.includes(section)) : [];
  },
});

/**
 * The session rail: Environment (its repository or folder, branch and linked pull request), App
 * while a preview is known, and Outputs (the files Pi wrote or edited) once there is one, each a
 * section that folds. It reads nothing itself: the facts are the registry's and Pi's, the lists
 * the transcript's, so it is never stale. The artifacts Pi published are the header's.
 *
 * It stands at the Agent area's right, as tall as the transcript and composer together, as Claude
 * Code's session rail does: the transcript's scroller keeps the area's full width, so its
 * scrollbar stays at the pane's edge, and the transcript, notices and composer keep clear of it
 * through `--rail-inset`. While it fits, the wheel over it scrolls the conversation as anywhere in
 * the area; taller, the wheel over it scrolls the rail alone and never runs on into the
 * conversation. One area at a time there is no rail: the session header's second line says where
 * the session runs, and the session menu holds Preview and the pull request.
 * It follows the selected session. Hand-written: no shadcn component is a pinned side column.
 */
interface RailProps {
  state: AppState;
}

export function SessionRail({ state }: RailProps) {
  if (!state.session) return null;
  return <SessionRailContent key={sessionKey(state.session)} state={state} />;
}

function SessionRailContent({ state }: RailProps) {
  const attachRail = useCallback((rail: HTMLElement | null) => fadeOverflow(rail), []);
  const viewport = useTranscriptViewport();
  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>) => passWheel(event, viewport),
    [viewport],
  );
  if (!state.session) return null;
  return (
    <aside
      ref={attachRail}
      data-slot="session-rail"
      aria-label="Session rail"
      onWheel={onWheel}
      // Clear of the scrollbar at the area's edge; its first section level with the transcript's
      // first row. Overflow fades at either edge; the last row clears the fade at the scroll end.
      // It scrolls without a scrollbar, as the tab strips do.
      className={cn(
        "flex scrollbar-none flex-col overscroll-y-contain pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        "absolute inset-y-0 right-3 z-10 w-[calc(var(--rail-inset)-0.75rem)] overflow-y-auto pt-3 md:pt-5",
      )}
    >
      <RailSections state={state} />
    </aside>
  );
}

/** Fade only content beyond the viewport, including after a resize or a section folds. */
function fadeOverflow(rail: HTMLElement | null) {
  if (!rail) return;
  const update = () => {
    const remaining = rail.scrollHeight - rail.clientHeight - rail.scrollTop;
    rail.style.setProperty("--rail-fade-top", `${Math.min(32, Math.max(0, rail.scrollTop))}px`);
    rail.style.setProperty("--rail-fade-bottom", `${Math.min(32, Math.max(0, remaining))}px`);
  };
  const observer = new ResizeObserver(update);
  observer.observe(rail);
  if (rail.firstElementChild) observer.observe(rail.firstElementChild);
  rail.addEventListener("scroll", update, { passive: true });
  update();
  return () => {
    observer.disconnect();
    rail.removeEventListener("scroll", update);
  };
}

/**
 * A rail that fits has nothing to scroll, and the transcript beside it is no ancestor the wheel
 * would reach, so the wheel is handed to the transcript's viewport, which moves the conversation
 * as a wheel anywhere else in the area does. The rail decides only whether to hand it over.
 */
function passWheel(event: React.WheelEvent<HTMLElement>, viewport: TranscriptViewport | null) {
  const rail = event.currentTarget;
  if (rail.scrollHeight > rail.clientHeight || event.ctrlKey) return;
  viewport?.wheel(event.deltaY, event.deltaMode);
}

/** The rail's folding sections for the selected session. */
function RailSections({ state }: { state: AppState }) {
  const preview = useSeenPreview(state);
  const files = useSessionFiles();
  const { cwd } = sessionContext(state);
  const [collapsed, setCollapsed] = usePreference(collapsedPreference);
  const group = (section: RailSectionName) => ({
    open: !collapsed.includes(section),
    onOpenChange: (open: boolean) =>
      setCollapsed(open ? collapsed.filter((s) => s !== section) : [...collapsed, section]),
  });
  return (
    <div className="flex shrink-0 flex-col gap-4 px-3 pt-3">
      <RailSection title="Environment" {...group("workspace")}>
        <SessionEnvironment state={state} />
      </RailSection>
      {preview && (
        <RailSection title="App" {...group("app")}>
          <PreviewRailRow key={preview.instanceId} preview={preview} />
        </RailSection>
      )}
      {files.length > 0 && (
        <RailSection title="Outputs" {...group("outputs")}>
          <SessionOutputs files={files} cwd={cwd} />
        </RailSection>
      )}
    </div>
  );
}

/**
 * Where the session runs: its repository or folder, its branch or detached commit, and its linked
 * pull request, each a row with its menu. The rail's first section.
 */
export function SessionEnvironment({ state }: { state: AppState }) {
  const context = sessionContext(state);
  const { cwd, branchUrl, pullRequest } = context;
  const place = sessionPlace(context);
  const pr = pullRequestView({ link: pullRequest ?? null, pullRequest: null });
  return (
    <RailList aria-label="Environment">
      {place?.repository ? (
        <EnvironmentRow
          name="Repository"
          menu="repository"
          icon={
            <svg aria-hidden="true">
              <use href="/github.svg#github" />
            </svg>
          }
          href={`https://github.com/${place.name}`}
          cwd={cwd}
        >
          {place.name}
        </EnvironmentRow>
      ) : place ? (
        <EnvironmentRow name="Folder" menu="folder" icon={<FolderOpenIcon />} cwd={cwd}>
          {place.name}
        </EnvironmentRow>
      ) : null}
      {place?.ref?.kind === "commit" ? (
        <EnvironmentRow
          name="Git"
          menu="commit"
          icon={<GitCommitHorizontalIcon />}
          mono
          description="A commit is checked out directly; no branch is active."
        >
          {`${place.ref.name} (detached)`}
        </EnvironmentRow>
      ) : place?.ref ? (
        <EnvironmentRow name="Branch" menu="branch" icon={<GitBranchIcon />} mono href={branchUrl}>
          {place.ref.name}
        </EnvironmentRow>
      ) : null}
      {pr && (
        <EnvironmentRow
          name="Pull request"
          menu="pull request"
          icon={<GitPullRequestIcon />}
          href={pr.url}
        >
          {pr.name}
        </EnvironmentRow>
      )}
    </RailList>
  );
}

/**
 * One fact about where the session runs: its icon, then its value; the name is read, not shown, as
 * in the header. Its menu holds the session's copy commands for that fact, then its GitHub page.
 */
function EnvironmentRow({
  name,
  icon,
  mono = false,
  href,
  menu,
  cwd,
  description,
  children,
}: {
  name: string;
  icon: ReactNode;
  mono?: boolean;
  href?: string;
  menu: EnvironmentRowKind;
  /** The directory the row stands for, as its tooltip. */
  cwd?: string;
  description?: string;
  children: string;
}) {
  const { commands, run } = useSessionCommands();
  const [open, setOpen] = useState(false);
  const isName = menu === "repository" || menu === "branch";
  const content = (
    <>
      <ItemMedia variant="icon" className="text-ink-3">
        {icon}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <RailRowTitle
          className={isName ? "w-full font-mono" : mono ? "break-all font-mono" : "break-words"}
        >
          {isName ? <MiddleEllipsis text={children} tooltip={!open} /> : children}
        </RailRowTitle>
      </ItemContent>
    </>
  );
  return (
    // Keep rail clicks on their controls: modal pointer blocking lets repeated clicks select
    // the transcript beneath the rail through the document root.
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Item
          size="sm"
          className={cn(
            railRow,
            "cursor-pointer text-left hover:bg-fill-hover data-[state=open]:bg-fill-hover",
          )}
          title={open ? "" : (description ?? cwd ?? name)}
          asChild
        >
          <button type="button" aria-label={`${name}: ${children}`}>
            {content}
            <ItemMedia variant="icon" className="text-ink-3">
              <ChevronDownIcon aria-hidden />
            </ItemMedia>
          </button>
        </Item>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          {environmentRowMenu(commands, menu).map((c) => (
            <SessionCommandMenuItem key={c.id} command={c} run={run} />
          ))}
          {href && (
            <DropdownMenuItem asChild>
              <a href={href} target="_blank" rel="noreferrer">
                <ExternalLinkIcon aria-hidden />
                Open {menu}
              </a>
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A section of the rail: its name as a folding heading, then its list. */
function RailSection({
  title,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="flex flex-col gap-2">
      <div className="flex min-h-8 items-center gap-2 pointer-coarse:min-h-11">
        <h2 className="flex min-w-0">
          <CollapsibleTrigger asChild>
            {/* The heading is the fold: its name, then the chevron turned by its state. */}
            <PianoButton
              variant="ghost"
              size="sm"
              className="-ml-2 h-7 gap-1 px-2 text-sm font-medium text-ink aria-expanded:bg-transparent pointer-coarse:min-h-11"
            >
              {title}
              <DisclosureChevron open={open} />
            </PianoButton>
          </CollapsibleTrigger>
        </h2>
      </div>
      <CollapsibleContent className="disclosure-content">{children}</CollapsibleContent>
    </Collapsible>
  );
}
