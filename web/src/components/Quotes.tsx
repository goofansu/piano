import { MessageSquareQuoteIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { PianoButton } from "@/components/PianoButton";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/PianoPopover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { Button } from "@/components/ui/button";
import { type DraftKey } from "@/lib/messageDraft";
import { useDrafts } from "@/lib/useMachine";

export interface QuoteDraft {
  items: readonly string[];
  remove: (index: number) => void;
}

export function QuoteChips({ draft, disabled }: { draft: QuoteDraft; disabled: boolean }) {
  if (!draft.items.length) return null;
  return (
    <ul aria-label="Quotes" className="flex flex-wrap gap-1 px-3 pt-3 text-sm text-ink-2">
      {draft.items.map((quote, i) => (
        <li
          key={quote}
          className="group/quote flex min-w-0 items-center rounded-md hover:bg-fill-hover focus-within:bg-fill-hover"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex min-w-0 items-center gap-1.5 py-1 pl-2">
                <MessageSquareQuoteIcon className="size-3.5 shrink-0 text-ink-3" aria-hidden />
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
          <PianoButton
            type="button"
            variant="ghost"
            size="inline"
            aria-label="Remove quote"
            disabled={disabled}
            className="mr-0.5 opacity-0 group-hover/quote:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            onClick={() => draft.remove(i)}
          >
            <XIcon />
          </PianoButton>
        </li>
      ))}
    </ul>
  );
}

function firstLine(range: Range): DOMRect {
  for (const rect of range.getClientRects()) if (rect.width > 0) return rect;
  return range.getBoundingClientRect();
}

export function AddToChat({
  draftKey,
  className,
  children,
}: {
  draftKey: DraftKey | null;
  className?: string;
  children: ReactNode;
}) {
  const drafts = useDrafts();
  const area = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<Range | null>(null);
  useEffect(() => {
    const touchInput = window.matchMedia("(pointer: coarse)");
    let pressed = false;
    let selectionEnabled = true;
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selection = document.getSelection();
        const selected =
          !touchInput.matches &&
          selectionEnabled &&
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
      selectionEnabled = e.target instanceof Node && !!area.current?.contains(e.target);
      pressed = true;
      read();
    };
    const release = () => {
      pressed = false;
      read();
    };
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof Node && area.current?.contains(e.target)) selectionEnabled = true;
    };
    touchInput.addEventListener("change", read);
    document.addEventListener("keydown", key, true);
    document.addEventListener("selectionchange", read);
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    return () => {
      cancelAnimationFrame(frame);
      touchInput.removeEventListener("change", read);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("selectionchange", read);
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
    };
  }, []);
  const anchor = useMemo(
    () => ({
      current: range && {
        getBoundingClientRect: () => firstLine(range),
        contextElement: range.startContainer.parentElement ?? undefined,
      },
    }),
    [range],
  );
  const add = () => {
    const selection = document.getSelection();
    drafts.addQuote(draftKey, selection?.toString() ?? "");
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
