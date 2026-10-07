import { useMemo } from "react";
import { ArchiveIcon, CopyIcon, GitBranchIcon, MonitorIcon, MoonIcon, PanelLeftIcon, PencilIcon, PlusIcon, SquarePenIcon, SunIcon, Trash2Icon } from "lucide-react";
import { useTheme } from "next-themes";
import type { AppState } from "@/store";
import type { ClientCommand } from "@shared/wire";
import { copySessionValue, currentSessionDetails, useSessionActions } from "@/components/SessionActions";
import { sessionKey } from "@/store";
import { cn } from "cn";
import { abbrevPath } from "@/lib/format";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Keys } from "@/components/PianoMark";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: AppState;
  select: (cwd: string, sessionId: string | null) => void;
  openNew: (cwd?: string) => void;
  toggleSidebar: () => void;
  send: (command: ClientCommand) => void;
}

/**
 * The command palette: session navigation/actions, new sessions, and view commands.
 * Search matches a session's title, its project and its branch.
 */
export function CommandPalette({ open, onOpenChange, state, select, openNew, toggleSidebar, send }: Props) {
  const { setTheme } = useTheme();
  const current = state.session ?? state.selecting;
  const details = currentSessionDetails(state);
  const ready = state.connected && !state.resync && !state.selecting && state.selectionId !== null;
  const actions = useSessionActions(send, ready);
  const target = state.session?.sessionId ? { cwd: state.session.cwd, sessionId: state.session.sessionId, title: details.title } : undefined;
  const sessions = useMemo(() => state.projects.flatMap((p) => p.sessions.map((t) => ({
    ...t,
    project: p.name,
    inWorktree: !p.worktrees.some((w) => w.root && w.path === t.cwd),
    host: state.hosts.find((h) => h.cwd === t.cwd && h.sessionId === t.sessionId),
    done: state.done.includes(sessionKey(t)),
  }))), [state.projects, state.hosts, state.done]);
  const run = (action: () => void) => { onOpenChange(false); action(); };

  return (
    <>
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search and commands" description="Switch sessions, start a new one, or change the view." showCloseButton={false} className="top-[18%] translate-y-0 sm:max-w-xl">
      <CommandInput placeholder="Search sessions, projects, branches…" aria-label="Search sessions and commands" />
      <CommandList className="max-h-[min(24rem,60dvh)]">
        <CommandEmpty>Nothing matches. Try a session title, a project or a branch.</CommandEmpty>
        {sessions.length > 0 && (
          <CommandGroup heading="Sessions">
            {sessions.map((t) => {
              const selected = current?.cwd === t.cwd && current.sessionId === t.sessionId && state.view.kind === "session";
              return (
                <CommandItem
                  key={`${t.cwd}\n${t.sessionId}`}
                  value={`${t.title || "Untitled"} ${t.project} ${t.branch ?? ""} ${t.sessionId}`}
                  keywords={[t.project, t.branch ?? ""]}
                  onSelect={() => run(() => select(t.cwd, t.sessionId))}
                  className="gap-3"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
                    {t.host?.streaming ? <Keys playing className="text-brand" /> : t.done ? <span className="size-2 rounded-full bg-done" /> : t.host ? <span className="size-2 rounded-full border border-ok" /> : null}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate", !t.title && "text-ink-3", selected && "font-medium")}>{t.title || "Untitled"}</span>
                  <span className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-2 text-xs text-ink-3">
                    <span className="truncate">{t.project}</span>
                    {t.branch && t.inWorktree && (
                      <span className="flex min-w-0 items-center gap-1 truncate font-mono">
                        <GitBranchIcon className="size-3 shrink-0" aria-hidden />
                        <span className="truncate">{t.branch}</span>
                      </span>
                    )}
                  </span>
                  {t.host?.streaming && <span className="sr-only">working</span>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        <CommandSeparator />
        {state.view.kind === "session" && state.session && <>
          <CommandGroup heading="Session actions">
            <CommandItem value="Copy working directory" onSelect={() => run(() => { if (state.session) void copySessionValue(state.session.cwd, "Working directory"); })}><CopyIcon /> Copy working directory</CommandItem>
            {details.branch && <CommandItem value="Copy git branch" onSelect={() => run(() => { if (details.branch) void copySessionValue(details.branch, "Git branch"); })}><CopyIcon /> Copy git branch</CommandItem>}
            <CommandItem value="Copy session file path" disabled={!details.sessionFile} onSelect={() => run(() => { if (details.sessionFile) void copySessionValue(details.sessionFile, "Session file path"); })}><CopyIcon /> Copy session file path</CommandItem>
            <CommandItem value="Rename" disabled={!ready || !target} onSelect={() => run(() => { if (target) actions.rename(target); })}><PencilIcon /> Rename</CommandItem>
            <CommandItem value="Archive" disabled={!ready || !target} onSelect={() => run(() => { if (target) actions.archive(target); })}><ArchiveIcon /> Archive</CommandItem>
            <CommandItem value="Delete" disabled={!ready || !target} onSelect={() => run(() => { if (target) actions.delete(target); })}><Trash2Icon /> Delete</CommandItem>
          </CommandGroup>
          <CommandSeparator />
        </>}
        <CommandGroup heading="New session">
          <CommandItem value="new session" onSelect={() => run(() => openNew())}>
            <PlusIcon /> New session
          </CommandItem>
          {state.view.kind === "session" && current && (
            <CommandItem value="new session here" keywords={["new", "here", "directory"]} onSelect={() => run(() => openNew(current.cwd))}>
              <SquarePenIcon /> <span className="shrink-0">New session here</span> <span className="min-w-0 truncate font-mono text-xs text-ink-3">{abbrevPath(current.cwd)}</span>
            </CommandItem>
          )}
          {state.projects.map((p) => (
            <CommandItem key={p.path} value={`new session in ${p.name}`} keywords={["new", p.name]} onSelect={() => run(() => openNew(p.path))}>
              <PlusIcon /> New session in <span className="font-medium">{p.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="View">
          <CommandItem value="toggle sidebar" onSelect={() => run(toggleSidebar)}>
            <PanelLeftIcon /> Toggle sidebar
          </CommandItem>
          <CommandItem value="appearance light" keywords={["theme"]} onSelect={() => run(() => setTheme("light"))}><SunIcon /> Light appearance</CommandItem>
          <CommandItem value="appearance dark" keywords={["theme"]} onSelect={() => run(() => setTheme("dark"))}><MoonIcon /> Dark appearance</CommandItem>
          <CommandItem value="appearance system" keywords={["theme"]} onSelect={() => run(() => setTheme("system"))}><MonitorIcon /> System appearance</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
    {actions.dialogs}
    </>
  );
}
