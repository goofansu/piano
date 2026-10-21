import { CHANGES_INITIAL_PATCH_BYTES } from "@shared/wire";
import { InfoIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { BranchLabel } from "@/components/BranchLabel";
import { IconButton } from "@/components/IconButton";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/PianoPopover";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Toggle } from "@/components/ui/toggle";
import { type ChangesSheetView, FILE_PATCH_LIMIT } from "@/lib/changesView";
import { abbrevHome } from "@/lib/format";
import { useChangesWrap } from "@/lib/useChangesWrap";

/** The Changes header follows panel width, including a narrow column on a desktop. */
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
    <header className="@container shrink-0">
      {/* Plain comparison metadata and panel controls have no dedicated shadcn layout. */}
      <div className="grid min-w-0 grid-cols-1 @min-[37.5rem]:grid-cols-[minmax(0,1fr)_auto]">
        <div className="col-span-full flex min-w-0 flex-wrap items-center gap-x-2 px-3 pt-2">
          <h2 className="grow text-sm font-medium">Changes</h2>
          <div className="flex min-w-0 max-w-full flex-wrap items-center">
            <IconButton
              label="Refresh changes"
              disabled={!canRefresh}
              onClick={refresh}
              className="pointer-coarse:size-11"
            >
              <RefreshCwIcon />
            </IconButton>
            <ChangesDetails sheet={sheet} />
            <IconButton label="Close changes" onClick={close} className="pointer-coarse:size-11">
              <XIcon />
            </IconButton>
          </div>
        </div>
        {/* Like SessionHeader: truncate a secondary segment, then hide it whole when it wraps.
         * Details keeps the complete branch available to touch and keyboard users. */}
        <div className="mx-3 mb-3 flex h-[1lh] @max-[18rem]:h-auto min-w-0 flex-wrap items-center gap-x-1.5 overflow-hidden text-xs text-ink-3 @min-[37.5rem]:mb-2 @min-[37.5rem]:self-center">
          <span className="max-w-full shrink-0">Working tree vs HEAD</span>
          {sheet.branch && (
            <span className="flex min-w-0 max-w-max shrink grow basis-24 items-center gap-1.5 @max-[18rem]:hidden">
              <span aria-hidden>·</span>
              <BranchLabel branch={sheet.branch} />
            </span>
          )}
        </div>
        <Separator className="@min-[37.5rem]:hidden" />
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1 pr-2 pl-3 @min-[37.5rem]:pt-0 @min-[37.5rem]:pb-2 @min-[37.5rem]:pl-0">
          <div className="flex min-w-0 items-center gap-2 text-xs text-ink-2">
            <span role="status">{sheet.status}</span>
            {sheet.refreshing && <Spinner className="size-3 shrink-0" />}
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center">
            <Button
              variant="ghost"
              size="sm"
              disabled={sheet.body.kind !== "files"}
              onClick={toggleEvery}
              className="pointer-coarse:min-h-11"
            >
              {sheet.everyCollapsed ? "Expand all" : "Collapse all"}
            </Button>
            <Toggle
              size="sm"
              pressed={wrap}
              onPressedChange={setWrap}
              className="pointer-coarse:min-h-11"
            >
              Wrap
            </Toggle>
          </div>
        </div>
        {sheet.staleNote && (
          <p role="status" className="col-span-full px-3 pb-2 text-xs text-ink-2">
            {sheet.staleNote.text}
          </p>
        )}
      </div>
      <Separator />
    </header>
  );
}

function ChangesDetails({ sheet }: { sheet: ChangesSheetView }) {
  const { changes } = sheet;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label="Changes details" className="pointer-coarse:size-11">
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
