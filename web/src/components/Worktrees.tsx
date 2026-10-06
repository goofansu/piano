import { useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, CheckIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import type { ClientCommand } from "@shared/wire";
import type { AppState } from "@/store";
import { cn } from "cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Command, CommandGroup, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PopoverContent } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

/** One deliberate discovery/selection or new-branch operation; never automatic retries. */
export function WorktreesPopover({ onOpenChange, onPendingChange, state, currentCwd, send, onSelect }: {
  onOpenChange: (o: boolean) => void; onPendingChange: (pending: boolean) => void; state: AppState; currentCwd: string;
  send: (m: ClientCommand) => void; onSelect: (cwd: string) => void;
}) {
  const owner = state.projects.find(p => p.worktrees.some(w => w.path === currentCwd))?.path ?? state.projects[0]?.path ?? "";
  const [project, setProject] = useState(owner);
  const [branch, setBranch] = useState("");
  const [hooks, setHooks] = useState(false);
  // Picking is the common case; the creation form opens on request.
  const [creating, setCreating] = useState(false);
  const [request, setRequest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: "nearest" }); }, [error]);
  const [refreshing, setRefreshing] = useState(false);
  const p = state.projects.find(p => p.path === project);
  const discovery = p?.discovery;
  const pending = request !== null;
  useEffect(() => { onPendingChange(pending); }, [pending, onPendingChange]);
  useEffect(() => {
    setProject(owner); setError(null); setRequest(null); setRefreshing(true); setCreating(false);
    send({ _tag: "projects" });
  }, [owner, send]);
  useEffect(() => setRefreshing(false), [state.projects]);
  useEffect(() => {
    if (!request || state.worktreeResult?.requestId !== request) return;
    const result = state.worktreeResult.result;
    setRequest(null);
    if (result.status === "error") { setError(result.detail); return; }
    setBranch(""); setCreating(false); onSelect(result.path); onOpenChange(false);
  }, [state.worktreeResult, request, onSelect, onOpenChange]);
  useEffect(() => {
    if (!pending) return;
    // A disconnected client has no durable job receipt. Never resend automatically.
    const timer = setTimeout(() => { setRequest(null); setError("No creation/selection receipt. Refresh discovery and inspect the checkout before retrying; it may already exist."); }, 75_000);
    if (!state.connected) { setRequest(null); setError("Connection lost. Refresh discovery after reconnecting before retrying; the operation may have changed the checkout."); }
    return () => clearTimeout(timer);
  }, [pending, state.connected]);
  const submit = () => {
    if (pending || !state.connected || !branch.trim() || discovery?.status !== "ready") return;
    const requestId = crypto.randomUUID(); setRequest(requestId); setError(null);
    send({ _tag: "create_worktree", requestId, project, branch: branch.trim(), hooks });
  };
  const showList = () => { setCreating(false); setError(null); };
  const errorBox = error && (
    <Alert ref={errorRef} variant="destructive" className="animate-in fade-in-0 slide-in-from-top-1">
      <AlertTitle>Worktree operation not confirmed</AlertTitle>
      <AlertDescription>
        <p>Refresh discovery before retrying.</p>
        {creating && hooks && <p>For unapproved hooks, review and approve them in a terminal, or leave hooks off.</p>}
        <Collapsible>
          <CollapsibleTrigger asChild><Button variant="link" size="sm" className="h-auto p-0">Error details</Button></CollapsibleTrigger>
          <CollapsibleContent className="disclosure-content"><p className="whitespace-pre-wrap break-words">{error}</p></CollapsibleContent>
        </Collapsible>
      </AlertDescription>
    </Alert>
  );
  return <PopoverContent align="start" aria-label={creating ? "New worktree" : "Worktrees"}
      className="max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-2"
      onEscapeKeyDown={event => { if (creating && !pending) { event.preventDefault(); showList(); } }}>
    {/* The list and the form trade places with a short slide, so the swap reads as one surface. */}
    {creating && discovery?.status === "ready" ? <form key="create" className="flex animate-in flex-col gap-3 fade-in-0 slide-in-from-right-2 duration-200" onSubmit={e => { e.preventDefault(); submit(); }}>
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Back to worktrees" title="Back" disabled={pending} onClick={showList}><ArrowLeftIcon /></Button>
        <p className="min-w-0 truncate text-sm font-medium">New worktree <span className="font-normal text-ink-3">in {p?.name}</span></p>
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
        {hooks && <FieldDescription className="animate-in fade-in-0 slide-in-from-top-1">Unapproved project hooks block creation. Review and approve them in a terminal first. Background hooks may outlive creation.</FieldDescription>}
      </FieldGroup>
      {errorBox}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!branch.trim() || pending || !state.connected}>
          {pending && <Spinner />}{pending ? "Creating" : "Create"}
        </Button>
      </div>
    </form> : <div key="list" className="flex animate-in flex-col gap-2 fade-in-0 slide-in-from-left-2 duration-200">
      <div className="flex items-center gap-1">
        <Select value={project} onValueChange={setProject} disabled={pending}>
          <SelectTrigger aria-label="Worktree project" className="min-w-0 flex-1"><SelectValue /></SelectTrigger>
          <SelectContent position="popper">
            <SelectGroup>{state.projects.map(p => <SelectItem key={p.path} value={p.path}>{p.name}</SelectItem>)}</SelectGroup>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" aria-label="Refresh worktrees" title="Refresh worktrees" disabled={pending || !state.connected || refreshing} onClick={() => { setRefreshing(true); send({ _tag: "projects" }); }}>
          {refreshing ? <Spinner /> : <RefreshCwIcon />}
        </Button>
      </div>
      {!state.connected && <p className="px-2 text-sm text-muted-foreground">Disconnected — showing last observation.</p>}
      {discovery?.status === "error" && <Alert variant="destructive"><AlertDescription className="whitespace-pre-wrap break-words">{discovery.detail}</AlertDescription></Alert>}
      {discovery?.status === "non-git" && <p className="px-2 text-sm text-muted-foreground">Non-Git directory. Chat is available; worktree creation is not.</p>}
      {discovery?.status === "ready" && <Command>
        <CommandList aria-label="Discovered worktrees">
          <CommandGroup>
            {discovery.worktrees.map(w => (
              <CommandItem key={w.path} value={w.path} disabled={pending || !state.connected || refreshing || w.prunable} onSelect={() => {
                const requestId = crypto.randomUUID(); setRequest(requestId); setError(null);
                send({ _tag: "add_worktree", requestId, project, path: w.path });
              }}>
                <span className="min-w-0 flex-1 truncate">{w.branch ?? w.path.split("/").filter(Boolean).at(-1) ?? "Detached HEAD"}</span>
                <CheckIcon className={cn("ml-auto", w.path === currentCwd ? "opacity-100" : "opacity-0")} />
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup>
            <CommandItem value="__new-worktree" disabled={pending || !state.connected} onSelect={() => { setError(null); setCreating(true); }}>
              <PlusIcon /> New worktree
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>}
      {errorBox}
    </div>}
  </PopoverContent>;
}
