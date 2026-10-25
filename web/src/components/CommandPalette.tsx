import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import {
  Fragment,
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { BranchLabel } from "@/components/BranchLabel";
import {
  CommandIcon,
  useGlobalCommands,
  useSessionCommands,
  useSessionProjectMenu,
} from "@/components/CommandHost";
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
import { ProjectCommandIconView } from "@/components/Projects";
import { createPaletteCatalog } from "@/lib/commandPalette";
import { abbrevPath } from "@/lib/format";
import { hasMod, isImeKey } from "@/lib/keys";
import { PALETTE_PAGE_SIZE, type PalettePage, paletteSelection } from "@/lib/paletteSearch";
import { openLink } from "@/lib/sessionLinks";
import { useNavigation } from "@/lib/useNavigation";
import { usePaletteSearch } from "@/lib/usePaletteSearch";
import { useSessionFiles } from "@/lib/useSessionFiles";
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
  const { palette: open, setPalette: onOpenChange } = useNavigation();
  const [selected, setSelected] = useState("");
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
  // The expensive contents sit inside the dialog's content, which Radix mounts only while the
  // palette is open, so their catalog and search work stop when it closes.
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search and commands"
      description="Switch sessions, start a new one, or change the view."
      showCloseButton={false}
      commandProps={{ shouldFilter: false, value: selected, onValueChange: setSelected }}
      className="top-[18%] translate-y-0 sm:max-w-xl"
    >
      <PaletteContents
        key={`${state.view.kind}:${state.session?.cwd}:${state.session?.sessionId}`}
        state={state}
        selected={selected}
        setSelected={setSelected}
      />
    </CommandDialog>
  );
}

function PaletteContents({
  state,
  selected,
  setSelected,
}: Props & { selected: string; setSelected: (value: string) => void }) {
  const { palette: open, setPalette: onOpenChange, select, openFile } = useNavigation();
  const [catalog] = useState(createPaletteCatalog);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // The View menu's and the session header's commands, by the same names; the host runs them all.
  const { commands: globalCommandList, run: runCommand } = useGlobalCommands();
  const commandRunner = useRef(runCommand);
  commandRunner.current = runCommand;
  const executeCommand = useCallback(
    (command: Parameters<typeof runCommand>[0]) => commandRunner.current(command),
    [],
  );
  const { commands: sessionCommandList } = useSessionCommands();
  const sessionProject = useSessionProjectMenu();
  const files = useSessionFiles();
  const groups = catalog(state, {
    globalCommands: globalCommandList,
    sessionCommands: sessionCommandList,
    sessionProject,
    files,
  });
  const results = usePaletteSearch(groups, search, editing || !open);
  const pending = editing || results.pending;
  const allowed = useRef(false);
  allowed.current = open && !pending && !results.error;
  const edit = useCallback(() => {
    allowed.current = false;
    setEditing(true);
  }, []);
  const commit = useCallback((query: string) => {
    setSearch(query);
    setEditing(false);
  }, []);
  const settled = useRef(search);
  if (allowed.current) settled.current = search;
  const run = useCallback(
    (action: () => void) => {
      // Check the live input too: a pointer/Enter event must not race the next React commit.
      if (!allowed.current || input.current?.value !== settled.current) return;
      onOpenChange(false);
      action();
    },
    [onOpenChange],
  );
  const changePage = useCallback(
    (group: PalettePage["group"]["id"], page: number) => {
      if (allowed.current && input.current?.value === settled.current) results.page(group, page);
    },
    [results.page],
  );
  const selectionContext = useRef(results.selectionKey);
  useLayoutEffect(() => {
    if (pending) return;
    const reset = selectionContext.current !== results.selectionKey;
    selectionContext.current = results.selectionKey;
    const next = paletteSelection(results.result, selected, reset);
    if (next !== selected) setSelected(next);
    if (reset || next !== selected) list.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [results.result, results.selectionKey, pending, selected, setSelected]);

  return (
    <>
      <PaletteInput input={input} active={open} pending={pending} edit={edit} commit={commit} />
      <CommandList ref={list} aria-busy={pending} className="max-h-[min(24rem,60dvh)]">
        <CommandEmpty>
          {results.error
            ? "Search unavailable. Close and reopen to retry."
            : pending
              ? "Searching…"
              : "No sessions or commands match."}
        </CommandEmpty>
        <PaletteResults
          pages={results.result}
          run={run}
          select={select}
          openFile={openFile}
          runCommand={executeCommand}
          page={changePage}
        />
      </CommandList>
    </>
  );
}

/** Urgent text state lives here, outside the dialog/catalog/results render path. */
const PaletteInput = memo(function PaletteInput({
  input,
  active,
  pending,
  edit,
  commit,
}: {
  input: RefObject<HTMLInputElement | null>;
  active: boolean;
  pending: boolean;
  edit: () => void;
  commit: (query: string) => void;
}) {
  const [text, setText] = useState("");
  const composing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (active) return;
    clearTimeout(timer.current);
    composing.current = false;
    setText("");
    commit("");
  }, [active, commit]);
  const schedule = (value: string) => {
    clearTimeout(timer.current);
    if (composing.current) return;
    if (!value.trim()) commit(value);
    else timer.current = setTimeout(() => commit(value), 80);
  };
  return (
    <CommandInput
      ref={input}
      value={text}
      onValueChange={(value) => {
        setText(value);
        edit();
        schedule(value);
      }}
      onCompositionStart={() => {
        composing.current = true;
        clearTimeout(timer.current);
        edit();
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        schedule(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (pending && ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
          event.preventDefault();
        if (event.key !== "Enter") return;
        if (isImeKey(event) || composing.current || event.repeat) event.preventDefault();
        else if (pending) {
          event.preventDefault();
          clearTimeout(timer.current);
          commit(event.currentTarget.value);
        }
      }}
      placeholder="Search sessions and commands…"
      aria-label="Search sessions and commands"
    />
  );
});

const PaletteResults = memo(function PaletteResults({
  pages,
  run,
  select,
  openFile,
  runCommand,
  page,
}: {
  pages: PalettePage[];
  run: (action: () => void) => void;
  select: ReturnType<typeof useNavigation>["select"];
  openFile: ReturnType<typeof useNavigation>["openFile"];
  runCommand: ReturnType<typeof useGlobalCommands>["run"];
  page: (group: PalettePage["group"]["id"], page: number) => void;
}) {
  return (
    <>
      {pages.map(({ group, page: current, total }, index) => (
        <Fragment key={group.id}>
          {index > 0 && <CommandSeparator />}
          <CommandGroup
            heading={
              total > PALETTE_PAGE_SIZE
                ? `${group.heading} · ${current * PALETTE_PAGE_SIZE + 1}–${Math.min((current + 1) * PALETTE_PAGE_SIZE, total)} of ${total}`
                : group.heading
            }
          >
            {current > 0 && (
              <CommandItem
                value={`${group.id}:previous`}
                onSelect={() => page(group.id, current - 1)}
              >
                Previous {group.heading.toLowerCase()}
              </CommandItem>
            )}
            {group.id === "sessions"
              ? group.rows.map((r) => (
                  <CommandItem
                    key={r.key}
                    value={`${group.id}:${r.key}`}
                    disabled={!r.enabled}
                    title={r.hint}
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
                    {r.hint && <span className="sr-only">{r.hint}</span>}
                  </CommandItem>
                ))
              : group.id === "global"
                ? group.rows.map((r) => (
                    <CommandItem
                      key={r.key}
                      value={`${group.id}:${r.key}`}
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
                        value={`${group.id}:${r.key}`}
                        onSelect={() => run(() => openFile(r.file.path))}
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
                          value={`${group.id}:${r.key}`}
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
                          value={`${group.id}:${r.key}`}
                          disabled={!r.enabled}
                          onSelect={() => run(() => runCommand(r.command))}
                        >
                          {r.kind === "session" ? (
                            <CommandIcon icon={r.command.icon} />
                          ) : (
                            <ProjectCommandIconView icon={r.command.icon} />
                          )}{" "}
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
            {(current + 1) * PALETTE_PAGE_SIZE < total && (
              <CommandItem value={`${group.id}:next`} onSelect={() => page(group.id, current + 1)}>
                Next {group.heading.toLowerCase()}
              </CommandItem>
            )}
          </CommandGroup>
        </Fragment>
      ))}
    </>
  );
});
