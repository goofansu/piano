import { CHANGES_INITIAL_PATCH_BYTES } from "@shared/wire";
import { InfoIcon, RefreshCwIcon } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/PianoPopover";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { type ChangesSheetView, FILE_PATCH_LIMIT } from "@/lib/changesView";
import { abbrevHome } from "@/lib/format";
import { useChangesWrap } from "@/lib/useChangesWrap";

/**
 * Changes' toolbar actions: the view controls, then Refresh and Details. The size of the change sits
 * at the toolbar's start and the tab names the view (`SurfaceFrame`); the session header already
 * names the branch, and what is compared and when lives in Details.
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
      <Button
        variant="ghost"
        size="xs"
        disabled={sheet.body.kind !== "files"}
        onClick={toggleEvery}
        className="text-ink-2 pointer-coarse:min-h-11"
      >
        {sheet.everyCollapsed ? "Expand all" : "Collapse all"}
      </Button>
      <Toggle
        size="sm"
        pressed={wrap}
        onPressedChange={setWrap}
        className="h-6 min-w-0 px-2 text-xs text-ink-2 pointer-coarse:min-h-11"
      >
        Wrap
      </Toggle>
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

function ChangesDetails({ sheet }: { sheet: ChangesSheetView }) {
  const { changes } = sheet;
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
          <p>Working tree against HEAD</p>
          {changes && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono [overflow-wrap:anywhere]">
              <dt>Checkout</dt>
              <dd>{abbrevHome(changes.workspace.path)}</dd>
              <dt>Branch</dt>
              <dd>{sheet.branch}</dd>
              <dt>HEAD</dt>
              <dd>{changes.result.head ?? "No commits yet"}</dd>
              <dt>Observed</dt>
              <dd>{new Date(changes.observedAt).toLocaleString()}</dd>
            </dl>
          )}
          {sheet.staleNote && <p>{sheet.staleNote.detail}</p>}
          <p>
            Live Git reads, not an immutable review or verification evidence. Expanding unloaded
            files reads them afresh; files may change between reads. Refresh reloads all patches.
            Ignored files are excluded. Renames appear as deletion and addition.
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
