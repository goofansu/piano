import type { ClientCommand, OutcomeProject, SessionReference } from "@shared/wire";
import { PlusIcon, TargetIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AppState } from "@/store";

type SessionRef = { cwd: string; sessionId: string };

/** The one project dialog: create or edit a name and goal. With `assign`, the saved project also takes that session. */
export type ProjectDialog = { project?: OutcomeProject; assign?: SessionRef };

/** The registry reference behind a session row, so membership is read from one place. */
export function sessionReference(state: AppState, session: SessionRef): SessionReference | undefined {
  return state.sessionReferences.find(s => s.cwd === session.cwd && s.sessionId === session.sessionId);
}

export function sessionProject(state: AppState, session: SessionRef | null | undefined): OutcomeProject | undefined {
  const id = session && sessionReference(state, session)?.outcomeProjectId;
  return id ? state.outcomeProjects.find(p => p.id === id) : undefined;
}

export const activeProjects = (state: AppState) => state.outcomeProjects.filter(p => !p.archived);

/**
 * Membership lives in the session's own menu, like Rename or Archive. Choosing a project is a radio
 * pick; "New project…" creates one and files the session in it. Hidden entirely while there are no
 * projects and nothing to leave, so the menu does not grow for people who never group sessions.
 */
export function ProjectMenu({ state, send, session, onDialog }: {
  state: AppState; send: (command: ClientCommand) => void; session: SessionRef; onDialog: (dialog: ProjectDialog) => void;
}) {
  const current = sessionProject(state, session);
  const choices = activeProjects(state);
  if (current && !choices.some(p => p.id === current.id)) choices.push(current);
  const assign = (projectId: string | null) => send({ _tag: "assign_project", cwd: session.cwd, sessionId: session.sessionId, projectId });
  return <DropdownMenuSub>
    <DropdownMenuSubTrigger disabled={!state.connected}><TargetIcon /> Project{current && <span className="ml-1 min-w-0 max-w-32 truncate text-muted-foreground">{current.name}</span>}</DropdownMenuSubTrigger>
    <DropdownMenuSubContent className="max-w-[calc(100vw-2rem)]">
      {choices.length > 0 && <>
        <DropdownMenuRadioGroup value={current?.id ?? ""} onValueChange={id => assign(id || null)}>
          {choices.map(p => <DropdownMenuRadioItem key={p.id} value={p.id}><span className="truncate">{p.name}</span>{p.archived && <span className="ml-1 text-muted-foreground">· Archived</span>}</DropdownMenuRadioItem>)}
          <DropdownMenuRadioItem value="">None</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
      </>}
      <DropdownMenuItem onSelect={() => onDialog({ assign: session })}><PlusIcon /> New project…</DropdownMenuItem>
    </DropdownMenuSubContent>
  </DropdownMenuSub>;
}

/** Organization only: saving never opens, aborts or releases a Pi child. */
export function ProjectDialogView({ state, send, dialog, close, openProject }: {
  state: AppState; send: (command: ClientCommand) => void; dialog: ProjectDialog; close: () => void; openProject: (id: string) => void;
}) {
  const [name, setName] = useState(dialog.project?.name ?? "");
  const [goal, setGoal] = useState(dialog.project?.goal ?? "");
  const editing = !!dialog.project;
  const ready = state.connected && !!name.trim();
  return <Dialog open onOpenChange={open => !open && close()}><DialogContent className="sm:max-w-md">
    <form className="flex flex-col gap-4" onSubmit={event => {
      event.preventDefault();
      if (!ready) return;
      const id = dialog.project?.id ?? crypto.randomUUID();
      send({ _tag: "save_outcome_project", project: { id, name: name.trim(), goal: goal.trim() || undefined } });
      if (dialog.assign) send({ _tag: "assign_project", cwd: dialog.assign.cwd, sessionId: dialog.assign.sessionId, projectId: id });
      close();
      if (!editing && !dialog.assign) openProject(id);
    }}>
      <DialogHeader>
        <DialogTitle>{editing ? "Edit project" : "New project"}</DialogTitle>
        <DialogDescription>{editing ? "Rename the project or restate its goal." : "A project groups sessions from any directories around one outcome."}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field><FieldLabel htmlFor="project-name">Name</FieldLabel><Input id="project-name" value={name} onChange={e => setName(e.target.value)} maxLength={200} autoFocus required /></Field>
        <Field>
          <FieldLabel htmlFor="project-goal">Goal <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel>
          <Input id="project-goal" value={goal} onChange={e => setGoal(e.target.value)} maxLength={1000} />
          <FieldDescription>Shown when you start a session here. It is not sent to Pi.</FieldDescription>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>Cancel</Button>
        <Button type="submit" disabled={!ready}>{editing ? "Save" : dialog.assign ? "Create and add session" : "Create project"}</Button>
      </DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
