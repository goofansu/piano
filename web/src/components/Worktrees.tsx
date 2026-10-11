import type { ClientCommand } from "@shared/wire";
import { ArrowLeftIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertDetails } from "@/components/Banner";
import { IconButton } from "@/components/IconButton";
import { PickerCheck, PickerContent, PickerSearch } from "@/components/Picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { folderFor } from "@/lib/sessionContext";
import { filterWorktrees, initialWorktreeRequest, RECEIPT_TIMEOUT_MS, transition, type WorktreeEvent, worktreeLabel } from "@/lib/worktreeRequest";
import type { AppState } from "@/store";

/** The current folder's repository only: opening or refreshing rediscovers that one repository. One deliberate selection or new-branch operation; never automatic retries. */
export function WorktreesPopover({ onOpenChange, onPendingChange, state, currentCwd, send, onSelect }: {
  onOpenChange: (o: boolean) => void; onPendingChange: (pending: boolean) => void; state: AppState; currentCwd: string;
  send: (m: ClientCommand) => void; onSelect: (cwd: string) => void;
}) {
  const folder = folderFor(state, currentCwd);
  // The sidebar snapshot stands in only until this picker's own discovery answers.
  const discovery = folder && (state.worktrees[folder.path] ?? folder.discovery);
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("");
  const [hooks, setHooks] = useState(false);
  // Picking is the common case; the creation form opens on request.
  const [creating, setCreating] = useState(false);
  // The ref is the operation's current state, so an event never reads a stale render; the state re-renders.
  const operationRef = useRef(initialWorktreeRequest);
  const [operation, setOperation] = useState(initialWorktreeRequest);
  const errorRef = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const error = operation.request.status === "failed" ? operation.request.detail : null;
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: "nearest" }); }, [error]);
  const { refreshing } = operation;
  const target = discovery?.status === "ready" ? folder : undefined;
  const pending = operation.request.status === "pending";
  useEffect(() => { onPendingChange(pending); }, [pending, onPendingChange]);
  const step = useCallback((event: WorktreeEvent) => {
    const next = transition(operationRef.current, event);
    operationRef.current = next.state; setOperation(next.state);
    if (next.command) send(next.command);
    return next;
  }, [send]);
  const rediscover = useCallback(() => { step({ type: "refresh", folder: folder?.path }); }, [folder?.path, step]);
  useEffect(() => {
    setCreating(false); step({ type: "rediscover", folder: folder?.path });
  }, [folder?.path, step]);
  const answered = folder && state.worktrees[folder.path];
  useEffect(() => { if (answered) step({ type: "answered" }); }, [answered, step]);
  useEffect(() => {
    const opened = step({ type: "receipt", receipt: state.worktreeResult }).ready;
    if (opened === undefined) return;
    setBranch(""); setCreating(false); onSelect(opened); onOpenChange(false);
  }, [state.worktreeResult, step, onSelect, onOpenChange]);
  useEffect(() => {
    if (!pending) return;
    // A disconnected client has no durable job receipt. Never resend automatically.
    const timer = setTimeout(() => step({ type: "timeout" }), RECEIPT_TIMEOUT_MS);
    if (!state.connected) step({ type: "disconnected" });
    return () => clearTimeout(timer);
  }, [pending, state.connected, step]);
  const submit = () => {
    if (!state.connected || !branch.trim() || !target) return;
    step({ type: "start", requestId: crypto.randomUUID(), intent: { kind: "create", folder: target.path, branch: branch.trim(), hooks } });
  };
  const startCreating = (initialBranch = "") => { step({ type: "dismiss" }); setBranch(initialBranch); setCreating(true); };
  const showList = () => { setCreating(false); step({ type: "dismiss" }); };
  const all = discovery?.status === "ready" ? discovery.worktrees : [];
  const visible = filterWorktrees(all, query);
  const needle = query.trim();
  const busy = pending || !state.connected || refreshing;
  const errorBox = error && (
    <Alert ref={errorRef} variant="destructive" className="animate-in fade-in-0 slide-in-from-top-1">
      <AlertTitle>Worktree operation not confirmed</AlertTitle>
      <AlertDescription>
        <p>Refresh discovery before retrying.</p>
        {creating && hooks && <p>For unapproved hooks, review and approve them in a terminal, or leave hooks off.</p>}
        <AlertDetails label="Error details"><p className="whitespace-pre-wrap break-words">{error}</p></AlertDetails>
      </AlertDescription>
    </Alert>
  );
  return <PickerContent aria-label={creating ? "New worktree" : "Worktrees"} searchRef={search}
      onEscapeKeyDown={event => { if (creating && !pending) { event.preventDefault(); showList(); } }}>
    {/* The list and the form trade places with a short slide, so the swap reads as one surface. */}
    {creating && target ? <form key="create" className="flex animate-in flex-col gap-3 p-2 fade-in-0 slide-in-from-right-2 duration-200" onSubmit={e => { e.preventDefault(); submit(); }}>
      <div className="flex items-center gap-1">
        <IconButton type="button" label="Back to worktrees" disabled={pending} onClick={showList}><ArrowLeftIcon /></IconButton>
        <p className="shrink-0 text-sm font-medium">New worktree <span className="font-normal text-ink-3">in</span></p>
        <p className="min-w-0 truncate text-sm font-medium">{target.name}</p>
      </div>
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor="wt-branch">Branch</FieldLabel>
          <Input id="wt-branch" autoFocus value={branch} disabled={pending} onChange={e => setBranch(e.target.value)} placeholder="Branch name" autoComplete="off" />
        </Field>
        <Field orientation="horizontal">
          <Checkbox id="wt-hooks" checked={hooks} disabled={pending} onCheckedChange={checked => setHooks(checked === true)} />
          <FieldLabel htmlFor="wt-hooks">Run approved Worktrunk hooks</FieldLabel>
        </Field>
        {hooks && <FieldDescription className="animate-in fade-in-0 slide-in-from-top-1">Unapproved repository hooks block creation. Review and approve them in a terminal first. Background hooks may outlive creation.</FieldDescription>}
      </FieldGroup>
      {errorBox}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!branch.trim() || pending || !state.connected}>
          {pending && <Spinner />}{pending ? "Creating" : "Create"}
        </Button>
      </div>
    </form> : <div key="list" className="flex animate-in flex-col fade-in-0 slide-in-from-left-2 duration-200">
      <Command shouldFilter={false}>
        <PickerSearch ref={search} value={query} onValueChange={setQuery} aria-label="Search worktrees" placeholder="Search worktrees" disabled={pending}>
          {target && <IconButton label="New worktree" disabled={pending || !state.connected} onClick={() => startCreating()}>
            <PlusIcon aria-hidden />
          </IconButton>}
          <IconButton label="Refresh worktrees" disabled={busy} onClick={rediscover}>
            {refreshing ? <Spinner /> : <RefreshCwIcon aria-hidden />}
          </IconButton>
        </PickerSearch>
        <CommandList aria-label="Discovered worktrees" className="max-h-[min(18rem,50dvh)]">
          <CommandEmpty className="flex flex-col items-center gap-2 py-6 text-center text-sm">
            <span>{discovery?.status === "non-git" ? "Non-Git directory" : "No worktree matches."}</span>
            {target && needle && <Button variant="outline" size="sm" disabled={pending || !state.connected} onClick={() => startCreating(query.trim())}>
              <PlusIcon aria-hidden /> New worktree “{query.trim()}”
            </Button>}
          </CommandEmpty>
          {target && visible.length > 0 && <CommandGroup>
            {visible.map(worktree => (
              <CommandItem key={worktree.path} value={worktree.path} disabled={busy || worktree.prunable} onSelect={() => step({ type: "start", requestId: crypto.randomUUID(), intent: { kind: "select", folder: target.path, path: worktree.path } })}>
                <span className="min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere]">{worktreeLabel(worktree)}</span>
                <PickerCheck selected={worktree.path === currentCwd} />
              </CommandItem>
            ))}
          </CommandGroup>}
        </CommandList>
      </Command>
      {(!state.connected || discovery?.status === "error" || error) && <div className="flex flex-col gap-2 border-t border-line p-2">
        {!state.connected && <p className="px-2 text-sm text-muted-foreground">Disconnected — showing last observation.</p>}
        {discovery?.status === "error" && <Alert variant="destructive">
          <AlertDescription className="whitespace-pre-wrap break-words">{discovery.detail}</AlertDescription>
        </Alert>}
        {errorBox}
      </div>}
    </div>}
  </PickerContent>;
}
