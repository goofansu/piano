import type { ClientCommand, ProjectView, WorktreeFacts } from "@shared/wire";
import { ArrowLeftIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AlertDetails } from "@/components/Banner";
import { PickerCheck, PickerContent, PickerSearch } from "@/components/Picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { AppState } from "@/store";

/** A discovered checkout named by its repository, as the model picker names a model by its provider. */
interface Row { project: ProjectView; worktree: WorktreeFacts; label: string }

function rows(projects: readonly ProjectView[]): Row[] {
  return projects.flatMap(project => project.discovery.status === "ready"
    ? project.discovery.worktrees.map(worktree => ({ project, worktree, label: worktree.branch ?? worktree.path.split("/").filter(Boolean).at(-1) ?? "Detached HEAD" }))
    : []);
}

/** One deliberate discovery/selection or new-branch operation; never automatic retries. */
export function WorktreesPopover({ onOpenChange, onPendingChange, state, currentCwd, send, onSelect }: {
  onOpenChange: (o: boolean) => void; onPendingChange: (pending: boolean) => void; state: AppState; currentCwd: string;
  send: (m: ClientCommand) => void; onSelect: (cwd: string) => void;
}) {
  const ready = state.projects.filter(p => p.discovery.status === "ready");
  const owner = state.projects.find(p => p.worktrees.some(w => w.path === currentCwd))?.path;
  // The repository matters only when creating; picking searches every repository at once.
  const [project, setProject] = useState(owner);
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("");
  const [hooks, setHooks] = useState(false);
  // Picking is the common case; the creation form opens on request.
  const [creating, setCreating] = useState(false);
  const [request, setRequest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: "nearest" }); }, [error]);
  const [refreshing, setRefreshing] = useState(false);
  const target = ready.find(p => p.path === project) ?? ready[0];
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
    if (pending || !state.connected || !branch.trim() || !target) return;
    const requestId = crypto.randomUUID(); setRequest(requestId); setError(null);
    send({ _tag: "create_worktree", requestId, project: target.path, branch: branch.trim(), hooks });
  };
  const startCreating = (initialBranch = "") => { setError(null); setBranch(initialBranch); setCreating(true); };
  const showList = () => { setCreating(false); setError(null); };
  // Literal matching avoids unrelated fuzzy hits and preserves discovery order.
  const needle = query.trim().toLowerCase();
  const all = rows(state.projects);
  const visible = needle ? all.filter(r => [r.project.name, r.label, r.worktree.path].some(text => text.toLowerCase().includes(needle))) : all;
  const matchesProject = (p: ProjectView) => !needle || p.name.toLowerCase().includes(needle);
  // A non-Git folder is listed so its absence of worktrees reads as explicit; a failed discovery is a problem to act on.
  const nonGit = state.projects.filter(p => p.discovery.status === "non-git" && matchesProject(p));
  const failed = state.projects.flatMap(p => p.discovery.status === "error" && matchesProject(p) ? [{ name: p.name, detail: p.discovery.detail }] : []);
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
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Back to worktrees" title="Back" disabled={pending} onClick={showList}><ArrowLeftIcon /></Button>
        <p className="shrink-0 text-sm font-medium">New worktree <span className="font-normal text-ink-3">in</span></p>
        {ready.length > 1 ? <Select value={target.path} onValueChange={setProject} disabled={pending}>
          <SelectTrigger aria-label="Worktree repository" size="sm" className="min-w-0 flex-1"><SelectValue /></SelectTrigger>
          <SelectContent position="popper">
            <SelectGroup>{ready.map(p => <SelectItem key={p.path} value={p.path}>{p.name}</SelectItem>)}</SelectGroup>
          </SelectContent>
        </Select> : <p className="min-w-0 truncate text-sm font-medium">{target.name}</p>}
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
          {target && <Button variant="ghost" size="icon-sm" aria-label="New worktree" title="New worktree" disabled={pending || !state.connected} onClick={() => startCreating()}>
            <PlusIcon aria-hidden />
          </Button>}
          <Button variant="ghost" size="icon-sm" aria-label="Refresh worktrees" title="Refresh worktrees" disabled={busy} onClick={() => { setRefreshing(true); send({ _tag: "projects" }); }}>
            {refreshing ? <Spinner /> : <RefreshCwIcon aria-hidden />}
          </Button>
        </PickerSearch>
        <CommandList aria-label="Discovered worktrees" className="max-h-[min(18rem,50dvh)]">
          <CommandEmpty className="flex flex-col items-center gap-2 py-6 text-center text-sm">
            <span>No worktree matches.</span>
            {target && needle && <Button variant="outline" size="sm" disabled={pending || !state.connected} onClick={() => startCreating(query.trim())}>
              <PlusIcon aria-hidden /> New worktree “{query.trim()}”
            </Button>}
          </CommandEmpty>
          {(visible.length > 0 || nonGit.length > 0) && <CommandGroup>
            {visible.map(({ project, worktree, label }) => (
              <CommandItem key={worktree.path} value={worktree.path} disabled={busy || worktree.prunable} onSelect={() => {
                const requestId = crypto.randomUUID(); setRequest(requestId); setError(null);
                send({ _tag: "add_worktree", requestId, project: project.path, path: worktree.path });
              }}>
                <span className="min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere]">
                  <span className="text-ink-3">{project.name}/</span>
                  {label}
                </span>
                <PickerCheck selected={worktree.path === currentCwd} />
              </CommandItem>
            ))}
            {nonGit.map(p => (
              <CommandItem key={p.path} value={p.path} disabled>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="ml-auto shrink-0 text-xs text-ink-3">Non-Git directory</span>
              </CommandItem>
            ))}
          </CommandGroup>}
        </CommandList>
      </Command>
      {(!state.connected || failed.length > 0 || error) && <div className="flex flex-col gap-2 border-t border-line p-2">
        {!state.connected && <p className="px-2 text-sm text-muted-foreground">Disconnected — showing last observation.</p>}
        {failed.map(f => <Alert key={f.name} variant="destructive">
          {state.projects.length > 1 && <AlertTitle>{f.name}</AlertTitle>}
          <AlertDescription className="whitespace-pre-wrap break-words">{f.detail}</AlertDescription>
        </Alert>)}
        {errorBox}
      </div>}
    </div>}
  </PickerContent>;
}
