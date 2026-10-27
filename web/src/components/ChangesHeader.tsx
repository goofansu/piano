import type { ChangesScope } from "@shared/wire";
import {
  ChevronDownIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
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
import { Button } from "@/components/ui/button";
import { type ChangesSheetView, SCOPE_NAMES, type ScopeView } from "@/lib/changesView";
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
    </>
  );
}

/** The note under the toolbar while the last observation is stale, with the failure's reason. */
export function ChangesStaleNote({ sheet }: { sheet: ChangesSheetView }) {
  return (
    sheet.staleNote && (
      <p role="status" className="border-b border-line px-4 py-2 text-xs text-ink-2">
        {sheet.staleNote.text} <span className="text-ink-3">{sheet.staleNote.detail}</span>
      </p>
    )
  );
}
