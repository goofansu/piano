import type { ChangesScope } from "@shared/wire";
import { CHANGES_INITIAL_PATCH_BYTES } from "@shared/wire";
import {
  ChevronDownIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  InfoIcon,
  RefreshCwIcon,
  WrapTextIcon,
} from "lucide-react";
import { IconButton } from "@/components/IconButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/PianoPopover";
import { Button } from "@/components/ui/button";
import {
  type ChangesSheetView,
  FILE_PATCH_LIMIT,
  SCOPE_NAMES,
  type ScopeView,
  targetProvenance,
} from "@/lib/changesView";
import { abbrevHome } from "@/lib/format";
import { useChangesWrap } from "@/lib/useChangesWrap";

/**
 * The comparison, at the toolbar's start: its face names the scope on screen (and Branch's target),
 * its menu the scopes the checkout can be read with, each saying what it compares with or why it
 * cannot. A choice is saved for the session; the list answers by changing.
 */
export function ChangesScopeMenu({
  scope,
  disabled,
  onScope,
}: {
  scope: ScopeView;
  disabled: boolean;
  onScope: (scope: ChangesScope) => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled}
          aria-label={`Comparison: ${scope.label}`}
          className="-ml-2 min-w-0 text-ink pointer-coarse:min-h-11"
        >
          {/* A phone-width toolbar keeps the scope's name; the target waits in the menu. */}
          <span className="truncate">
            {scope.current === "branch" && scope.label !== SCOPE_NAMES.branch ? (
              <>
                {SCOPE_NAMES.branch}
                <span className="max-sm:hidden">
                  {scope.label.slice(SCOPE_NAMES.branch.length)}
                </span>
              </>
            ) : (
              scope.label
            )}
          </span>
          <ChevronDownIcon className="shrink-0 text-ink-3" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuRadioGroup
          value={scope.current}
          onValueChange={(next) => {
            if (next !== scope.current) onScope(next as ChangesScope);
          }}
        >
          {scope.options.map((option) => (
            <DropdownMenuRadioItem
              key={option.scope}
              value={option.scope}
              disabled={!option.available}
              className="items-start"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span>{option.name}</span>
                <span className="text-xs text-ink-3">{option.detail}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Changes' toolbar actions: the view controls, then Refresh and Details. The comparison and the
 * size of the change sit at the toolbar's start and the tab names the view (`SurfaceFrame`); the
 * session header already names the branch, and what is compared and when lives in Details.
 */
export function ChangesActions({
  sheet,
  canRefresh,
  refresh,
  toggleEvery,
}: {
  sheet: ChangesSheetView;
  canRefresh: boolean;
  refresh: () => void;
  toggleEvery: () => void;
}) {
  const [wrap, setWrap] = useChangesWrap();
  return (
    <>
      <IconButton
        size="header"
        label={sheet.everyCollapsed ? "Expand all" : "Collapse all"}
        disabled={sheet.body.kind !== "files"}
        onClick={toggleEvery}
      >
        {sheet.everyCollapsed ? <ChevronsUpDownIcon /> : <ChevronsDownUpIcon />}
      </IconButton>
      {/* The remembered wrap preference, filled while on, as the header's rail toggle is. */}
      <IconButton
        size="header"
        label="Wrap"
        aria-pressed={wrap}
        onClick={() => setWrap(!wrap)}
        className="aria-pressed:bg-muted"
      >
        <WrapTextIcon />
      </IconButton>
      <IconButton
        size="header"
        label={sheet.refreshing ? "Refreshing changes…" : "Refresh changes"}
        aria-busy={sheet.refreshing}
        disabled={!canRefresh}
        onClick={refresh}
      >
        {/* The icon turns while Git is read, the one in-progress sign every refresh shares. */}
        <RefreshCwIcon className={sheet.refreshing ? "animate-spin" : undefined} />
      </IconButton>
      <ChangesDetails sheet={sheet} />
    </>
  );
}

/** The note under the toolbar while the last observation is stale. */
export function ChangesStaleNote({ sheet }: { sheet: ChangesSheetView }) {
  return (
    sheet.staleNote && (
      <p role="status" className="border-b border-line px-4 py-2 text-xs text-ink-2">
        {sheet.staleNote.text}
      </p>
    )
  );
}

const short = (commit: string) => commit.slice(0, 10);

function ChangesDetails({ sheet }: { sheet: ChangesSheetView }) {
  const { changes } = sheet;
  const comparison = changes?.result.comparison;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton size="header" label="Changes details">
          <InfoIcon />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        className="max-h-[min(32rem,70dvh)] w-96 max-w-[calc(100vw-1.5rem)] overflow-y-auto"
      >
        <PopoverHeader>
          <PopoverTitle>Changes details</PopoverTitle>
        </PopoverHeader>
        <div className="flex flex-col gap-3 text-xs text-ink-2">
          {changes && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono [overflow-wrap:anywhere]">
              <dt>Checkout</dt>
              <dd>{abbrevHome(changes.workspace.path)}</dd>
              <dt>Branch</dt>
              <dd>{sheet.branch}</dd>
              <dt>HEAD</dt>
              <dd>{changes.result.head ?? "No commits yet"}</dd>
              {comparison && (
                <>
                  <dt>Compared with</dt>
                  <dd>
                    {comparison.scope === "branch" && comparison.target
                      ? `Merge base with ${comparison.target.name}`
                      : `${SCOPE_NAMES[comparison.scope]}: HEAD`}
                  </dd>
                  <dt>Base</dt>
                  <dd>{short(comparison.base)}</dd>
                  {comparison.target && (
                    <>
                      <dt>Target</dt>
                      <dd>
                        {comparison.target.ref} at {short(comparison.target.commit)},{" "}
                        {targetProvenance(comparison.target.from)}
                      </dd>
                    </>
                  )}
                </>
              )}
              <dt>Observed</dt>
              <dd>{new Date(changes.observedAt).toLocaleString()}</dd>
            </dl>
          )}
          {sheet.staleNote && <p>{sheet.staleNote.detail}</p>}
          <p>
            Live Git reads, not an immutable review or verification evidence. Expanding unloaded
            files reads them afresh; files may change between reads. Refresh reloads all patches.
            Ignored files are excluded. Renames appear as deletion and addition. Nothing is fetched:
            a target is the branch as Git holds it locally.
          </p>
          <p>
            Initial patch: {CHANGES_INITIAL_PATCH_BYTES.toLocaleString("en-US")} bytes. Per-file
            patch: {FILE_PATCH_LIMIT}.{" "}
            {changes?.result.truncated ? "Expand unloaded files to read their patches." : ""}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
