import type { ClientCommand, OutcomeProject, SessionReference } from "@shared/wire";
import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AppState } from "@/store";

export type ProjectDialog = { kind: "edit"; project?: OutcomeProject } | { kind: "archived" } | { kind: "add"; project: OutcomeProject } | { kind: "assign"; session: SessionReference };
type Common = { state: AppState; send: (command: ClientCommand) => void };

export function OutcomeProjectView({ state, send, id, select, openNew, onDialog, onMenu }: Common & {
  id: string; select: (cwd: string, sessionId: string) => void; openNew: () => void;
  onDialog: (dialog: ProjectDialog) => void; onMenu: () => void;
}) {
  const project = state.outcomeProjects.find(p => p.id === id);
  if (!project) return <Empty><EmptyHeader><EmptyDescription>{state.projectsLoaded ? "Project unavailable. Refresh or restore the registry from a known-good backup." : "Loading project…"}</EmptyDescription></EmptyHeader></Empty>;
  const members = state.sessionReferences.filter(s => s.outcomeProjectId === id);
  return <section className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
    <Button variant="ghost" className="self-start md:hidden" onClick={onMenu}>Show sidebar</Button>
    <header className="flex flex-wrap items-center gap-2">
      <h1 className="min-w-0 basis-full break-words text-xl font-medium sm:flex-1 sm:basis-auto">{project.name}</h1>
      <Button variant="ghost" disabled={!state.connected} onClick={() => onDialog({ kind: "edit", project })}>Edit project</Button>
      <Button variant="ghost" disabled={!state.connected} onClick={() => send({ _tag: "archive_outcome_project", id: project.id, archived: !project.archived })}>{project.archived ? "Reopen project" : "Archive project"}</Button>
    </header>
    {project.goal && <p className="whitespace-pre-wrap text-muted-foreground">{project.goal}</p>}
    {!project.archived && <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={!state.connected} onClick={() => onDialog({ kind: "add", project })}>Add sessions</Button>
      <Button disabled={!state.connected} onClick={openNew}>New session in project</Button>
    </div>}
    {!members.length && <Empty><EmptyHeader><EmptyDescription>No sessions yet. Add existing sessions or start one in a directory you choose.</EmptyDescription></EmptyHeader></Empty>}
    <ul className="flex flex-col gap-2">
      {members.map(s => <li key={JSON.stringify([s.cwd, s.sessionId])} className="flex items-center gap-2">
        <Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start py-3" title={s.cwd} disabled={s.unavailable === "history"} onClick={() => select(s.cwd, s.sessionId)}>
          <span className="flex min-w-0 flex-col items-start gap-1"><span className="truncate">{s.title || "Untitled"}{s.archived ? " · Archived session" : ""}</span><span dir="rtl" className="max-w-full truncate text-xs text-muted-foreground"><span dir="ltr">{s.cwd}</span></span>{s.unavailable && <span className="whitespace-normal text-left text-xs text-muted-foreground">{s.unavailable === "history" ? "History unavailable. Restore the Pi session file to open it." : "Checkout unavailable. History can be read; restore the directory to continue."}</span>}</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Project actions for ${s.title || "Untitled"}`}><MoreHorizontalIcon /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuGroup>
            <DropdownMenuItem disabled={!state.connected} onSelect={() => onDialog({ kind: "assign", session: s })}>Move to project</DropdownMenuItem>
            <DropdownMenuItem disabled={!state.connected} onSelect={() => send({ _tag: "assign_project", cwd: s.cwd, sessionId: s.sessionId, projectId: null })}>Remove from project</DropdownMenuItem>
          </DropdownMenuGroup></DropdownMenuContent>
        </DropdownMenu>
      </li>)}
    </ul>
  </section>;
}

/** Organization only: none of these actions opens, aborts or releases a Pi child. */
export function OutcomeProjectDialogs({ state, send, dialog, close, openProject }: Common & {
  dialog: ProjectDialog; close: () => void; openProject: (id: string) => void;
}) {
  const [name, setName] = useState(dialog.kind === "edit" ? dialog.project?.name ?? "" : "");
  const [goal, setGoal] = useState(dialog.kind === "edit" ? dialog.project?.goal ?? "" : "");
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<SessionReference | null>(null);
  const title = dialog.kind === "edit" ? dialog.project ? "Edit project" : "New project" : dialog.kind === "archived" ? "Archived projects" : dialog.kind === "add" ? "Add sessions" : "Move to project";
  const assign = (session: SessionReference, projectId: string | null) => {
    send({ _tag: "assign_project", cwd: session.cwd, sessionId: session.sessionId, projectId });
    close();
  };
  return <Dialog open onOpenChange={open => !open && close()}><DialogContent className="max-h-[85dvh] overflow-y-auto">
    <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{dialog.kind === "edit" ? "Group work across directories. The goal is not sent to Pi." : "Only organization changes. Sessions, history and running work stay where they are."}</DialogDescription></DialogHeader>
    {dialog.kind === "edit" ? <form className="flex flex-col gap-4" onSubmit={event => {
      event.preventDefault();
      if (!state.connected || !name.trim()) return;
      const id = dialog.project?.id ?? crypto.randomUUID();
      send({ _tag: "save_outcome_project", project: { id, name: name.trim(), goal: goal.trim() || undefined } });
      close(); openProject(id);
    }}>
      <FieldGroup><Field><FieldLabel htmlFor="project-name">Name</FieldLabel><Input id="project-name" value={name} onChange={e => setName(e.target.value)} maxLength={200} autoFocus required /></Field>
      <Field><FieldLabel htmlFor="project-goal">Goal (optional)</FieldLabel><Input id="project-goal" value={goal} onChange={e => setGoal(e.target.value)} maxLength={1000} /></Field></FieldGroup>
      <DialogFooter><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button type="submit" disabled={!state.connected || !name.trim()}>Save project</Button></DialogFooter>
    </form> : dialog.kind === "archived" ? <div className="flex flex-col gap-2">
      {state.outcomeProjects.filter(p => p.archived).map(p => <Button key={p.id} variant="ghost" onClick={() => { close(); openProject(p.id); }}>{p.name}</Button>)}
      {!state.outcomeProjects.some(p => p.archived) && <p className="text-muted-foreground">No archived projects.</p>}
    </div> : dialog.kind === "assign" ? <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{dialog.session.title || "Untitled"} · {dialog.session.cwd}</p>
      {state.outcomeProjects.filter(p => !p.archived && p.id !== dialog.session.outcomeProjectId).map(p => <Button key={p.id} variant="outline" disabled={!state.connected} onClick={() => assign(dialog.session, p.id)}>{dialog.session.outcomeProjectId ? "Move to" : "Add to"} {p.name}</Button>)}
      {dialog.session.outcomeProjectId && <Button variant="outline" disabled={!state.connected} onClick={() => assign(dialog.session, null)}>Remove from project</Button>}
      {!state.outcomeProjects.some(p => !p.archived && p.id !== dialog.session.outcomeProjectId) && <p className="text-muted-foreground">Create another project to move this session.</p>}
    </div> : <div className="flex flex-col gap-3">
      <Field><FieldLabel htmlFor="session-search">Find a session</FieldLabel><Input id="session-search" value={search} onChange={e => { setSearch(e.target.value); setChosen(null); }} /></Field>
      {state.sessionReferences.filter(s => s.outcomeProjectId !== dialog.project.id && `${s.title} ${s.cwd}`.toLowerCase().includes(search.toLowerCase())).map(s => <Button key={JSON.stringify([s.cwd, s.sessionId])} variant={chosen === s ? "secondary" : "ghost"} className="h-auto justify-start whitespace-normal text-left" onClick={() => setChosen(s)}>{s.title || "Untitled"} · {s.cwd}</Button>)}
      {chosen && <><p className="text-sm text-muted-foreground">{chosen.outcomeProjectId ? `Move from ${state.outcomeProjects.find(p => p.id === chosen.outcomeProjectId)?.name} to ${dialog.project.name}?` : `Add to ${dialog.project.name}?`}</p><Button disabled={!state.connected} onClick={() => assign(chosen, dialog.project.id)}>{chosen.outcomeProjectId ? "Move session" : "Add session"}</Button></>}
    </div>}
  </DialogContent></Dialog>;
}
