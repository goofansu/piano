import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { BranchLabel } from "@/components/BranchLabel";
import { CommandIcon, useGlobalCommands, useSessionCommands } from "@/components/CommandHost";
import { GlobalCommandIcon } from "@/components/GlobalCommandIcon";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/PianoCommand";
import { commandPalette, paletteFilter } from "@/lib/commandPalette";
import { abbrevPath } from "@/lib/format";
import { hasMod } from "@/lib/keys";
import { openLink } from "@/lib/sessionLinks";
import { useNavigation } from "@/lib/useNavigation";
import type { AppState } from "@/store";

interface Props {
  state: AppState;
}

function Current() {
  return (
    <>
      <CheckIcon className="ml-auto" aria-hidden />
      <span className="sr-only">current</span>
    </>
  );
}

/**
 * The command palette: session navigation/actions, new sessions, and view commands. Its groups and
 * rows come from `commandPalette`; this renders them and runs what is chosen.
 */
export function CommandPalette({ state }: Props) {
  const { palette: open, setPalette: onOpenChange, select, openPanel } = useNavigation();
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
  // The View menu's and the session header's commands, by the same names; the host runs them all.
  const { commands: globalCommandList, run: runCommand } = useGlobalCommands();
  const { commands: sessionCommandList } = useSessionCommands();
  const groups = commandPalette(state, {
    search,
    globalCommands: globalCommandList,
    sessionCommands: sessionCommandList,
  });
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
      filter={paletteFilter}
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
        {groups.map((group, index) => (
          <Fragment key={group.id}>
            {index > 0 && <CommandSeparator />}
            <CommandGroup heading={group.heading}>
              {group.id === "sessions"
                ? group.rows.map((r) => (
                    <CommandItem
                      key={r.key}
                      value={r.value}
                      keywords={r.keywords}
                      onSelect={() => run(() => select(r.session.cwd, r.session.sessionId))}
                      className="gap-3"
                    >
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate",
                          r.untitled && "text-ink-3",
                          r.selected && "font-medium",
                        )}
                      >
                        {r.label}
                      </span>
                      <span className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-2 text-xs text-ink-3">
                        <span className="truncate">{r.folder}</span>
                        {r.branch && <BranchLabel branch={r.branch} />}
                      </span>
                    </CommandItem>
                  ))
                : group.id === "global"
                  ? group.rows.map((r) => (
                      <CommandItem
                        key={r.key}
                        value={r.value}
                        keywords={r.keywords}
                        disabled={!r.enabled}
                        onSelect={() => run(() => runCommand(r.command))}
                      >
                        <GlobalCommandIcon icon={r.command.icon} /> {r.label}
                        {r.checked && <Current />}
                      </CommandItem>
                    ))
                  : group.id === "files"
                    ? group.rows.map((r) => (
                        <CommandItem
                          key={r.key}
                          value={r.value}
                          keywords={r.keywords}
                          onSelect={() => run(() => openPanel({ kind: "file", path: r.file.path }))}
                          className="gap-3 font-mono text-xs"
                        >
                          <span className="min-w-0 shrink-0 truncate">{r.name}</span>
                          {r.dir && (
                            <span className="min-w-0 flex-1 truncate text-ink-3">{r.dir}</span>
                          )}
                        </CommandItem>
                      ))
                    : group.id === "links"
                      ? group.rows.map((r) => (
                          <CommandItem
                            key={r.key}
                            value={r.value}
                            keywords={r.keywords}
                            onSelect={() => run(() => openLink(r.link.url))}
                            className="gap-3"
                          >
                            {r.link.label ? (
                              <>
                                <span className="min-w-0 max-w-[45%] shrink-0 truncate">
                                  {r.link.label}
                                </span>
                                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-3">
                                  {r.display}
                                </span>
                              </>
                            ) : (
                              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                                {r.display}
                              </span>
                            )}
                          </CommandItem>
                        ))
                      : group.rows.map((r) => (
                          <CommandItem
                            key={r.key}
                            value={r.value}
                            keywords={r.keywords}
                            disabled={!r.enabled}
                            onSelect={() => run(() => runCommand(r.command))}
                          >
                            <CommandIcon icon={r.command.icon} />{" "}
                            {r.detail ? (
                              <>
                                <span className="shrink-0">{r.label}</span>{" "}
                                <span className="min-w-0 truncate font-mono text-xs text-ink-3">
                                  {abbrevPath(r.detail)}
                                </span>
                              </>
                            ) : (
                              r.label
                            )}
                            {r.checked && <Current />}
                          </CommandItem>
                        ))}
            </CommandGroup>
          </Fragment>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
