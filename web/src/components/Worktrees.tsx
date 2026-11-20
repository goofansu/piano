import { RefreshCwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AlertDetails } from "@/components/Banner";
import { IconButton } from "@/components/IconButton";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/PianoCommand";
import { PickerCheck, PickerContent, PickerSearch } from "@/components/Picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { folderFor } from "@/lib/sessionCatalog";
import {
  type WorktreeOperation,
  type WorktreeOperationState,
  worktreeLabel,
  worktreesView,
} from "@/lib/worktreeOperation";
import type { AppState } from "@/store";

export function WorktreesPopover({
  operation,
  state,
  currentCwd,
}: {
  operation: WorktreeOperation & WorktreeOperationState;
  state: AppState;
  currentCwd: string;
}) {
  const [query, setQuery] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const view = worktreesView({
    state: operation,
    folder: folderFor(state, currentCwd),
    connected: state.connected,
    query,
  });
  const { pending, failure } = view;
  useEffect(() => {
    if (operation.request.status === "failed")
      errorRef.current?.scrollIntoView({ block: "nearest" });
  }, [operation.request]);
  const errorBox = failure && (
    <Alert ref={errorRef} variant="destructive">
      <AlertTitle>{failure.title}</AlertTitle>
      <AlertDescription>
        {failure.lines.map((line) => (
          <p key={line} className="whitespace-pre-wrap break-words">
            {line}
          </p>
        ))}
        {failure.details && (
          <AlertDetails label="Error details">
            <p className="whitespace-pre-wrap break-words">{failure.details}</p>
          </AlertDetails>
        )}
      </AlertDescription>
    </Alert>
  );
  const { disconnected, discoveryError } = view.notices;
  return (
    <PickerContent aria-label="Worktrees" searchRef={search}>
      <div className="flex flex-col">
        <Command shouldFilter={false}>
          <PickerSearch
            ref={search}
            value={query}
            onValueChange={setQuery}
            aria-label="Search worktrees"
            placeholder="Search worktrees"
            disabled={pending}
          >
            <IconButton
              size="header"
              label="Refresh worktrees"
              disabled={view.busy}
              onClick={operation.refresh}
            >
              {operation.refreshing ? <Spinner /> : <RefreshCwIcon aria-hidden />}
            </IconButton>
          </PickerSearch>
          <CommandList aria-label="Discovered worktrees" className="max-h-[min(18rem,50dvh)]">
            <CommandEmpty className="py-6 text-center text-sm">{view.emptyText}</CommandEmpty>
            {view.visible.length > 0 && (
              <CommandGroup>
                {view.visible.map((worktree) => (
                  <CommandItem
                    key={worktree.path}
                    value={worktree.path}
                    disabled={view.busy || worktree.prunable}
                    onSelect={() => operation.select(worktree.path)}
                  >
                    <span className="min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere]">
                      {worktreeLabel(worktree)}
                    </span>
                    <PickerCheck selected={worktree.path === currentCwd} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
        {(disconnected || discoveryError || failure) && (
          <div className="flex flex-col gap-2 border-t border-line p-2">
            {disconnected && <p className="px-2 text-sm text-muted-foreground">{disconnected}</p>}
            {discoveryError && (
              <Alert variant="destructive">
                <AlertDescription className="whitespace-pre-wrap break-words">
                  {discoveryError}
                </AlertDescription>
              </Alert>
            )}
            {errorBox}
          </div>
        )}
      </div>
    </PickerContent>
  );
}
