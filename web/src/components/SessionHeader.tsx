import { ArchiveIcon, CopyIcon, MoreHorizontalIcon, PanelLeftOpenIcon, TextCursorInputIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { ClientCommand } from "@shared/wire";
import type { AppState } from "@/store";
import { abbrevPath } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { copySessionValue, currentSessionDetails, useSessionActions } from "@/components/SessionActions";

export function SessionHeader({ state, send, onMenu, openNew, status }: {
  state: AppState; send: (command: ClientCommand) => void; onMenu: () => void; openNew: (cwd?: string) => void; status: string;
}) {
  const session = state.session;
  const { title, branch, sessionId } = currentSessionDetails(state);
  const ready = state.connected && !state.resync && !state.selecting && state.selectionId !== null;
  const actions = useSessionActions(send, ready);
  const target = session?.sessionId ? { cwd: session.cwd, sessionId: session.sessionId, title } : undefined;
  const short = session ? abbrevPath(session.cwd) : "";
  const slash = short.lastIndexOf("/");
  return <>
    {/* Outside the transcript scroller: stays visible without an overlay or scroll listener. */}
    <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3 md:px-6">
      <Button variant="ghost" size="icon-sm" className="-ml-2 md:hidden" aria-label="Show sidebar" onClick={onMenu}><PanelLeftOpenIcon /></Button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {session ? <>
          <h1 className="truncate text-sm font-medium" title={title}>{title}</h1>
          <p aria-label="Working directory" title={session.cwd} className="flex min-w-0 font-mono text-xs text-muted-foreground">
            {slash >= 0 && <span dir="rtl" className="min-w-0 shrink-[999] truncate"><span dir="ltr">{short.slice(0, slash + 1)}</span></span>}
            <span className="min-w-0 truncate">{short.slice(slash + 1)}</span>
          </p>
        </> : <><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-28" /></>}
      </div>
      <span role="status" className="sr-only">{status}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="New session here" disabled={!session || session.state.checkoutMissing} onClick={() => { if (session) openNew(session.cwd); }}><PlusIcon /></Button>
        </TooltipTrigger>
        <TooltipContent>New session here</TooltipContent>
      </Tooltip>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Session information and actions" disabled={!session}><MoreHorizontalIcon /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" collisionPadding={16} className="w-80 max-w-[calc(100vw-2rem)]">
          <DropdownMenuGroup>
            <DropdownMenuItem aria-label="Copy working directory" onSelect={event => { event.preventDefault(); if (session) void copySessionValue(session.cwd, "Working directory"); }}>
              <span className="flex min-w-0 flex-1 flex-col gap-1"><span>Working directory</span><span className="break-all font-mono text-xs text-muted-foreground">{session?.cwd}</span></span><CopyIcon />
            </DropdownMenuItem>
            {branch && <DropdownMenuItem aria-label="Copy git branch" onSelect={event => { event.preventDefault(); void copySessionValue(branch, "Git branch"); }}>
              <span className="flex min-w-0 flex-1 flex-col gap-1"><span>Git branch</span><span className="break-all font-mono text-xs text-muted-foreground">{branch}</span></span><CopyIcon />
            </DropdownMenuItem>}
            <DropdownMenuItem aria-label="Copy session ID" disabled={!sessionId} onSelect={event => { event.preventDefault(); if (sessionId) void copySessionValue(sessionId, "Session ID"); }}>
              <span className="flex min-w-0 flex-1 flex-col gap-1"><span>Session ID</span><span className="break-all font-mono text-xs text-muted-foreground">{sessionId ?? "Not available"}</span></span><CopyIcon />
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem disabled={!ready || !target || session?.state.checkoutMissing} onSelect={() => target && actions.rename(target)}><TextCursorInputIcon /> Rename</DropdownMenuItem>
            <DropdownMenuItem disabled={!ready || !target} onSelect={() => target && actions.archive(target)}><ArchiveIcon /> Archive</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup><DropdownMenuItem variant="destructive" disabled={!ready || !target} onSelect={() => target && actions.delete(target)}><Trash2Icon /> Delete</DropdownMenuItem></DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
    {actions.dialogs}
  </>;
}
