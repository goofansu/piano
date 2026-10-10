import { CopyIcon, FileDiffIcon, GitBranchIcon, GitPullRequestIcon, ListIcon, MessageSquareIcon, MoreHorizontalIcon, PanelLeftOpenIcon, PlusIcon, SplitIcon } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { copyAllSessionDetails, currentSessionDetails, sessionWorkspace } from "@/components/SessionActions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { SESSION_DISPLAYS, useSessionDisplay } from "@/lib/useSessionDisplay";
import type { AppState } from "@/store";

export function SessionHeader({ state, onMenu, openNew, openProject, status, openChanges, pullRequest, openPullRequest }: {
  state: AppState; onMenu: () => void; openNew: (cwd?: string) => void; openProject: (id: string) => void;
  status: string; openChanges: () => void; pullRequest: React.ReactNode; openPullRequest: () => void;
}) {
  const session = state.session;
  const { title, branch, sessionId, project } = currentSessionDetails(state);
  const [display, setDisplay] = useSessionDisplay();
  const target = session?.sessionId ? { cwd: session.cwd, sessionId: session.sessionId, title } : undefined;
  const workspace = sessionWorkspace(state);
  const cwd = session?.cwd ?? state.pendingCreate?.cwd;
  // Zed's form: `folder ⇄ worktree / ⑂ branch`; a session in the folder itself has no worktree segment.
  const owner = state.folders.find(f => f.worktrees.some(w => w.path === cwd));
  const checkout = owner?.worktrees.find(w => w.path === cwd);
  const folder = owner?.name ?? cwd?.split("/").pop() ?? "";
  const worktree = checkout && !checkout.root ? worktreeName(folder, checkout.path) : undefined;
  return <>
    {/* Outside the transcript scroller: stays visible without an overlay or scroll listener. */}
    <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3 md:px-6">
      <Button variant="ghost" size="icon-sm" className="-ml-2 md:hidden" aria-label="Show sidebar" onClick={onMenu}><PanelLeftOpenIcon /></Button>
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
        {cwd ? <>
          <div className="col-span-2 flex min-w-0 flex-col gap-1 md:col-span-1">
            {/* The project is the way back to where this session was opened from. */}
            {project && <button type="button" className="-mb-0.5 max-w-full self-start truncate rounded text-xs text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" title={project.goal || project.name} onClick={() => openProject(project.id)}>{project.name}</button>}
            <h1 className="truncate text-sm font-medium" title={session ? title : undefined}>{session ? title : "New session"}</h1>
          </div>
          {/* Plain workspace metadata has no dedicated UI primitive. */}
          <div className="col-start-1 row-start-2 flex min-w-0 items-center gap-2">
            {/* Full length while it fits; on narrow screens the branch gives way first, then the worktree. */}
            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
              <p title={cwd} className="max-w-2/5 shrink-0 truncate">
                <span className="sr-only">Working directory: </span>{folder}
              </p>
              {worktree && <p title={checkout?.path} className="flex min-w-0 items-center gap-1 font-mono">
                <SplitIcon aria-hidden="true" className="size-3 shrink-0 rotate-90" />
                <span className="sr-only">Worktree: </span>
                <span className="truncate">{worktree}</span>
              </p>}
              {branch && <span aria-hidden="true" className="text-ink-3/60">/</span>}
              {branch && <p title={branch} className="flex min-w-12 flex-1 items-center gap-1 font-mono">
                <GitBranchIcon aria-hidden="true" className="size-3 shrink-0" />
                <span className="sr-only">Git branch: </span>
                <span className="truncate">{branch}</span>
              </p>}
            </div>
          </div>
          <div className="col-start-2 row-start-2 shrink-0 justify-self-end md:row-span-2 md:row-start-1">{pullRequest}</div>
        </> : <><Skeleton className="col-span-2 h-4 w-40" /><Skeleton className="col-span-2 h-3 w-28" /></>}
      </div>
      <span role="status" className="sr-only">{status}</span>
      <IconButton label="New session here" disabled={!session || session.state.checkoutMissing} onClick={() => { if (session) openNew(session.cwd); }}><PlusIcon /></IconButton>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Session information and actions" disabled={!session}><MoreHorizontalIcon /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" collisionPadding={16} className="w-96 max-w-[calc(100vw-2rem)]">
          <DropdownMenuGroup className="flex items-start">
            {/* Static, selectable metadata has no menu-item primitive; a definition list keeps field names accessible. */}
            <dl className="flex min-w-0 flex-1 select-text flex-col gap-1 px-2 py-2 font-mono text-xs">
              <div className="min-w-0">
                <dt className="sr-only">Working directory</dt>
                <dd className="break-all">{session?.cwd}</dd>
              </div>
              <div className="min-w-0">
                <dt className="sr-only">Session ID</dt>
                <dd className="break-all text-muted-foreground">{sessionId ?? "Not available"}</dd>
              </div>
            </dl>
            <DropdownMenuItem className="-mt-1 size-11 shrink-0 justify-center md:-mt-1.5" aria-label="Copy all" title="Copy all" onSelect={() => { void copyAllSessionDetails(state); }}><CopyIcon /></DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem disabled={!workspace || session?.state.checkoutMissing} onSelect={openChanges}><FileDiffIcon /> Changes</DropdownMenuItem>
            <DropdownMenuItem disabled={!target} onSelect={openPullRequest}><GitPullRequestIcon /> Pull request</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {/* Inline rather than a submenu: the menu is nearly full width on phones, leaving a submenu no room. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>Display</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={display} onValueChange={value => { if (value === "everything" || value === "messages") setDisplay(value); }}>
              {SESSION_DISPLAYS.map(({ value, label }) => <DropdownMenuRadioItem key={value} value={value}>{value === "messages" ? <MessageSquareIcon /> : <ListIcon />} {label}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  </>;
}

/** A worktree's directory without the `folder.` prefix Worktrunk gives it, since the folder is named beside it. */
function worktreeName(folder: string, path: string) {
  const base = path.split("/").pop() ?? path;
  return base.startsWith(`${folder}.`) ? base.slice(folder.length + 1) : base;
}
