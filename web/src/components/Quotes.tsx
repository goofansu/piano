import { MessageSquareQuoteIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/PianoPopover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { Button } from "@/components/ui/button";
import { type DraftKey, quoteDrafts } from "@/lib/messageDraft";

/** A draft's quotes, bound to React; messageDraft owns them and how they join the message. */
export function useQuotes(key: DraftKey | null) {
  const items = useSyncExternalStore(quoteDrafts.subscribe, () => quoteDrafts.get(key));
  return {
    items,
    remove: (index: number) => quoteDrafts.remove(key, index),
    clear: () => quoteDrafts.clear(key),
  };
}
export type QuoteDraft = ReturnType<typeof useQuotes>;

/**
 * The draft's quotes as a row of chips: the start of each quote, the whole of it on hover, and a
 * remove button. Hand-written: no shadcn component is a removable inline token.
 */
export function QuoteChips({ draft, disabled }: { draft: QuoteDraft; disabled: boolean }) {
  if (!draft.items.length) return null;
  return (
    <ul aria-label="Quotes" className="flex flex-wrap gap-1 px-3 pt-3 text-sm text-ink-2">
      {draft.items.map((quote, i) => (
        <li
          key={quote}
          className="group/quote flex min-w-0 animate-in items-center rounded-md transition-colors duration-(--dur-hover) fade-in-0 zoom-in-95 hover:bg-fill-hover focus-within:bg-fill-hover"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex min-w-0 items-center gap-1.5 py-1 pl-2">
                <MessageSquareQuoteIcon className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                {/* The whole quote is in the DOM for screen readers; CSS shows its start. */}
                <span className="max-w-[12rem] truncate">“{quote}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              align="start"
              className="line-clamp-[8] max-w-sm whitespace-pre-wrap break-words"
            >
              {quote}
            </TooltipContent>
          </Tooltip>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Remove quote"
            disabled={disabled}
            className="mr-0.5 opacity-0 group-hover/quote:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            onClick={() => draft.remove(i)}
          >
            <XIcon />
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** The first line box of a selection with any width, so the pill sits over where it starts. */
function firstLine(range: Range): DOMRect {
  for (const rect of range.getClientRects()) if (rect.width > 0) return rect;
  return range.getBoundingClientRect();
}

/**
 * Text selected with desktop input inside `children` offers "Add to chat" just above it, which
 * adds the selection to `draftKey`'s quotes. Touch devices keep their native selection menu.
 * The pill waits until the pointer is released, and keeps the selection while it is pressed.
 */
export function AddToChat({
  draftKey,
  className,
  children,
}: {
  draftKey: DraftKey | null;
  className?: string;
  children: ReactNode;
}) {
  const area = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<Range | null>(null);
  useEffect(() => {
    const touchInput = window.matchMedia("(pointer: coarse)");
    let pressed = false;
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selection = document.getSelection();
        const selected =
          !touchInput.matches &&
          !pressed &&
          selection &&
          selection.rangeCount > 0 &&
          !selection.isCollapsed
            ? selection.getRangeAt(0)
            : null;
        setRange(
          selected &&
            area.current?.contains(selected.commonAncestorContainer) &&
            selection?.toString().trim()
            ? selected
            : null,
        );
      });
    };
    const press = (e: PointerEvent) => {
      if (e.target instanceof Node && pill.current?.contains(e.target)) return;
      pressed = true;
      read();
    };
    const release = () => {
      pressed = false;
      read();
    };
    touchInput.addEventListener("change", read);
    document.addEventListener("selectionchange", read);
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    return () => {
      cancelAnimationFrame(frame);
      touchInput.removeEventListener("change", read);
      document.removeEventListener("selectionchange", read);
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
    };
  }, []);
  // Measured on every frame while open, so the pill follows the text as the transcript scrolls.
  const anchor = useMemo(
    () => ({
      current: range && {
        getBoundingClientRect: () => firstLine(range),
        // Lets the pill hide once the selection scrolls out of the transcript.
        contextElement: range.startContainer.parentElement ?? undefined,
      },
    }),
    [range],
  );
  const add = () => {
    const selection = document.getSelection();
    quoteDrafts.add(draftKey, selection?.toString() ?? "");
    selection?.removeAllRanges();
    setRange(null);
  };
  return (
    <div ref={area} className={className}>
      {children}
      <Popover open={!!range && !!draftKey} onOpenChange={(open) => !open && setRange(null)}>
        {anchor.current && <PopoverAnchor virtualRef={anchor as { current: Measurable }} />}
        <PopoverContent
          ref={pill}
          side="top"
          align="start"
          sideOffset={6}
          updatePositionStrategy="always"
          hideWhenDetached
          className="w-auto p-1"
          // Focus stays where it is, or the selection would go with it.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onPointerDown={(e) => e.preventDefault()}
            onClick={add}
          >
            Add to chat
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
type Measurable = { getBoundingClientRect: () => DOMRect };
