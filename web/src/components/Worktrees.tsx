import { ArrowLeftIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { folderFor } from "@/lib/sessionContext";
import {
  type WorktreeOperation,
  type WorktreeOperationState,
  worktreeLabel,
  worktreesView,
} from "@/lib/worktreeOperation";
import type { AppState } from "@/store";

/**
 * The current folder's repository only: opening or refreshing rediscovers that one repository. One
 * deliberate selection or new-branch operation; never automatic retries. The operation
 * (lib/worktreeOperation) owns requests, receipts and discovery, and `worktreesView` decides what
 * the picker shows and allows; this renders it and keeps the form's own fields.
 */
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
  const [branch, setBranch] = useState("");
  const [hooks, setHooks] = useState(false);
  // Picking is the common case; the creation form opens on request.
  const [creating, setCreating] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const view = worktreesView({
    state: operation,
    folder: folderFor(state, currentCwd),
    connected: state.connected,
    form: { creating, branch, hooks, query },
  });
  const { target, pending, failure } = view;
  useEffect(() => {
    if (operation.request.status === "failed")
      errorRef.current?.scrollIntoView({ block: "nearest" });
  }, [operation.request]);
  const submit = () => {
    if (view.canSubmit) operation.create(branch, hooks);
  };
  const startCreating = (initialBranch = "") => {
    operation.dismiss();
    setBranch(initialBranch);
    setCreating(true);
  };
  const showList = () => {
    setCreating(false);
    operation.dismiss();
  };
  const errorBox = failure && (
    <Alert
      ref={errorRef}
      variant="destructive"
      className="animate-in fade-in-0 slide-in-from-top-1"
    >
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
    <PickerContent
      aria-label={creating ? "New worktree" : "Worktrees"}
      searchRef={search}
      onEscapeKeyDown={(event) => {
        if (creating && !pending) {
          event.preventDefault();
          showList();
        }
      }}
    >
      {/* The list and the form trade places with a short slide, so the swap reads as one surface. */}
      {creating && target ? (
        <form
          key="create"
          className="flex animate-in flex-col gap-3 p-2 fade-in-0 slide-in-from-right-2 duration-200"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex items-center gap-1">
            <IconButton
              type="button"
              label="Back to worktrees"
              disabled={pending}
              onClick={showList}
            >
              <ArrowLeftIcon />
            </IconButton>
            <p className="shrink-0 text-sm font-medium">
              New worktree <span className="font-normal text-ink-3">in</span>
            </p>
            <p className="min-w-0 truncate text-sm font-medium">{target.name}</p>
          </div>
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel htmlFor="wt-branch">Branch</FieldLabel>
              <Input
                id="wt-branch"
                autoFocus
                value={branch}
                disabled={pending}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="Branch name"
                autoComplete="off"
              />
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="wt-hooks"
                checked={hooks}
                disabled={pending}
                onCheckedChange={(checked) => setHooks(checked === true)}
              />
              <FieldLabel htmlFor="wt-hooks">Run approved Worktrunk hooks</FieldLabel>
            </Field>
            {hooks && (
              <FieldDescription className="animate-in fade-in-0 slide-in-from-top-1">
                Unapproved repository hooks block creation. Review and approve them in a terminal
                first. Background hooks may outlive creation.
              </FieldDescription>
            )}
          </FieldGroup>
          {errorBox}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!view.canSubmit}>
              {pending && <Spinner />}
              {pending ? "Creating" : "Create"}
            </Button>
          </div>
        </form>
      ) : (
        <div
          key="list"
          className="flex animate-in flex-col fade-in-0 slide-in-from-left-2 duration-200"
        >
          <Command shouldFilter={false}>
            <PickerSearch
              ref={search}
              value={query}
              onValueChange={setQuery}
              aria-label="Search worktrees"
              placeholder="Search worktrees"
              disabled={pending}
            >
              {target && (
                <IconButton
                  label="New worktree"
                  disabled={!view.canStart}
                  onClick={() => startCreating()}
                >
                  <PlusIcon aria-hidden />
                </IconButton>
              )}
              <IconButton
                label="Refresh worktrees"
                disabled={view.busy}
                onClick={operation.refresh}
              >
                {operation.refreshing ? <Spinner /> : <RefreshCwIcon aria-hidden />}
              </IconButton>
            </PickerSearch>
            <CommandList aria-label="Discovered worktrees" className="max-h-[min(18rem,50dvh)]">
              <CommandEmpty className="flex flex-col items-center gap-2 py-6 text-center text-sm">
                <span>{view.emptyText}</span>
                {view.createFromQuery && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!view.canStart}
                    onClick={() => startCreating(view.createFromQuery)}
                  >
                    <PlusIcon aria-hidden /> New worktree “{view.createFromQuery}”
                  </Button>
                )}
              </CommandEmpty>
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
      )}
    </PickerContent>
  );
}
