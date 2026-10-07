import { useEffect, useMemo, useState } from "react";
import { ArchiveIcon, CopyIcon, GitBranchIcon, MonitorIcon, MoonIcon, PanelLeftIcon, PencilIcon, PlusIcon, SunIcon, Trash2Icon } from "lucide-react";
import { useTheme } from "next-themes";
import type { AppState } from "@/store";
import type { ClientCommand } from "@shared/wire";
import { copyAllSessionDetails, copySessionValue, currentSessionDetails, useSessionActions } from "@/components/SessionActions";
import { cn } from "cn";
import { MatchText } from "@/components/MatchText";
import { commandMatch } from "@/lib/commandMatch";
import { abbrevPath } from "@/lib/format";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";

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
  const [search, setSearch] = useState("");
  useEffect(() => { if (!open) setSearch(""); }, [open]);
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
      <CommandList className="max-h-[min(24rem,60dvh)]">
        <CommandEmpty>No sessions or commands match.</CommandEmpty>
        {sessions.length > 0 && (
          <CommandGroup heading={search.trim() ? "Sessions" : "Recent sessions"}>
            {visibleSessions.map((t) => {
              const selected = current?.cwd === t.cwd && current.sessionId === t.sessionId && state.view.kind === "session";
              const title = t.title || "Untitled";
              const fields = [title, t.project, t.branch ?? "", t.sessionId];
              const value = fields.join(" ");
              const match = commandMatch(value, search);
              let offset = 0;
              const hits = fields.map(field => {
                const indices = match.indices.filter(i => i >= offset && i < offset + field.length).map(i => i - offset);
                offset += field.length + 1;
                return indices;
              });
              return (
                <CommandItem
                  key={`${t.cwd}\n${t.sessionId}`}
                  value={value}
                  onSelect={() => run(() => select(t.cwd, t.sessionId))}
                  className="gap-3"
                >
                  <span className={cn("min-w-0 flex-1 truncate", !t.title && "text-ink-3", selected && "font-medium")}><MatchText text={title} indices={hits[0]} /></span>
                  <span className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-2 text-xs text-ink-3">
                    <span className="truncate"><MatchText text={t.project} indices={hits[1]} /></span>
                    {t.branch && (t.inWorktree || hits[2].length > 0) && (
                      <span className="flex min-w-0 items-center gap-1 truncate font-mono">
                        <GitBranchIcon className="size-3 shrink-0" aria-hidden />
                        <span className="truncate"><MatchText text={t.branch} indices={hits[2]} /></span>
                      </span>
                    )}
                    {hits[3].length > 0 && <span className="truncate font-mono"><MatchText text={t.sessionId} indices={hits[3]} /></span>}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        <CommandSeparator />
        <CommandGroup heading="Global commands">
          <CommandItem value="new session" onSelect={() => run(() => openNew())}>
            <PlusIcon /> <MatchText text="New session" search={search} />
          </CommandItem>
          <CommandItem value="toggle sidebar" onSelect={() => run(toggleSidebar)}>
            <PanelLeftIcon /> <MatchText text="Toggle sidebar" search={search} />
          </CommandItem>
          <CommandItem value="appearance light" keywords={["theme"]} onSelect={() => run(() => setTheme("light"))}><SunIcon /> <MatchText text="Light appearance" search={search} /></CommandItem>
          <CommandItem value="appearance dark" keywords={["theme"]} onSelect={() => run(() => setTheme("dark"))}><MoonIcon /> <MatchText text="Dark appearance" search={search} /></CommandItem>
          <CommandItem value="appearance system" keywords={["theme"]} onSelect={() => run(() => setTheme("system"))}><MonitorIcon /> <MatchText text="System appearance" search={search} /></CommandItem>
        </CommandGroup>
        {state.view.kind === "session" && state.session && <>
          <CommandSeparator />
          <CommandGroup heading="Session commands">
            <CommandItem value="Copy working directory" onSelect={() => run(() => { if (state.session) void copySessionValue(state.session.cwd, "Working directory"); })}><CopyIcon /> <MatchText text="Copy working directory" search={search} /></CommandItem>
            {details.branch && <CommandItem value="Copy git branch" onSelect={() => run(() => { if (details.branch) void copySessionValue(details.branch, "Git branch"); })}><CopyIcon /> <MatchText text="Copy git branch" search={search} /></CommandItem>}
            <CommandItem value="Copy session ID" disabled={!details.sessionId} onSelect={() => run(() => { if (details.sessionId) void copySessionValue(details.sessionId, "Session ID"); })}><CopyIcon /> <MatchText text="Copy session ID" search={search} /></CommandItem>
            <CommandItem value="Copy all" onSelect={() => run(() => { void copyAllSessionDetails(state); })}><CopyIcon /> <MatchText text="Copy all" search={search} /></CommandItem>
            <CommandItem value="Rename" disabled={!ready || !target || state.session?.state.checkoutMissing} onSelect={() => run(() => { if (target) actions.rename(target); })}><PencilIcon /> <MatchText text="Rename" search={search} /></CommandItem>
            <CommandItem value="Archive" disabled={!ready || !target} onSelect={() => run(() => { if (target) actions.archive(target); })}><ArchiveIcon /> <MatchText text="Archive" search={search} /></CommandItem>
            <CommandItem value="Delete" disabled={!ready || !target} onSelect={() => run(() => { if (target) actions.delete(target); })}><Trash2Icon /> <MatchText text="Delete" search={search} /></CommandItem>
            <CommandItem value="new session here" disabled={state.session.state.checkoutMissing} keywords={["new", "here", "directory"]} onSelect={() => run(() => { if (state.session) openNew(state.session.cwd); })}>
              <PlusIcon /> <span className="shrink-0"><MatchText text="New session here" search={search} /></span> <span className="min-w-0 truncate font-mono text-xs text-ink-3">{abbrevPath(state.session.cwd)}</span>
            </CommandItem>
          </CommandGroup>
        </>}
      </CommandList>
    </CommandDialog>
    {actions.dialogs}
    </>
  );
}
