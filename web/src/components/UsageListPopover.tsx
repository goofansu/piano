import type { LucideIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/PianoPopover";
import { Button } from "@/components/ui/button";
import { UsageDivider } from "@/components/UsageDivider";

interface Props {
  label: string;
  title?: string;
  icon: LucideIcon;
  count: number;
  noun: readonly [string, string];
  description: string;
  centre?: () => string;
  children: ReactNode;
}

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
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              aria-label={label}
              aria-description={`${count} ${word} ${description}`}
              aria-haspopup="dialog"
              aria-expanded={open}
              className="gap-1 px-1.5 font-mono text-xs font-normal text-ink-2 aria-expanded:bg-fill-hover aria-expanded:text-ink"
            >
              <Icon aria-hidden className="size-3.5 md:hidden" />
              {count}
              <span className="hidden md:inline">{word}</span>
            </Button>
          }
        />
        <PopoverContent
          side="top"
          align="end"
          collisionPadding={16}
          aria-label={label}
          className="w-[28rem] max-w-[calc(100vw-2rem)] gap-0 p-0 font-sans"
        >
          <p className="border-b border-line px-4 py-2.5 text-sm font-medium">{title}</p>
          <ul
            ref={list}
            onClickCapture={(event) => {
              if ((event.target as Element).closest("a, button")) setOpen(false);
            }}
            className="max-h-[min(24rem,var(--available-height,60dvh))] overflow-y-auto py-1"
          >
            {children}
          </ul>
        </PopoverContent>
      </Popover>
      <UsageDivider />
    </>
  );
}
