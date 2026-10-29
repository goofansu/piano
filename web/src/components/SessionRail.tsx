import { isWorking } from "@shared/sessionProjection";
import { cn } from "cn";
import {
  ChevronDownIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SessionCommandMenuItem, useSessionCommands } from "@/components/CommandHost";
import { DisclosureChevron } from "@/components/Disclosure";
import { MiddleEllipsis } from "@/components/MiddleEllipsis";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { SessionLinks, SessionLinksBrowser } from "@/components/SessionLinks";
import { SessionOutputs } from "@/components/SessionOutputs";
import { RailList, RailRowTitle, railRow } from "@/components/SessionRailList";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Item, ItemContent, ItemMedia } from "@/components/ui/item";
import { createPreference, parseJson } from "@/lib/preference";
import { pullRequestView } from "@/lib/pullRequestView";
import { type EnvironmentRowKind, environmentRowMenu } from "@/lib/sessionCommands";
import { sessionContext } from "@/lib/sessionContext";
import { type SessionLink, sessionLinks } from "@/lib/sessionLinks";
import type { TranscriptViewport } from "@/lib/transcriptViewport";
import { usePreference } from "@/lib/usePreference";
import { useSessionFiles } from "@/lib/useSessionFiles";
import { useTranscriptViewport } from "@/lib/useTranscriptViewport";
import { type AppState, sessionKey } from "@/store";

/** The rail's sections, each folding on its own. */
type RailSectionName = "workspace" | "outputs" | "links";
const SECTIONS: readonly RailSectionName[] = ["workspace", "outputs", "links"];

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
 * The session rail: Environment (its repository or folder, branch and linked pull request), Outputs (the
 * files Pi wrote or edited) and Links (the web links the conversation mentions), each a section that folds; Outputs and Links appear once they have a row. It reads
 * nothing itself: the facts are the registry's and Pi's, the lists the transcript's, so it is
 * never stale. Links shows five recent entries; its full, searchable view replaces the overview.
 *
 * It stands at the Agent area's right, as tall as the transcript and composer together, as Claude
 * Code's session rail does: the transcript's scroller keeps the area's full width, so its
 * scrollbar stays at the pane's edge, and the transcript, notices and composer keep clear of it
 * through `--rail-inset`. While it fits, the wheel over it scrolls the conversation as anywhere in
 * the area; taller, the wheel over it scrolls the rail alone and never runs on into the
 * conversation. It shows only side by side, while the rail is on and the Surface area is not, and
 * follows the selected session. Hand-written: no shadcn component is a pinned side column.
 */
export function SessionRail({ state }: { state: AppState }) {
  if (!state.session) return null;
  return <SessionRailContent key={sessionKey(state.session)} state={state} />;
}

function SessionRailContent({ state }: { state: AppState }) {
  const [browseLinks, setBrowseLinks] = useState(false);
  const railRef = useRef<HTMLElement | null>(null);
  const overviewScroll = useRef(0);
  const showAllRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  const messages = state.session?.messages ?? [];
  const links = useMemo(() => sessionLinks(messages).reverse(), [messages]);
  const working = !!state.session && isWorking(state.session.state);
  const attachRail = useCallback((rail: HTMLElement | null) => {
    railRef.current = rail;
    return fadeOverflow(rail);
  }, []);
  useLayoutEffect(() => {
    if (railRef.current) railRef.current.scrollTop = browseLinks ? 0 : overviewScroll.current;
    if (!browseLinks && restoreFocus.current) {
      showAllRef.current?.focus({ preventScroll: true });
      restoreFocus.current = false;
    }
  }, [browseLinks]);
  const viewport = useTranscriptViewport();
  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>) => passWheel(event, viewport),
    [viewport],
  );
  if (!state.session) return null;
  return (
    <aside
      key={browseLinks ? "links" : "overview"}
      ref={attachRail}
      data-slot="session-rail"
      aria-label="Session rail"
      onWheel={browseLinks ? undefined : onWheel}
      // Clear of the scrollbar at the area's edge; its first section level with the transcript's
      // first row. Overflow fades at either edge; the last row clears the fade at the scroll end.
      // It scrolls without a scrollbar, as the tab strips do.
      className={cn(
        "absolute inset-y-0 right-3 z-10 flex w-[calc(var(--rail-inset)-0.75rem)] scrollbar-none flex-col overscroll-y-contain pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pt-5",
        browseLinks ? "overflow-hidden" : "overflow-y-auto",
      )}
    >
      {browseLinks ? (
        <SessionLinksBrowser
          links={links}
          messages={messages}
          working={working}
          onBack={() => {
            restoreFocus.current = true;
            setBrowseLinks(false);
          }}
        />
      ) : (
        <RailSections
          state={state}
          links={links}
          showAllRef={showAllRef}
          onShowLinks={() => {
            overviewScroll.current = railRef.current?.scrollTop ?? 0;
            setBrowseLinks(true);
          }}
        />
      )}
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
function RailSections({
  state,
  links,
  onShowLinks,
  showAllRef,
}: {
  state: AppState;
  links: readonly SessionLink[];
  onShowLinks: () => void;
  showAllRef: React.Ref<HTMLButtonElement>;
}) {
  const session = state.session;
  const { cwd, branch, detachedHead, githubRepo, branchUrl, pullRequest } = sessionContext(state);
  const pr = pullRequestView({ link: pullRequest ?? null, pullRequest: null });
  const repositoryUrl = githubRepo ? `https://github.com/${githubRepo}` : undefined;
  const files = useSessionFiles();
  const messages = session?.messages ?? [];
  const working = !!session && isWorking(session.state);
  const [collapsed, setCollapsed] = usePreference(collapsedPreference);
  const group = (section: RailSectionName) => ({
    open: !collapsed.includes(section),
    onOpenChange: (open: boolean) =>
      setCollapsed(open ? collapsed.filter((s) => s !== section) : [...collapsed, section]),
  });
  return (
    <div className="flex shrink-0 flex-col gap-4 px-3 pt-3">
      <RailSection title="Environment" {...group("workspace")}>
        <RailList aria-label="Environment">
          {githubRepo ? (
            <EnvironmentRow
              name="Repository"
              menu="repository"
              icon={
                <svg aria-hidden="true">
                  <use href="/github.svg#github" />
                </svg>
              }
              href={repositoryUrl}
              cwd={cwd}
            >
              {githubRepo}
            </EnvironmentRow>
          ) : cwd ? (
            <EnvironmentRow name="Folder" menu="folder" icon={<FolderOpenIcon />} cwd={cwd}>
              {cwd.split("/").filter(Boolean).at(-1) || cwd}
            </EnvironmentRow>
          ) : null}
          {detachedHead ? (
            <EnvironmentRow
              name="Git"
              menu="commit"
              icon={<GitCommitHorizontalIcon />}
              mono
              description="A commit is checked out directly; no branch is active."
            >
              {`${detachedHead.slice(0, 10)} (detached)`}
            </EnvironmentRow>
          ) : branch ? (
            <EnvironmentRow
              name="Branch"
              menu="branch"
              icon={<GitBranchIcon />}
              mono
              href={branchUrl}
            >
              {branch}
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
      </RailSection>
      {files.length > 0 && (
        <RailSection title="Outputs" {...group("outputs")}>
          <SessionOutputs files={files} cwd={cwd} />
        </RailSection>
      )}
      {links.length > 0 && (
        <RailSection
          title="Links"
          count={links.length}
          {...group("links")}
          action={
            links.length > 5 && (
              <Button ref={showAllRef} variant="ghost" size="sm" onClick={onShowLinks}>
                Show all
              </Button>
            )
          }
        >
          <SessionLinks links={links.slice(0, 5)} messages={messages} working={working} />
        </RailSection>
      )}
    </div>
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
          {isName ? <MiddleEllipsis text={children} /> : children}
        </RailRowTitle>
      </ItemContent>
    </>
  );
  return (
    // Keep rail clicks on their controls: modal pointer blocking lets repeated clicks select
    // the transcript beneath the rail through the document root.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Item
          size="sm"
          className={cn(
            railRow,
            "cursor-pointer text-left hover:bg-fill-hover data-[state=open]:bg-fill-hover",
          )}
          title={description ?? cwd ?? name}
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
                Open {menu} on GitHub
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
  count,
  action,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="flex flex-col gap-2">
      <div className="flex min-h-8 items-center justify-between gap-2 pointer-coarse:min-h-11">
        <h2 className="flex min-w-0">
          <CollapsibleTrigger asChild>
            {/* The heading is the fold: its name, then the chevron turned by its state. */}
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 h-7 gap-1 px-2 text-sm font-medium text-ink aria-expanded:bg-transparent pointer-coarse:min-h-11"
            >
              {title}
              {count !== undefined && <span className="ml-1 text-xs text-ink-3">{count}</span>}
              <DisclosureChevron open={open} />
            </Button>
          </CollapsibleTrigger>
        </h2>
        {action}
      </div>
      <CollapsibleContent className="disclosure-content">{children}</CollapsibleContent>
    </Collapsible>
  );
}
