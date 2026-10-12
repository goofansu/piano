import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BranchLabel } from "@/components/BranchLabel";
import { CommandIcon, useSessionCommands } from "@/components/CommandHost";
import { GlobalCommandIcon } from "@/components/GlobalCommandIcon";
import { RankedCommandGroups } from "@/components/RankedCommandGroups";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { abbrevPath } from "@/lib/format";
import { globalCommands } from "@/lib/globalCommands";
import { hasMod } from "@/lib/keys";
import { recentSessions } from "@/lib/sessionCatalog";
import { useNavigation } from "@/lib/useNavigation";
import { useSidebarView } from "@/lib/useSidebarView";
import type { AppState } from "@/store";

interface Props {
  state: AppState;
}

/**
 * The command palette: session navigation/actions, new sessions, and view commands.
 * Search matches a session's title, its directory, its branch and its project.
 */
export function CommandPalette({ state }: Props) {
  const { palette: open, setPalette: onOpenChange, settings, select } = useNavigation();
  // Mod+K, the only global shortcut, toggles the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (hasMod(e) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);
  const { view } = useSidebarView();
  const [search, setSearch] = useState("");
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: search changes the rendered results; reset their DOM scroll even though the effect does not read the query.
  useEffect(() => {
    if (!open) return;
    // Wait for cmdk's selection and ranked group layout before resetting each search.
    const frame = requestAnimationFrame(() =>
      list.current?.scrollTo({ top: 0, behavior: "instant" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [open, search]);
  // The session header's and sidebar row menu's commands, by the same names, for the selected session;
  // the host runs these and the global commands alike.
  const { commands: sessionCommandList, run: runCommand } = useSessionCommands();
  // Every session that is not archived, including those whose folder was closed: reachable here by name.
  const sessions = useMemo(() => recentSessions(state), [state]);
  // The sidebar's View menu choices by the same names; trust is for the directory the main pane is about.
  const globalCommandList = globalCommands(state, { settingsOpen: !!settings, view });
  const visibleSessions = search.trim() ? sessions : sessions.slice(0, 8);
  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search and commands"
      description="Switch sessions, start a new one, or change the view."
      showCloseButton={false}
      className="top-[18%] translate-y-0 sm:max-w-xl"
    >
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search sessions and commands…"
        aria-label="Search sessions and commands"
      />
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
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        !t.title && "text-ink-3",
                        t.selected && "font-medium",
                      )}
                    >
                      {t.title || "Untitled"}
                    </span>
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
            {globalCommandList.map((c) => (
              <CommandItem
                key={c.id}
                value={c.label}
                keywords={c.keywords ? [...c.keywords] : undefined}
                disabled={!c.enabled}
                onSelect={() => run(() => runCommand(c))}
              >
                <GlobalCommandIcon icon={c.icon} /> {c.label}
                {c.checked && (
                  <>
                    <CheckIcon className="ml-auto" aria-hidden />
                    <span className="sr-only">current</span>
                  </>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
          {state.view.kind === "session" && state.session && (
            <CommandGroup key="session" heading="Session commands">
              {sessionCommandList.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.label}
                  keywords={c.keywords ? [...c.keywords] : undefined}
                  disabled={!c.enabled}
                  onSelect={() => run(() => runCommand(c))}
                >
                  <CommandIcon icon={c.icon} />{" "}
                  {c.detail ? (
                    <>
                      <span className="shrink-0">{c.label}</span>{" "}
                      <span className="min-w-0 truncate font-mono text-xs text-ink-3">
                        {abbrevPath(c.detail)}
                      </span>
                    </>
                  ) : (
                    c.label
                  )}
                  {c.checked && (
                    <>
                      <CheckIcon className="ml-auto" aria-hidden />
                      <span className="sr-only">current</span>
                    </>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </RankedCommandGroups>
      </CommandList>
    </CommandDialog>
  );
}
