import type { ClientCommand } from "@shared/wire";
import { cn } from "cn";
import { ArrowUpDownIcon, CheckIcon, HomeIcon, LayoutListIcon, MonitorIcon, MoonIcon, PanelLeftIcon, PlugIcon, PlusIcon, RadiusIcon, ServerIcon, SettingsIcon, ShieldCheckIcon, ShieldOffIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { BranchLabel } from "@/components/BranchLabel";
import { RankedCommandGroups } from "@/components/RankedCommandGroups";
import { CommandIcon, useSessionCommands } from "@/components/SessionCommandHost";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { abbrevPath } from "@/lib/format";
import { hasMod } from "@/lib/keys";
import { recentSessions } from "@/lib/sessionCatalog";
import { directoryTrust, focusedDirectory } from "@/lib/sessionContext";
import { GROUP_BY, SORT_BY } from "@/lib/sidebarView";
import { useNavigation } from "@/lib/useNavigation";
import { useSidebarView } from "@/lib/useSidebarView";
import type { AppState } from "@/store";

interface Props {
  state: AppState;
  toggleSidebar: () => void;
  send: (command: ClientCommand) => void;
}

/**
 * The command palette: session navigation/actions, new sessions, and view commands.
 * Search matches a session's title, its directory, its branch and its project.
 */
export function CommandPalette({ state, toggleSidebar, send }: Props) {
  const { palette: open, setPalette: onOpenChange, settings, select, openNew, openSettings, closeSettings } = useNavigation();
  // Mod+K, the only global shortcut, toggles the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (hasMod(e) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); onOpenChange(!open); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);
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
  // The session header's and sidebar row menu's commands, by the same names, for the selected session.
  const { commands: sessionCommandList, run: runCommand } = useSessionCommands();
  // Every session that is not archived, including those whose folder was closed: reachable here by name.
  const sessions = useMemo(() => recentSessions(state),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [state.folders, state.sessionReferences, state.projects, state.hosts, state.done, state.session?.cwd, state.session?.sessionId, state.selecting]);
  // Trust belongs to the directory the main pane is about: the New page's, else the selected session's.
  const focus = focusedDirectory(state);
  const focusCwd = focus && !focus.checkoutMissing ? focus.cwd : undefined;
  const focusTrust = focusCwd ? directoryTrust(state, focusCwd) : undefined;
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
              const project = t.project?.name ?? "";
              return (
                <CommandItem
                  key={`${t.cwd}\n${t.sessionId}`}
                  value={`${t.title || "Untitled"} ${t.folder} ${t.branch} ${project} ${t.sessionId}`}
                  keywords={[t.folder, t.branch, project]}
                  onSelect={() => run(() => select(t.cwd, t.sessionId))}
                  className="gap-3"
                >
                  <span className={cn("min-w-0 flex-1 truncate", !t.title && "text-ink-3", t.selected && "font-medium")}>{t.title || "Untitled"}</span>
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
          {settings ? <CommandItem value="Home" keywords={["back", "session"]} onSelect={() => run(closeSettings)}>
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
          <CommandItem value="MCP" keywords={["settings", "servers", "tools", "linear", "install", "sign in"]} onSelect={() => run(() => openSettings("mcp"))}>
            <ServerIcon /> MCP
          </CommandItem>
          <CommandItem value="new session" onSelect={() => run(() => openNew())}>
            <PlusIcon /> New session
          </CommandItem>
          {focusCwd && focusTrust?.required && (
            <CommandItem value={focusTrust.trusted ? "Untrust folder" : "Trust folder"} keywords={["trust", "pi settings", "skills"]} disabled={!state.connected}
              onSelect={() => run(() => send({ _tag: "set_trust", path: focusCwd, trusted: !focusTrust.trusted }))}>
              {focusTrust.trusted ? <><ShieldOffIcon /> Untrust folder</> : <><ShieldCheckIcon /> Trust folder</>}
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
