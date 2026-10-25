import { CHANGES_INITIAL_PATCH_BYTES } from "@shared/wire";
import { InfoIcon, RefreshCwIcon } from "lucide-react";
import { BranchLabel } from "@/components/BranchLabel";
import { IconButton } from "@/components/IconButton";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/PianoPopover";
import { PanelHeader } from "@/components/RightSidebar";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { type ChangesSheetView, FILE_PATCH_LIMIT } from "@/lib/changesView";
import { abbrevHome } from "@/lib/format";
import { useChangesWrap } from "@/lib/useChangesWrap";

/**
 * The Changes header: the title with the branch beneath it, then a toolbar with the size of the
 * change and the view controls. What is compared and when lives in Details.
 */
export function ChangesHeader({
  sheet,
  canRefresh,
  refresh,
  toggleEvery,
  close,
}: {
  sheet: ChangesSheetView;
  canRefresh: boolean;
  refresh: () => void;
  toggleEvery: () => void;
  close: () => void;
}) {
  const [wrap, setWrap] = useChangesWrap();
  return (
    <div className="shrink-0">
      <PanelHeader
        label="Changes"
        close={close}
        actions={
          <>
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
        }
      >
        <h2 className="text-sm font-medium">Changes</h2>
        <div className="flex min-w-0 items-center text-xs text-ink-3">
          {sheet.branch ? (
            <BranchLabel branch={sheet.branch} className="min-w-0" />
          ) : (
            <span className="truncate">Working tree vs HEAD</span>
          )}
        </div>
      </PanelHeader>
      {/* Plain comparison status and view controls have no dedicated shadcn layout. */}
      <div className="flex h-10 min-w-0 items-center justify-between gap-2 border-b border-line pr-2 pl-4 text-xs text-ink-2">
        <span role="status" className="min-w-0 truncate">
          {sheet.status}
        </span>
        <div className="flex shrink-0 items-center">
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
        </div>
      </div>
      {sheet.staleNote && (
        <p role="status" className="border-b border-line px-4 py-2 text-xs text-ink-2">
          {sheet.staleNote.text}
        </p>
      )}
    </div>
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
