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
import {
  commandToken,
  completionRange,
  initialSlashState,
  rankCommands,
  type SlashEvent,
  type SlashView,
  slashAccept,
  slashActive,
  slashKeyDown,
  slashOpen,
  slashUpdate,
} from "@/lib/slashCompletion";
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
  const [state, setState] = useState(initialSlashState);
  const list = useRef<HTMLUListElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const tokenElement = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const key = JSON.stringify(completion);
  const view: SlashView = {
    value,
    enabled: !!completion?.cwd && !props.disabled,
    readOnly: !!props.readOnly,
    context: key,
  };
  const range = completionRange(value, state.selection);
  const token = commandToken(value, state.accepted);
  // The native textarea remains the editor (selection, undo, IME and accessibility).
  // A non-interactive mirror paints command color and hover without replacing native editing.
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
  const open = slashOpen(state, view);
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
  // Discovery still starts immediately and stays scoped to this opening. Only its
  // presentation waits: fast responses need no loading flash, slow ones get a status row.
  const pending = open && !current;
  const [waitingContext, setWaitingContext] = useState<string>();
  useEffect(() => {
    if (!pending) {
      setWaitingContext(undefined);
      return;
    }
    const timer = setTimeout(() => setWaitingContext(key), 150);
    return () => clearTimeout(timer);
  }, [pending, key]);
  const visible = open && (!!current || waitingContext === key);
  const commands = rankCommands(current?.commands ?? [], range?.query ?? "");
  const active = slashActive(state, view, commands.length);
  useLayoutEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  const snapshot = (element: HTMLTextAreaElement) => ({
    value: element.value,
    selection: { start: element.selectionStart, end: element.selectionEnd },
  });
  const update = (event: SlashEvent) => setState((current) => slashUpdate(current, view, event));
  const accept = (command: SlashCommand) => {
    const element = ref.current;
    const result = element && slashAccept(state, view, command.name, snapshot(element));
    if (!element || !result) return;
    const { text: next, caret } = result;
    setState(result.state);
    onValueChange(next);
    requestAnimationFrame(() => {
      if (ref.current !== element || element.value !== next) return;
      element.focus({ preventScroll: true });
      element.setSelectionRange(caret, caret);
      update({ type: "select", ...snapshot(element) });
    });
  };
  return (
    <Popover
      open={visible}
      onOpenChange={(next) => {
        if (!next) update({ type: "dismiss" });
      }}
    >
      <PopoverAnchor asChild>
        <div className="slash-textarea" data-command={!!token}>
          <Textarea
            {...props}
            ref={ref}
            value={value}
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={visible}
            aria-controls={visible ? id : undefined}
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
              update({ type: "select", ...snapshot(event.currentTarget) });
              onValueChange(event.currentTarget.value);
            }}
            onSelect={(event) => {
              update({ type: "select", ...snapshot(event.currentTarget) });
              onSelect?.(event);
            }}
            onFocus={(event) => {
              update({ type: "focus", ...snapshot(event.currentTarget) });
              onFocus?.(event);
            }}
            onBlur={(event) => {
              update({ type: "blur" });
              onBlur?.(event);
            }}
            onCompositionStart={(event) => {
              update({ type: "composition-start" });
              onCompositionStart?.(event);
            }}
            onCompositionEnd={(event) => {
              update({ type: "composition-end", ...snapshot(event.currentTarget) });
              onCompositionEnd?.(event);
            }}
            onKeyDown={(event) => {
              const element = event.currentTarget;
              const { state: next, effect } = slashKeyDown(
                state,
                view,
                {
                  key: event.key,
                  repeat: event.repeat,
                  shiftKey: event.shiftKey,
                  ctrlKey: event.ctrlKey,
                  metaKey: event.metaKey,
                  altKey: event.altKey,
                  isComposing: event.nativeEvent.isComposing,
                  keyCode: event.nativeEvent.keyCode,
                  selection: snapshot(element).selection,
                },
                commands.length,
              );
              if (effect.type === "ignore") return;
              if (effect.type === "pass") return onKeyDown?.(event);
              event.preventDefault();
              setState(next);
              if (effect.type === "select-token") element.setSelectionRange(effect.from, effect.to);
              else if (effect.type === "close") event.stopPropagation();
              else if (effect.type === "accept") accept(commands[effect.index]);
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
                {"\u200b"}
              </>
            )}
          </div>
        </div>
      </PopoverAnchor>
      <PopoverContent
        still
        side="top"
        align="start"
        role="presentation"
        className={cn(
          "max-w-[calc(100vw-2rem)] gap-0 p-1",
          commands.length ? "w-[min(32rem,var(--radix-popover-trigger-width))]" : "w-auto",
        )}
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
                if (event.pointerType === "mouse") update({ type: "highlight", index });
              }}
            >
              <span className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate">/{command.name}</span>
                {/* Pi's source, as Settings names it: prompt, skill or extension. */}
                <span className="text-xs text-muted-foreground">{command.source}</span>
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
