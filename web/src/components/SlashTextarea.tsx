import type { SlashCommand } from "@shared/wire";
import { cn } from "cn";
import {
  type ComponentProps,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/PianoPopover";
import { Textarea } from "@/components/ui/textarea";
import { sessionCommands, slashCommands } from "@/lib/api";
import { useObservation } from "@/lib/useObservation";

export interface CompletionContext {
  cwd: string;
  /** Only supplied for a live child, which then answers; discovery must not start a saved session. */
  session?: { workspaceId: string; sessionId: string };
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
export function SlashTextarea({
  value,
  ref,
  completion,
  onValueChange,
  onKeyDown,
  onSelect,
  onFocus,
  onBlur,
  onCompositionStart,
  onCompositionEnd,
  ...props
}: Props) {
  const id = useId();
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState<string>();
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const tokenElement = useRef<HTMLSpanElement>(null);
  const [accepted, setAccepted] = useState<string>();
  const [hovered, setHovered] = useState(false);
  const key = JSON.stringify(completion);
  const range = tokenAt(value, selection.start, selection.end);
  const leading = /^\s*\/([^\s/]+)(?=\s|$)/.exec(value);
  const token =
    accepted && leading?.[1] === accepted
      ? { from: leading[0].indexOf("/"), to: leading[0].length }
      : null;
  // The native textarea remains the editor (selection, undo, IME and accessibility).
  // A non-interactive mirror only paints the command's hover treatment.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resync DOM metrics when draft text or input styling changes, not on streaming renders.
  useLayoutEffect(() => {
    const element = ref.current;
    const overlay = mirror.current;
    if (!element || !overlay) return;
    const sync = () => {
      const style = getComputedStyle(element);
      for (const property of [
        "font-family",
        "font-size",
        "font-weight",
        "font-style",
        "font-variant",
        "direction",
        "line-height",
        "letter-spacing",
        "padding",
        "border-width",
        "box-sizing",
        "text-indent",
        "tab-size",
        "word-spacing",
        "text-align",
      ])
        overlay.style.setProperty(property, style.getPropertyValue(property));
      overlay.style.width = `${element.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`;
      overlay.style.height = `${element.clientHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)}px`;
      overlay.scrollTop = element.scrollTop;
      overlay.scrollLeft = element.scrollLeft;
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    const onScroll = () => {
      sync();
      setHovered(false);
    };
    element.addEventListener("scroll", onScroll);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", sync);
    };
  }, [ref, value, props.className, props.style]);
  const position = JSON.stringify([key, value, selection]);
  const open =
    !!completion?.cwd &&
    !props.disabled &&
    focused &&
    !composing &&
    !!range &&
    dismissed !== position;
  const cwd = completion?.cwd;
  const session = completion?.session;
  // Fetch once per opening, not per keystroke. Reopening gets the live catalog
  // again, including changes made by a handled extension command.
  const catalog = useObservation(open && cwd ? key : null, (signal) =>
    session
      ? sessionCommands(session.workspaceId, session.sessionId, { signal })
      : slashCommands(cwd!, { signal }),
  );
  const current = catalog.value
    ? { commands: catalog.value }
    : catalog.error
      ? { commands: [], error: catalog.error }
      : undefined;
  const query = range?.query ?? "";
  const commands = (current?.commands ?? [])
    .filter((command) => command.source === "skill" && command.name.toLowerCase().includes(query))
    .sort((a, b) => {
      const rank = (command: SlashCommand) =>
        command.name
          .replace(/^skill:/, "")
          .toLowerCase()
          .startsWith(query)
          ? 0
          : 1;
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    })
    .slice(0, 50);
  const active = Math.min(selected, Math.max(0, commands.length - 1));
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing the completion position/query resets selection; arrow-key selection alone must not reset it.
  useEffect(() => setSelected(0), [position]);
  useLayoutEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  const syncSelection = (element: HTMLTextAreaElement) =>
    setSelection({ start: element.selectionStart, end: element.selectionEnd });
  const close = () => setDismissed(position);
  const accept = (command: SlashCommand) => {
    const element = ref.current;
    if (!element || !range || composing || !open) return;
    // Guard against a pointer action or delayed render accepting an obsolete range.
    if (
      element.value !== value ||
      element.selectionStart !== selection.start ||
      element.selectionEnd !== selection.end
    )
      return;
    const suffix = value.slice(range.to);
    const hasSeparator = /^\s/.test(suffix);
    const inserted = `/${command.name}${hasSeparator ? "" : " "}`;
    const next = value.slice(0, range.from) + inserted + suffix;
    // Reuse an existing separator, but leave the caret after it so the next
    // character becomes an argument rather than extending the command name.
    const caret = range.from + inserted.length + (hasSeparator ? 1 : 0);
    setAccepted(command.name);
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
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <PopoverAnchor asChild>
        <div className="slash-textarea">
          <Textarea
            {...props}
            ref={ref}
            value={value}
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            aria-activedescendant={open && commands.length ? `${id}-${active}` : undefined}
            onPointerMove={(event) => {
              const rects = tokenElement.current?.getClientRects();
              setHovered(
                !!rects &&
                  Array.from(rects).some(
                    (rect) =>
                      event.clientX >= rect.left &&
                      event.clientX <= rect.right &&
                      event.clientY >= rect.top &&
                      event.clientY <= rect.bottom,
                  ),
              );
              props.onPointerMove?.(event);
            }}
            onPointerLeave={(event) => {
              setHovered(false);
              props.onPointerLeave?.(event);
            }}
            onChange={(event) => {
              setHovered(false);
              syncSelection(event.currentTarget);
              onValueChange(event.currentTarget.value);
            }}
            onSelect={(event) => {
              syncSelection(event.currentTarget);
              onSelect?.(event);
            }}
            onFocus={(event) => {
              setFocused(true);
              setDismissed(undefined);
              syncSelection(event.currentTarget);
              onFocus?.(event);
            }}
            onBlur={(event) => {
              setFocused(false);
              onBlur?.(event);
            }}
            onCompositionStart={(event) => {
              setComposing(true);
              onCompositionStart?.(event);
            }}
            onCompositionEnd={(event) => {
              setComposing(false);
              syncSelection(event.currentTarget);
              onCompositionEnd?.(event);
            }}
            onKeyDown={(event) => {
              if (composing || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
                return;
              const element = event.currentTarget;
              if (
                token &&
                !props.readOnly &&
                event.key === "Backspace" &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey &&
                element.selectionEnd === token.to &&
                (element.selectionStart === token.to ||
                  (event.repeat && element.selectionStart === token.from))
              ) {
                event.preventDefault();
                element.setSelectionRange(token.from, token.to);
                syncSelection(element);
                close();
                return;
              }
              if (open && event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
                return;
              }
              if (open && commands.length && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
                if (!event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                  event.preventDefault();
                  setSelected(
                    (active + (event.key === "ArrowDown" ? 1 : -1) + commands.length) %
                      commands.length,
                  );
                  return;
                }
                if ((event.key === "Tab" && !event.altKey) || event.key === "Enter") {
                  event.preventDefault();
                  if (!event.repeat) accept(commands[active]);
                  return;
                }
              }
              onKeyDown?.(event);
            }}
          />
          {/* No shadcn primitive paints inline ranges inside a native textarea. */}
          <div ref={mirror} className="slash-textarea-mirror" aria-hidden="true">
            {token && (
              <>
                {value.slice(0, token.from)}
                <span
                  ref={tokenElement}
                  className="slash-command-token"
                  data-hovered={hovered && !props.disabled}
                >
                  {value.slice(token.from, token.to)}
                </span>
                {value.slice(token.to)}
              </>
            )}
          </div>
        </div>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        role="presentation"
        className="w-[min(32rem,var(--radix-popover-trigger-width))] max-w-[calc(100vw-2rem)] p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault(); /* The textarea owns Escape, including IME. */
        }}
        onInteractOutside={(event) => {
          if (event.target === ref.current) event.preventDefault();
        }}
        onPointerDown={(event) => {
          if (event.pointerType !== "touch") event.preventDefault();
        }}
      >
        {/* cmdk assumes a separate single-line search input. This listbox keeps
            textarea focus and its caret, including on touch suggestion selection. */}
        <ul
          ref={list}
          id={id}
          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the textarea drives this listbox through aria-activedescendant.
          role="listbox"
          aria-label="Slash commands"
          className="max-h-[min(18rem,var(--radix-popover-content-available-height))] overflow-y-auto"
        >
          {commands.map((command, index) => (
            // biome-ignore lint/a11y/useFocusableInteractive: as above.
            // biome-ignore lint/a11y/useKeyWithClickEvents: as above.
            <li
              key={command.name}
              id={`${id}-${index}`}
              // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: options stay unfocusable; the textarea keeps focus and handles keys.
              role="option"
              aria-selected={index === active}
              className={cn(
                "flex min-h-11 cursor-default flex-col gap-0.5 rounded-md px-3 py-2 text-sm",
                index === active && "bg-accent text-accent-foreground",
              )}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => accept(command)}
              onPointerMove={(event) => {
                if (event.pointerType === "mouse") setSelected(index);
              }}
            >
              <span className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate">/{command.name}</span>
                <span className="text-xs text-muted-foreground">
                  {command.source === "prompt" ? "template" : command.source}
                </span>
              </span>
              {command.description && (
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {command.description}
                </span>
              )}
            </li>
          ))}
        </ul>
        {!commands.length && (
          <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
            {!current
              ? "Loading commands…"
              : current.error
                ? "Could not load commands. Close and reopen to retry."
                : "No matching commands."}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
