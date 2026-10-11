import type { SlashCommand } from "@shared/wire";
import { cn } from "cn";
import { type ComponentProps, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { slashCommands } from "@/lib/api";
import { useObservation } from "@/lib/useObservation";

export interface CompletionContext {
  cwd: string;
  /** Only supplied for a live child; discovery must not start a saved session. */
  sessionId?: string;
  /** Invalidates pending discovery after replacement, reconnect or trust changes. */
  revision?: string;
}

type Props = Omit<ComponentProps<typeof Textarea>, "value" | "ref" | "onChange"> & {
  value: string;
  onValueChange: (text: string) => void;
  ref: RefObject<HTMLTextAreaElement | null>;
  completion?: CompletionContext;
};

/** Leading command token only. Sending trims the prompt, so whitespace before it is harmless. */
function tokenAt(text: string, start: number, end: number) {
  if (start !== end) return null;
  const match = /^\s*\/([^\s/]*)/.exec(text);
  if (!match) return null;
  const from = match[0].indexOf("/");
  const to = match[0].length;
  if (start <= from || start > to || text[to] === "/") return null;
  return { from, to, query: text.slice(from + 1, start).toLowerCase() };
}

/** One textarea/listbox interaction for both composers. No prompt transformation or execution. */
export function SlashTextarea({ value, ref, completion, onValueChange, onKeyDown, onSelect, onFocus, onBlur, onCompositionStart, onCompositionEnd, ...props }: Props) {
  const id = useId();
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState<string>();
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const key = JSON.stringify(completion);
  const range = tokenAt(value, selection.start, selection.end);
  const position = JSON.stringify([key, value, selection]);
  const open = !!completion?.cwd && !props.disabled && focused && !composing && !!range && dismissed !== position;
  const cwd = completion?.cwd;
  const sessionId = completion?.sessionId;
  // Fetch once per opening, not per keystroke. Reopening gets the live catalog
  // again, including changes made by a handled extension command.
  const catalog = useObservation(open && cwd ? key : null, signal => slashCommands(cwd!, sessionId, { signal }));
  const current = catalog.value ? { commands: catalog.value } : catalog.error ? { commands: [], error: catalog.error } : undefined;
  const query = range?.query ?? "";
  const commands = (current?.commands ?? []).filter(command => command.source === "skill" && command.name.toLowerCase().includes(query))
    .sort((a, b) => {
      const rank = (command: SlashCommand) => command.name.replace(/^skill:/, "").toLowerCase().startsWith(query) ? 0 : 1;
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    }).slice(0, 50);
  const active = Math.min(selected, Math.max(0, commands.length - 1));
  useEffect(() => setSelected(0), [position]);
  useLayoutEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  const syncSelection = (element: HTMLTextAreaElement) => setSelection({ start: element.selectionStart, end: element.selectionEnd });
  const close = () => setDismissed(position);
  const accept = (command: SlashCommand) => {
    const element = ref.current;
    if (!element || !range || composing || !open) return;
    // Guard against a pointer action or delayed render accepting an obsolete range.
    if (element.value !== value || element.selectionStart !== selection.start || element.selectionEnd !== selection.end) return;
    const suffix = value.slice(range.to);
    const hasSeparator = /^\s/.test(suffix);
    const inserted = `/${command.name}${hasSeparator ? "" : " "}`;
    const next = value.slice(0, range.from) + inserted + suffix;
    // Reuse an existing separator, but leave the caret after it so the next
    // character becomes an argument rather than extending the command name.
    const caret = range.from + inserted.length + (hasSeparator ? 1 : 0);
    onValueChange(next);
    setDismissed(JSON.stringify([key, next, { start: caret, end: caret }]));
    requestAnimationFrame(() => {
      if (ref.current !== element || element.value !== next) return;
      element.focus({ preventScroll: true });
      element.setSelectionRange(caret, caret);
      syncSelection(element);
    });
  };
  return (
    <Popover open={open} onOpenChange={next => { if (!next) close(); }}>
      <PopoverAnchor asChild>
        <Textarea {...props} ref={ref} value={value} role="combobox" aria-autocomplete="list" aria-haspopup="listbox"
          aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open && commands.length ? `${id}-${active}` : undefined}
          onChange={event => { syncSelection(event.currentTarget); onValueChange(event.currentTarget.value); }}
          onSelect={event => { syncSelection(event.currentTarget); onSelect?.(event); }}
          onFocus={event => { setFocused(true); setDismissed(undefined); syncSelection(event.currentTarget); onFocus?.(event); }}
          onBlur={event => { setFocused(false); onBlur?.(event); }}
          onCompositionStart={event => { setComposing(true); onCompositionStart?.(event); }}
          onCompositionEnd={event => { setComposing(false); syncSelection(event.currentTarget); onCompositionEnd?.(event); }}
          onKeyDown={event => {
            if (composing || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
            if (open && commands.length && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
              if (!event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                event.preventDefault(); setSelected((active + (event.key === "ArrowDown" ? 1 : -1) + commands.length) % commands.length); return;
              }
              if ((event.key === "Tab" && !event.altKey) || event.key === "Enter") {
                event.preventDefault(); if (!event.repeat) accept(commands[active]); return;
              }
            }
            onKeyDown?.(event);
          }}
        />
      </PopoverAnchor>
      <PopoverContent side="top" align="start" role="presentation" className="w-[min(32rem,var(--radix-popover-trigger-width))] max-w-[calc(100vw-2rem)] p-1"
        onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
        onEscapeKeyDown={event => { event.preventDefault(); /* The textarea owns Escape, including IME. */ }}
        onInteractOutside={event => { if (event.target === ref.current) event.preventDefault(); }}
        onPointerDown={event => { if (event.pointerType !== "touch") event.preventDefault(); }}
      >
        {/* cmdk assumes a separate single-line search input. This listbox keeps
            textarea focus and its caret, including on touch suggestion selection. */}
        {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the textarea drives this listbox through aria-activedescendant. */}
        <ul ref={list} id={id} role="listbox" aria-label="Slash commands" className="max-h-[min(18rem,var(--radix-popover-content-available-height))] overflow-y-auto">
          {commands.map((command, index) => (
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: options stay unfocusable; the textarea keeps focus and handles keys.
            // biome-ignore lint/a11y/useFocusableInteractive: as above.
            // biome-ignore lint/a11y/useKeyWithClickEvents: as above.
            <li key={command.name} id={`${id}-${index}`} role="option" aria-selected={index === active}
              className={cn("flex min-h-11 cursor-default flex-col gap-0.5 rounded-md px-3 py-2 text-sm", index === active && "bg-accent text-accent-foreground")}
              onPointerDown={event => event.preventDefault()} onClick={() => accept(command)}
              onPointerMove={event => { if (event.pointerType === "mouse") setSelected(index); }}>
              <span className="flex items-center gap-3"><span className="min-w-0 flex-1 truncate">/{command.name}</span><span className="text-xs text-muted-foreground">{command.source === "prompt" ? "template" : command.source}</span></span>
              {command.description && <span className="line-clamp-2 text-xs text-muted-foreground">{command.description}</span>}
            </li>
          ))}
        </ul>
        {!commands.length && <p role="status" className="px-3 py-2 text-sm text-muted-foreground">{!current ? "Loading commands…" : current.error ? "Could not load commands. Close and reopen to retry." : "No matching commands."}</p>}
      </PopoverContent>
    </Popover>
  );
}
