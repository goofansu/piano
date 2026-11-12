import { cn } from "cn";
import {
  Fragment,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
import { createPaletteCatalog, PALETTE_NAME, paletteScope } from "@/lib/commandPalette";
import { abbrevPath } from "@/lib/format";
import { hasMod, isImeKey } from "@/lib/keys";
import { PALETTE_PAGE_SIZE, type PalettePage, paletteSelection } from "@/lib/paletteSearch";
import { useNavigation } from "@/lib/useNavigation";
import { usePaletteSearch } from "@/lib/usePaletteSearch";
import type { AppState } from "@/store";

interface Props {
  state: AppState;
}

/** Read for a checked row, whose mark is the stock item's own, shown by `data-checked`. */
function Current() {
  return <span className="sr-only">current</span>;
}

/**
 * The command palette: session/project navigation, session actions, and view commands. Its groups and
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
      title={PALETTE_NAME}
      description="Open a session or project, start a session, or change the view."
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
  const { palette: open, setPalette: onOpenChange, select } = useNavigation();
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
  const groups = catalog(state, {
    globalCommands: globalCommandList,
    sessionCommands: sessionCommandList,
    sessionProject,
  });
  const { filters } = paletteScope(search);
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
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- page is the only member read.
    [results.page],
  );
  const selectionContext = useRef(results.selectionKey);
  useLayoutEffect(() => {
    if (pending) return;
    const reset = selectionContext.current !== results.selectionKey;
    selectionContext.current = results.selectionKey;
    const next = filters?.[0]?.token ?? paletteSelection(results.result, selected, reset);
    if (next !== selected) setSelected(next);
    if (reset || next !== selected) list.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [results.result, results.selectionKey, filters, pending, selected, setSelected]);

  return (
    <PaletteInput input={input} active={open} pending={pending} edit={edit} commit={commit}>
      {(replaceText) => (
        <CommandList ref={list} aria-busy={pending} className="max-h-[min(24rem,60dvh)]">
          <CommandEmpty>
            {results.error
              ? "Search unavailable. Close and reopen to retry."
              : pending
                ? "Searching…"
                : "No sessions, projects or commands match."}
          </CommandEmpty>
          {filters && !results.error ? (
            <CommandGroup heading="Filters">
              {filters.map((filter) => (
                <CommandItem
                  key={filter.token}
                  value={filter.token}
                  onSelect={() => {
                    if (!allowed.current || input.current?.value !== settled.current) return;
                    replaceText(filter.text);
                  }}
                >
                  {filter.label} ·{" "}
                  <span className="font-mono text-muted-foreground">{filter.token}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : (
            <PaletteResults
              pages={results.result}
              run={run}
              select={select}
              runCommand={executeCommand}
              page={changePage}
            />
          )}
        </CommandList>
      )}
    </PaletteInput>
  );
}

/** Urgent text stays outside catalog preparation; results can request an input edit, not a run. */
const PaletteInput = memo(function PaletteInput({
  input,
  active,
  pending,
  edit,
  commit,
  children,
}: {
  input: RefObject<HTMLInputElement | null>;
  active: boolean;
  pending: boolean;
  edit: () => void;
  commit: (query: string) => void;
  children: (replaceText: (value: string) => void) => ReactNode;
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
    <>
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
        placeholder={`${PALETTE_NAME}…`}
        aria-label={PALETTE_NAME}
      />
      {children((value) => {
        clearTimeout(timer.current);
        composing.current = false;
        edit();
        setText(value);
        commit(value);
        input.current?.focus();
      })}
    </>
  );
});

const PaletteResults = memo(function PaletteResults({
  pages,
  run,
  select,
  runCommand,
  page,
}: {
  pages: PalettePage[];
  run: (action: () => void) => void;
  select: ReturnType<typeof useNavigation>["select"];
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
                    title={r.hint}
                    onSelect={() => run(() => select(r.session.cwd, r.session.sessionId))}
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
                    {r.folder && (
                      <span className="ml-1 min-w-0 max-w-[45%] shrink-0 truncate text-xs text-ink-3">
                        <span className="sr-only">Folder: </span>
                        {r.folder}
                      </span>
                    )}
                    {r.hint && <span className="sr-only">{r.hint}</span>}
                  </CommandItem>
                ))
              : group.id === "projects"
                ? group.rows.map((r) => (
                    <CommandItem
                      key={r.key}
                      value={`${group.id}:${r.key}`}
                      disabled={!r.enabled}
                      onSelect={() => run(() => runCommand(r.command))}
                    >
                      <ProjectCommandIconView icon={r.command.icon} /> {r.label}
                    </CommandItem>
                  ))
                : group.id === "global"
                  ? group.rows.map((r) => (
                      <CommandItem
                        key={r.key}
                        value={`${group.id}:${r.key}`}
                        disabled={!r.enabled}
                        data-checked={r.checked}
                        onSelect={() => run(() => runCommand(r.command))}
                      >
                        <GlobalCommandIcon icon={r.command.icon} /> {r.label}
                        {r.checked && <Current />}
                      </CommandItem>
                    ))
                  : group.rows.map((r) => (
                      <CommandItem
                        key={r.key}
                        value={`${group.id}:${r.key}`}
                        disabled={!r.enabled}
                        data-checked={r.checked}
                        variant={
                          r.kind === "session" && r.command.destructive ? "destructive" : "default"
                        }
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
