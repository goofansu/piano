import { isWorking } from "@shared/sessionProjection";
import { cn } from "cn";
import { FolderGit2Icon, FolderIcon, FolderOpenIcon, GitBranchIcon } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { DetailsList, DetailsRowTitle, detailsRow } from "@/components/DetailsList";
import { DisclosureChevron } from "@/components/Disclosure";
import { SessionLinks } from "@/components/SessionLinks";
import { SessionOutputs } from "@/components/SessionOutputs";
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

/** Details' sections, each folding on its own. */
type DetailsSection = "workspace" | "outputs" | "links";
const SECTIONS: readonly DetailsSection[] = ["workspace", "outputs", "links"];

/** The sections the user folded, remembered across sessions and reloads; every section starts open. */
const collapsedPreference = createPreference<readonly DetailsSection[]>({
  key: "piano.detailsCollapsed",
  decode: (raw) => {
    const value = parseJson(raw);
    return Array.isArray(value) ? SECTIONS.filter((section) => value.includes(section)) : [];
  },
});

/**
 * Details, the session's rail: Workspace (where the session runs: its folder, worktree, branch and
 * working directory), Outputs (the files Pi wrote or edited) and Links (the web links the
 * conversation mentions), each a section that folds; Outputs and Links appear once they have a
 * row. It reads nothing itself: the facts are the registry's and Pi's, the lists the
 * transcript's, so it is never stale and has no toolbar.
 *
 * Beside the Agent area it is a narrow column on the right, split off by a hairline, shown while
 * Details is on and the Surface area is not; it follows the selected session. One area at a time
 * it takes the session's full width under its Details tab. Hidden, it keeps its layout box
 * (invisible and inert), so its scroll waits for its return. Hand-written: no shadcn component is
 * a nonmodal side column.
 */
export function DetailsRail({
  state,
  id,
  labelledBy,
  single,
  shown,
}: {
  state: AppState;
  id: string;
  /** One area at a time, the rail is the tab panel its tab names. */
  labelledBy: string | undefined;
  single: boolean;
  shown: boolean;
}) {
  if (!state.session) return null;
  return (
    <aside
      id={id}
      data-slot="details-rail"
      role={labelledBy ? "tabpanel" : undefined}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : "Session rail"}
      inert={!shown}
      aria-hidden={!shown}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-col overflow-auto bg-conversation",
        single ? "flex-1" : "w-(--details-width) shrink-0 border-l border-line",
        !shown && (single ? "invisible absolute inset-0" : "invisible absolute inset-y-0 right-0"),
      )}
    >
      <DetailsSections key={sessionKey(state.session)} state={state} />
    </aside>
  );
}

/** Details' folding sections for the selected session. */
function DetailsSections({ state }: { state: AppState }) {
  const session = state.session;
  const { cwd, folderName, worktreeName, branch } = sessionContext(state);
  const files = useSessionFiles();
  const messages = session?.messages ?? [];
  const working = !!session && isWorking(session.state);
  const links = useMemo(() => sessionLinks(messages), [messages]);
  const [collapsed, setCollapsed] = usePreference(collapsedPreference);
  const group = (section: DetailsSection) => ({
    open: !collapsed.includes(section),
    onOpenChange: (open: boolean) =>
      setCollapsed(open ? collapsed.filter((s) => s !== section) : [...collapsed, section]),
  });
  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      <DetailsGroup title="Workspace" {...group("workspace")}>
        <DetailsList aria-label="Workspace">
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
        </DetailsList>
      </DetailsGroup>
      {files.length > 0 && (
        <DetailsGroup title="Outputs" {...group("outputs")}>
          <SessionOutputs files={files} cwd={cwd} />
        </DetailsGroup>
      )}
      {links.length > 0 && (
        <DetailsGroup title="Links" {...group("links")}>
          <SessionLinks links={links} messages={messages} working={working} />
        </DetailsGroup>
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
    <Item size="sm" className={detailsRow} title={name}>
      <ItemMedia variant="icon" className="text-ink-3">
        {icon}
      </ItemMedia>
      <ItemContent>
        <DetailsRowTitle className={mono ? "break-all font-mono" : "break-words"}>
          <span className="sr-only">{name}: </span>
          {children}
        </DetailsRowTitle>
      </ItemContent>
    </Item>
  );
}

/** A section of Details: its name as a folding heading, then its list. */
function DetailsGroup({
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
