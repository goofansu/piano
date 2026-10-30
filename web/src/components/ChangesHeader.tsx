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
import type { ChangesSheetView, ScopeView } from "@/lib/changesView";
import { useChangesWrap } from "@/lib/useChangesWrap";

/**
 * The comparison, at the toolbar's start: Uncommitted or the actual target ref, with the same
 * names in its menu. A choice is saved for the session; the list answers by changing.
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
          <span className="truncate">{scope.label}</span>
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
            >
              <span className="flex min-w-0 flex-col">
                <span className="break-all">{option.name}</span>
                {option.reason && (
                  <span className="text-xs font-normal text-muted-foreground">{option.reason}</span>
                )}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Changes' toolbar actions: the view controls, then Refresh. The comparison sits at the toolbar's
 * start and the tab names the view (`SurfaceFrame`).
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
