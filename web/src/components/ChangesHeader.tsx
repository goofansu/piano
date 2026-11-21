import type { ChangesScope } from "@shared/wire";
import {
  ChevronDownIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  RefreshCwIcon,
} from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { PianoButton } from "@/components/PianoButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { WrapButton } from "@/components/WrapButton";
import type { ChangesSheetView, ScopeView } from "@/lib/changesView";

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
      <DropdownMenuTrigger
        render={
          <PianoButton
            variant="ghost"
            size="xs"
            disabled={disabled}
            aria-label={`Comparison: ${scope.label}`}
            className="-ml-2 min-w-0 text-ink pointer-coarse:min-h-11"
          />
        }
      >
        <span className="truncate">{scope.label}</span>
        <ChevronDownIcon className="shrink-0 text-ink-3" aria-hidden />
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
              <span className="min-w-0 break-all">{option.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
      <WrapButton />
      <IconButton
        size="header"
        label={sheet.refreshing ? "Refreshing changes…" : "Refresh changes"}
        aria-busy={sheet.refreshing}
        disabled={!canRefresh}
        onClick={refresh}
      >
        <RefreshCwIcon className={sheet.refreshing ? "animate-spin" : undefined} />
      </IconButton>
    </>
  );
}

export function ChangesStaleNote({ sheet }: { sheet: ChangesSheetView }) {
  return (
    sheet.staleNote && (
      <p role="status" className="border-b border-line px-4 py-2 text-xs text-ink-2">
        {sheet.staleNote.text} <span className="text-ink-3">{sheet.staleNote.detail}</span>
      </p>
    )
  );
}
