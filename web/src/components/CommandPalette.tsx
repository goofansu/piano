import type { ClientCommand } from "@shared/wire";
import { cn } from "cn";
import { ArrowUpDownIcon, CheckIcon, HomeIcon, LayoutListIcon, MonitorIcon, MoonIcon, PanelLeftIcon, PlugIcon, PlusIcon, RadiusIcon, SettingsIcon, ShieldCheckIcon, ShieldOffIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { BranchLabel } from "@/components/BranchLabel";
import { RankedCommandGroups } from "@/components/RankedCommandGroups";
import { CommandIcon, useSessionCommands } from "@/components/SessionCommandHost";
import type { SettingsSection } from "@/components/SettingsPage";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { abbrevPath } from "@/lib/format";
import { directoryTrust, sessionProject } from "@/lib/sessionContext";
import { GROUP_BY, SORT_BY } from "@/lib/sidebarView";
import { useSidebarView } from "@/lib/useSidebarView";
import type { AppState } from "@/store";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: AppState;
  select: (cwd: string, sessionId: string | null) => void;
  openNew: (cwd?: string) => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings?: () => void;
  toggleSidebar: () => void;
  send: (command: ClientCommand) => void;
  /** The New session composer's directory, while that page is open. */
  composerCwd?: string;
}

/**
 * The command palette: session navigation/actions, new sessions, and view commands.
 * Search matches a session's title, its directory, its branch and its project.
 */
export function CommandPalette({ open, onOpenChange, state, select, openNew, openSettings, closeSettings, toggleSidebar, send, composerCwd }: Props) {
  const { setTheme } = useTheme();
  const { view, setView } = useSidebarView();
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
  // The session header's and sidebar row menu's commands, by the same names, for the selected session.
  const { commands: sessionCommandList, run: runCommand } = useSessionCommands();
  const sessions = useMemo(() => {
    const visible = state.folders.flatMap(p => p.sessions.map(t => ({ ...t, folder: p.name, inWorktree: !p.worktrees.some(w => w.root && w.path === t.cwd) })));
    // Sessions whose directory was closed still belong to their project; they are reachable here by name. Archived ones are not.
    return [...visible, ...state.sessionReferences.filter(s => !s.archived && !visible.some(t => t.cwd === s.cwd && t.sessionId === s.sessionId)).map(s => ({ ...s, folder: s.cwd.split("/").pop() ?? s.cwd, branch: "", inWorktree: false, createdAt: "" }))]
      .map(t => ({ ...t, project: sessionProject(state, t)?.name ?? "" }))
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  }, [state.folders, state.sessionReferences, state.projects]);
  const composerTrust = composerCwd ? directoryTrust(state, composerCwd) : undefined;
  const visibleSessions = search.trim() ? sessions : sessions.slice(0, 8);
  const run = (action: () => void) => { onOpenChange(false); action(); };

  return (
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
                  value={`${t.title || "Untitled"} ${t.folder} ${t.branch ?? ""} ${t.project} ${t.sessionId}`}
                  keywords={[t.folder, t.branch ?? "", t.project]}
                  onSelect={() => run(() => select(t.cwd, t.sessionId))}
                  className="gap-3"
                >
                  <span className={cn("min-w-0 flex-1 truncate", !t.title && "text-ink-3", selected && "font-medium")}>{t.title || "Untitled"}</span>
                  <span className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-2 text-xs text-ink-3">
                    <span className="truncate">{t.folder}</span>
                    {t.branch && t.inWorktree && <BranchLabel branch={t.branch} />}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        <CommandGroup key="global" heading="Global commands">
          {closeSettings ? <CommandItem value="Home" keywords={["back", "session"]} onSelect={() => run(closeSettings)}>
            <HomeIcon /> Home
          </CommandItem> : <CommandItem value="Settings" onSelect={() => run(openSettings)}>
            <SettingsIcon /> Settings
          </CommandItem>}
          <CommandItem value="Providers" keywords={["settings", "oauth", "sign in"]} onSelect={() => run(() => openSettings("providers"))}>
            <PlugIcon /> Providers
          </CommandItem>
          <CommandItem value="Radius" keywords={["settings", "setup", "oauth", "mcp", "web search"]} onSelect={() => run(() => openSettings("radius"))}>
            <RadiusIcon /> Radius
          </CommandItem>
          <CommandItem value="new session" onSelect={() => run(() => openNew())}>
            <PlusIcon /> New session
          </CommandItem>
          {composerCwd && composerTrust?.required && (
            <CommandItem value={composerTrust.trusted ? "Untrust folder" : "Trust folder"} keywords={["trust", "pi settings", "skills"]} disabled={!state.connected}
              onSelect={() => run(() => send({ _tag: "set_trust", path: composerCwd, trusted: !composerTrust.trusted }))}>
              {composerTrust.trusted ? <><ShieldOffIcon /> Untrust folder</> : <><ShieldCheckIcon /> Trust folder</>}
            </CommandItem>
          )}
          <CommandItem value="toggle sidebar" onSelect={() => run(toggleSidebar)}>
            <PanelLeftIcon /> Toggle sidebar
          </CommandItem>
          <CommandItem value="appearance light" keywords={["theme"]} onSelect={() => run(() => setTheme("light"))}><SunIcon /> Light appearance</CommandItem>
          <CommandItem value="appearance dark" keywords={["theme"]} onSelect={() => run(() => setTheme("dark"))}><MoonIcon /> Dark appearance</CommandItem>
          <CommandItem value="appearance system" keywords={["theme"]} onSelect={() => run(() => setTheme("system"))}><MonitorIcon /> System appearance</CommandItem>
          {/* The sidebar's view menu, by the same names. */}
          {GROUP_BY.map(g => (
            <CommandItem key={`group-${g.value}`} value={g.value === "none" ? "No grouping" : `Group by ${g.label.toLowerCase()}`} keywords={["group", "sidebar", "view"]} onSelect={() => run(() => setView({ groupBy: g.value }))}>
              <LayoutListIcon /> {g.value === "none" ? "No grouping" : `Group by ${g.label.toLowerCase()}`}
              {view.groupBy === g.value && <><CheckIcon className="ml-auto" aria-hidden /><span className="sr-only">current</span></>}
            </CommandItem>
          ))}
          {SORT_BY.map(s => (
            <CommandItem key={`sort-${s.value}`} value={`Sort by ${s.label.toLowerCase()}`} keywords={["sort", "order", "sidebar", "view"]} onSelect={() => run(() => setView({ sortBy: s.value }))}>
              <ArrowUpDownIcon /> Sort by {s.label.toLowerCase()}
              {view.sortBy === s.value && <><CheckIcon className="ml-auto" aria-hidden /><span className="sr-only">current</span></>}
            </CommandItem>
          ))}
        </CommandGroup>
        {state.view.kind === "session" && state.session && (
          <CommandGroup key="session" heading="Session commands">
            {sessionCommandList.map(c => (
              <CommandItem key={c.id} value={c.label} keywords={c.keywords ? [...c.keywords] : undefined} disabled={!c.enabled} onSelect={() => run(() => runCommand(c))}>
                <CommandIcon icon={c.icon} />{" "}
                {c.detail ? <><span className="shrink-0">{c.label}</span> <span className="min-w-0 truncate font-mono text-xs text-ink-3">{abbrevPath(c.detail)}</span></> : c.label}
                {c.checked && <><CheckIcon className="ml-auto" aria-hidden /><span className="sr-only">current</span></>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        </RankedCommandGroups>
      </CommandList>
    </CommandDialog>
  );
}
