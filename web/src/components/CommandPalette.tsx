import { useEffect, useMemo, useRef, useState } from "react";
import { ArchiveIcon, CopyIcon, FileDiffIcon, GitBranchIcon, GitPullRequestIcon, MonitorIcon, MoonIcon, PanelLeftIcon, PencilIcon, PlusIcon, SunIcon, Trash2Icon } from "lucide-react";
import { useTheme } from "next-themes";
import type { AppState } from "@/store";
import type { ClientCommand } from "@shared/wire";
import { copyAllSessionDetails, copySessionValue, currentSessionDetails, sessionWorkspace, useSessionActions } from "@/components/SessionActions";
import { cn } from "cn";
import { RankedCommandGroups } from "@/components/RankedCommandGroups";
import { abbrevPath } from "@/lib/format";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: AppState;
  select: (cwd: string, sessionId: string | null) => void;
  openNew: (cwd?: string) => void;
  toggleSidebar: () => void;
  send: (command: ClientCommand) => void;
  openChanges: () => void;
  openPullRequest: () => void;
}

/**
 * The command palette: session navigation/actions, new sessions, and view commands.
 * Search matches a session's title, its project and its branch.
 */
export function CommandPalette({ open, onOpenChange, state, select, openNew, toggleSidebar, send, openChanges, openPullRequest }: Props) {
  const { setTheme } = useTheme();
  const [search, setSearch] = useState("");
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) setSearch(""); }, [open]);
  useEffect(() => {
    if (!open) return;
    // Wait for cmdk's selection and ranked group layout before resetting each search.
    const frame = requestAnimationFrame(() => list.current?.scrollTo({ top: 0, behavior: "instant" }));
    return () => cancelAnimationFrame(frame);
  }, [open, search]);
  const current = state.session ?? state.selecting;
  const details = currentSessionDetails(state);
  const ready = state.connected && !state.resync && !state.selecting && state.selectionId !== null;
  const actions = useSessionActions(send, ready);
  const target = state.session?.sessionId ? { cwd: state.session.cwd, sessionId: state.session.sessionId, title: details.title } : undefined;
  const sessions = useMemo(() => state.projects.flatMap((p) => p.sessions.map((t) => ({
    ...t,
    project: p.name,
    inWorktree: !p.worktrees.some((w) => w.root && w.path === t.cwd),
  }))).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [state.projects]);
  const visibleSessions = search.trim() ? sessions : sessions.slice(0, 8);
  const run = (action: () => void) => { onOpenChange(false); action(); };

  return (
    <>
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search and commands" description="Switch sessions, start a new one, or change the view." showCloseButton={false} className="top-[18%] translate-y-0 sm:max-w-xl">
      <CommandInput value={search} onValueChange={setSearch} placeholder="Search sessions and commands…" aria-label="Search sessions and commands" />
      <CommandList ref={list} className="max-h-[min(24rem,60dvh)]">
        <CommandEmpty>No sessions or commands match.</CommandEmpty>
        <RankedCommandGroups search={search}>
        {sessions.length > 0 && (
          <CommandGroup key="sessions" heading={search.trim() ? "Sessions" : "Recent sessions"}>
            {visibleSessions.map((t) => {
              const selected = current?.cwd === t.cwd && current.sessionId === t.sessionId && state.view.kind === "session";
              return (
                <CommandItem
                  key={`${t.cwd}\n${t.sessionId}`}
                  value={`${t.title || "Untitled"} ${t.project} ${t.branch ?? ""} ${t.sessionId}`}
                  keywords={[t.project, t.branch ?? ""]}
                  onSelect={() => run(() => select(t.cwd, t.sessionId))}
                  className="gap-3"
                >
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
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        <CommandGroup key="global" heading="Global commands">
          <CommandItem value="new session" onSelect={() => run(() => openNew())}>
            <PlusIcon /> New session
          </CommandItem>
          <CommandItem value="toggle sidebar" onSelect={() => run(toggleSidebar)}>
            <PanelLeftIcon /> Toggle sidebar
          </CommandItem>
          <CommandItem value="appearance light" keywords={["theme"]} onSelect={() => run(() => setTheme("light"))}><SunIcon /> Light appearance</CommandItem>
          <CommandItem value="appearance dark" keywords={["theme"]} onSelect={() => run(() => setTheme("dark"))}><MoonIcon /> Dark appearance</CommandItem>
          <CommandItem value="appearance system" keywords={["theme"]} onSelect={() => run(() => setTheme("system"))}><MonitorIcon /> System appearance</CommandItem>
        </CommandGroup>
        {state.view.kind === "session" && state.session && (
          <CommandGroup key="session" heading="Session commands">
            <CommandItem value="Copy working directory" onSelect={() => run(() => { if (state.session) void copySessionValue(state.session.cwd, "Working directory"); })}><CopyIcon /> Copy working directory</CommandItem>
            {details.branch && <CommandItem value="Copy git branch" onSelect={() => run(() => { if (details.branch) void copySessionValue(details.branch, "Git branch"); })}><CopyIcon /> Copy git branch</CommandItem>}
            <CommandItem value="Copy session ID" disabled={!details.sessionId} onSelect={() => run(() => { if (details.sessionId) void copySessionValue(details.sessionId, "Session ID"); })}><CopyIcon /> Copy session ID</CommandItem>
            <CommandItem value="Copy all" onSelect={() => run(() => { void copyAllSessionDetails(state); })}><CopyIcon /> Copy all</CommandItem>
            <CommandItem value="Changes" keywords={["diff", "review", "working tree"]} disabled={!sessionWorkspace(state) || state.session?.state.checkoutMissing} onSelect={() => run(openChanges)}><FileDiffIcon /> Changes</CommandItem>
            <CommandItem value="Pull request" keywords={["github", "link", "pr"]} disabled={!target} onSelect={() => run(openPullRequest)}><GitPullRequestIcon /> Pull request</CommandItem>
            <CommandItem value="Rename" disabled={!ready || !target || state.session?.state.checkoutMissing} onSelect={() => run(() => { if (target) actions.rename(target); })}><PencilIcon /> Rename</CommandItem>
            <CommandItem value="Archive" disabled={!ready || !target} onSelect={() => run(() => { if (target) actions.archive(target); })}><ArchiveIcon /> Archive</CommandItem>
            <CommandItem value="Delete" disabled={!ready || !target} onSelect={() => run(() => { if (target) actions.delete(target); })}><Trash2Icon /> Delete</CommandItem>
            <CommandItem value="new session here" disabled={state.session.state.checkoutMissing} keywords={["new", "here", "directory"]} onSelect={() => run(() => { if (state.session) openNew(state.session.cwd); })}>
              <PlusIcon /> <span className="shrink-0">New session here</span> <span className="min-w-0 truncate font-mono text-xs text-ink-3">{abbrevPath(state.session.cwd)}</span>
            </CommandItem>
          </CommandGroup>
        )}
        </RankedCommandGroups>
      </CommandList>
    </CommandDialog>
    {actions.dialogs}
    </>
  );
}
