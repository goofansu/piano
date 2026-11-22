import { type EnvironmentRowKind, environmentRowMenu } from "@features/commands/web";
import { SessionCommandMenuItem, useSessionCommands } from "@features/commands/web/browser";
import { sessionPlace, useTranscriptViewport } from "@features/sessions/web/browser";
import type { TranscriptViewport } from "@features/sessions/web/browser";
import { SessionOutputs, useSessionFiles, pullRequestView } from "@features/workspace/web/browser";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Item, ItemContent, ItemMedia } from "@/components/ui/item";
import { DisclosureChevron } from "@/shared/components/Disclosure";
import { MiddleEllipsis } from "@/shared/components/MiddleEllipsis";
import { PianoButton } from "@/shared/components/PianoButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/PianoDropdownMenu";
import { RailList, RailRowTitle, railRow } from "@/shared/components/RailList";
import { createPreference, parseJson } from "@/shared/lib/preference";
import { usePreference } from "@/shared/lib/usePreference";
import { sessionContext } from "@/shared/state/sessionContext";
import { type AppState, sessionKey } from "@/shared/state/state";

type RailSectionName = "workspace" | "outputs";
const SECTIONS: readonly RailSectionName[] = ["workspace", "outputs"];

const collapsedPreference = createPreference<readonly RailSectionName[]>({
  key: "piano.detailsCollapsed",
  decode: (raw) => {
    const value = parseJson(raw);
    return Array.isArray(value) ? SECTIONS.filter((section) => value.includes(section)) : [];
  },
});

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
      className={cn(
        "flex scrollbar-none flex-col overscroll-y-contain pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        "absolute inset-y-0 right-3 z-10 w-[calc(var(--rail-inset)-0.75rem)] overflow-y-auto pt-3 md:pt-5",
      )}
    >
      <RailSections state={state} />
    </aside>
  );
}

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

function passWheel(event: React.WheelEvent<HTMLElement>, viewport: TranscriptViewport | null) {
  const rail = event.currentTarget;
  if (rail.scrollHeight > rail.clientHeight || event.ctrlKey) return;
  viewport?.wheel(event.deltaY, event.deltaMode);
}

function RailSections({ state }: { state: AppState }) {
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
      {files.length > 0 && (
        <RailSection title="Outputs" {...group("outputs")}>
          <SessionOutputs files={files} cwd={cwd} />
        </RailSection>
      )}
    </div>
  );
}

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
          description="A commit is checked out directly; no branch is active."
        >
          {`${place.ref.name} (detached)`}
        </EnvironmentRow>
      ) : place?.ref ? (
        <EnvironmentRow name="Branch" menu="branch" icon={<GitBranchIcon />} href={branchUrl}>
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

function EnvironmentRow({
  name,
  icon,
  href,
  menu,
  cwd,
  description,
  children,
}: {
  name: string;
  icon: ReactNode;
  href?: string;
  menu: EnvironmentRowKind;
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
          className={
            isName ? "w-full font-mono" : menu === "commit" ? "break-all font-mono" : "break-words"
          }
        >
          {isName ? <MiddleEllipsis text={children} /> : children}
        </RailRowTitle>
      </ItemContent>
    </>
  );
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Item
            size="sm"
            className={cn(
              railRow,
              "cursor-pointer text-left hover:bg-fill-hover aria-expanded:bg-fill-hover",
            )}
            title={open ? undefined : (description ?? cwd ?? (isName ? children : name))}
            render={
              <button type="button" aria-label={`${name}: ${children}`}>
                {content}
                <ItemMedia variant="icon" className="text-ink-3">
                  <ChevronDownIcon aria-hidden />
                </ItemMedia>
              </button>
            }
          />
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          {environmentRowMenu(commands, menu).map((c) => (
            <SessionCommandMenuItem key={c.id} command={c} run={run} />
          ))}
          {href && (
            <DropdownMenuItem render={<a href={href} target="_blank" rel="noreferrer" />}>
              <ExternalLinkIcon aria-hidden />
              Open {menu}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
          <CollapsibleTrigger
            render={
              <PianoButton
                variant="ghost"
                size="sm"
                className="-ml-2 h-7 gap-1 px-2 text-sm font-medium text-ink aria-expanded:bg-transparent pointer-coarse:min-h-11"
              >
                {title}
                <DisclosureChevron open={open} />
              </PianoButton>
            }
          />
        </h2>
      </div>
      <CollapsibleContent className="disclosure-content">{children}</CollapsibleContent>
    </Collapsible>
  );
}
