import { isWorking } from "@shared/sessionProjection";
import { FolderGit2Icon, FolderIcon, FolderOpenIcon, GitBranchIcon } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { DisclosureChevron } from "@/components/Disclosure";
import { SessionLinks } from "@/components/SessionLinks";
import { SessionOutputs } from "@/components/SessionOutputs";
import { RailList, RailRowTitle, railRow } from "@/components/SessionRailList";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Item, ItemContent, ItemMedia } from "@/components/ui/item";
import { abbrevHome } from "@/lib/format";
import { createPreference, parseJson } from "@/lib/preference";
import { sessionContext } from "@/lib/sessionContext";
import { sessionLinks } from "@/lib/sessionLinks";
import { usePreference } from "@/lib/usePreference";
import { useSessionFiles } from "@/lib/useSessionFiles";
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
 * The session rail: Workspace (where the session runs: its folder, worktree, branch and working
 * directory), Outputs (the files Pi wrote or edited) and Links (the web links the conversation
 * mentions), each a section that folds; Outputs and Links appear once they have a row. It reads
 * nothing itself: the facts are the registry's and Pi's, the lists the transcript's, so it is
 * never stale and has no toolbar.
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
  return (
    <aside
      data-slot="session-rail"
      aria-label="Session rail"
      onWheel={passWheel}
      // Clear of the scrollbar at the area's edge; its first section level with the transcript's
      // first row, its last ending as far above the area's bottom as the composer's footer does.
      // It scrolls without a scrollbar, as the tab strips do.
      className="absolute inset-y-0 right-3 z-10 flex w-[calc(var(--rail-inset)-0.75rem)] scrollbar-none flex-col overflow-y-auto overscroll-y-contain pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:pt-5 md:pb-5"
    >
      <RailSections key={sessionKey(state.session)} state={state} />
    </aside>
  );
}

/**
 * A rail that fits has nothing to scroll, and the transcript beside it is no ancestor the wheel
 * would reach, so the wheel is handed to the transcript, scrolling it as anywhere else in the area.
 */
function passWheel(event: React.WheelEvent<HTMLElement>) {
  const rail = event.currentTarget;
  if (rail.scrollHeight > rail.clientHeight || event.ctrlKey) return;
  const transcript = rail.parentElement?.querySelector<HTMLElement>("[data-slot=transcript]");
  const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
  transcript?.scrollBy({ top: event.deltaY * lines });
}

/** The rail's folding sections for the selected session. */
function RailSections({ state }: { state: AppState }) {
  const session = state.session;
  const { cwd, folderName, worktreeName, branch } = sessionContext(state);
  const files = useSessionFiles();
  const messages = session?.messages ?? [];
  const working = !!session && isWorking(session.state);
  const links = useMemo(() => sessionLinks(messages), [messages]);
  const [collapsed, setCollapsed] = usePreference(collapsedPreference);
  const group = (section: RailSectionName) => ({
    open: !collapsed.includes(section),
    onOpenChange: (open: boolean) =>
      setCollapsed(open ? collapsed.filter((s) => s !== section) : [...collapsed, section]),
  });
  return (
    <div className="flex flex-col gap-4 px-3 pt-3">
      <RailSection title="Workspace" {...group("workspace")}>
        <RailList aria-label="Workspace">
          <WorkspaceRow name="Folder" icon={<FolderIcon />}>
            {folderName}
          </WorkspaceRow>
          {worktreeName && (
            <WorkspaceRow name="Worktree" icon={<FolderGit2Icon />} mono>
              {worktreeName}
            </WorkspaceRow>
          )}
          {branch && (
            <WorkspaceRow name="Git branch" icon={<GitBranchIcon />} mono>
              {branch}
            </WorkspaceRow>
          )}
          {cwd && (
            <WorkspaceRow name="Working directory" icon={<FolderOpenIcon />} mono>
              {abbrevHome(cwd)}
            </WorkspaceRow>
          )}
        </RailList>
      </RailSection>
      {files.length > 0 && (
        <RailSection title="Outputs" {...group("outputs")}>
          <SessionOutputs files={files} cwd={cwd} />
        </RailSection>
      )}
      {links.length > 0 && (
        <RailSection title="Links" {...group("links")}>
          <SessionLinks links={links} messages={messages} working={working} />
        </RailSection>
      )}
    </div>
  );
}

/** One fact about where the session runs: its icon, then its value; the name is read, not shown, as in the header. */
function WorkspaceRow({
  name,
  icon,
  mono = false,
  children,
}: {
  name: string;
  icon: ReactNode;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <Item size="sm" className={railRow} title={name}>
      <ItemMedia variant="icon" className="text-ink-3">
        {icon}
      </ItemMedia>
      <ItemContent>
        <RailRowTitle className={mono ? "break-all font-mono" : "break-words"}>
          <span className="sr-only">{name}: </span>
          {children}
        </RailRowTitle>
      </ItemContent>
    </Item>
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
      <h2 className="flex">
        <CollapsibleTrigger asChild>
          {/* The heading is the fold: its name, then the chevron turned by its state. */}
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-7 gap-1 px-2 text-sm font-medium text-ink aria-expanded:bg-transparent pointer-coarse:min-h-11"
          >
            {title}
            <DisclosureChevron open={open} />
          </Button>
        </CollapsibleTrigger>
      </h2>
      <CollapsibleContent className="disclosure-content">{children}</CollapsibleContent>
    </Collapsible>
  );
}
