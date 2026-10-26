import type { LucideIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/PianoPopover";
import { UsageDivider } from "@/components/UsageDivider";
import { Button } from "@/components/ui/button";

interface Props {
  /** The trigger's and the panel's accessible name. */
  label: string;
  /** The panel's header; the label unless given. */
  title?: string;
  /** Shown before the count on phones, where the noun is hidden. */
  icon: LucideIcon;
  count: number;
  /** The noun after the count, singular then plural. */
  noun: readonly [string, string];
  /** Ends the trigger's accessible description, after the count and noun. */
  description: string;
  /**
   * The selector of the row to centre in the list, read on opening and again while open when it
   * changes, so a caller memoizes it on what it reads. Without it, opening shows the end: the
   * lists run in conversation order, newest at the bottom like the transcript, and the row wanted
   * is nearly always recent.
   */
  centre?: () => string;
  /** The list's `<li>` rows. Choosing a link or button in one closes the popover. */
  children: ReactNode;
}

/**
 * A usage row list popover (Jump to): a count that opens a list above the composer, and the short
 * divider after it. The caller owns its rows; the trigger, panel, list, scrolling and closing live
 * here.
 */
export function UsageListPopover({
  label,
  title = label,
  icon: Icon,
  count,
  noun,
  description,
  centre,
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!open) return;
    const target = centre?.();
    const frame = requestAnimationFrame(() => {
      const box = list.current;
      if (!box) return;
      if (target === undefined) {
        box.scrollTop = box.scrollHeight;
        return;
      }
      const el = box.querySelector<HTMLElement>(target);
      if (el) box.scrollTop = el.offsetTop - (box.clientHeight - el.offsetHeight) / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, centre]);
  const word = count === 1 ? noun[0] : noun[1];
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={label}
            aria-description={`${count} ${word} ${description}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="gap-1 px-1.5 font-mono text-xs font-normal text-ink-2 data-[state=open]:bg-fill-hover data-[state=open]:text-ink"
          >
            <Icon aria-hidden className="size-3.5 md:hidden" />
            {count}
            <span className="hidden md:inline">{word}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          collisionPadding={16}
          aria-label={label}
          className="w-[28rem] max-w-[calc(100vw-2rem)] gap-0 p-0 font-sans"
        >
          <p className="border-b border-line px-4 py-2.5 text-sm font-medium">{title}</p>
          {/* Captured, so the popover closes before the row's own action runs. */}
          <ul
            ref={list}
            onClickCapture={(event) => {
              if ((event.target as Element).closest("a, button")) setOpen(false);
            }}
            className="max-h-[min(24rem,var(--radix-popover-content-available-height,60dvh))] overflow-y-auto py-1"
          >
            {children}
          </ul>
        </PopoverContent>
      </Popover>
      <UsageDivider />
    </>
  );
}
