import { useEffect, useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, ListIcon } from "lucide-react";
import type { RenderMsg } from "@shared/wire";
import { cn } from "cn";
import { currentEntry, type JumpEntry, jumpEntries, jumpTo, TRANSCRIPT_SELECTOR } from "@/lib/transcript";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";

interface Props {
  messages: ReadonlyArray<RenderMsg>;
}

/** A table of contents for the transcript: prompts and replies, opened from the usage row. */
export function JumpTo({ messages }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>("bottom");
  const list = useRef<HTMLDivElement>(null);
  const entries = jumpEntries(messages);
  // Opening reads where the reader is and centres that entry in the list.
  useEffect(() => {
    if (!open) return;
    const container = document.querySelector<HTMLElement>(TRANSCRIPT_SELECTOR);
    const id = container ? currentEntry(container, entries) : "bottom";
    setActive(id);
    const frame = requestAnimationFrame(() => {
      const el = list.current?.querySelector<HTMLElement>(`[data-entry="${CSS.escape(id)}"]`);
      const box = list.current;
      if (el && box) box.scrollTop = el.offsetTop - (box.clientHeight - el.offsetHeight) / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const go = (entry: JumpEntry) => {
    setOpen(false);
    jumpTo(entry);
  };
  if (entries.length <= 2) return null;
  return <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Jump to message" aria-haspopup="dialog" aria-expanded={open} title="Jump to…" className="size-7 text-ink-2 data-[state=open]:bg-fill-hover data-[state=open]:text-ink">
          <ListIcon aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" collisionPadding={16} aria-label="Jump to message" className="w-[28rem] max-w-[calc(100vw-2rem)] p-0 font-sans">
        <p className="border-b border-line px-4 py-2.5 text-sm font-medium">Jump to…</p>
        <div ref={list} className="max-h-[min(24rem,var(--radix-popover-content-available-height,60dvh))] overflow-y-auto py-1" role="list">
          {entries.map(entry => (
            <button
              key={entry.id}
              type="button"
              role="listitem"
              data-entry={entry.id}
              aria-current={entry.id === active ? "true" : undefined}
              onClick={() => go(entry)}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-1.5 text-left text-sm outline-none transition-colors hover:bg-fill-hover focus-visible:bg-fill-hover",
                entry.id === active && "bg-fill",
                (entry.kind === "top" || entry.kind === "bottom") && "italic text-ink-3",
              )}
            >
              <span className="flex w-4 shrink-0 items-center justify-center text-ink-3 [&_svg]:size-3.5" aria-hidden>
                {entry.kind === "top" ? <ArrowUpIcon /> : entry.kind === "bottom" ? <ArrowDownIcon /> : entry.kind === "user" ? <span className="font-semibold text-brand not-italic">›</span> : "•"}
              </span>
              <span className="sr-only">{entry.kind === "user" ? "You said" : entry.kind === "assistant" ? "Pi said" : ""}</span>
              <span className={cn("min-w-0 flex-1 truncate", entry.kind === "user" && "text-ink")}>{entry.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
    <Separator orientation="vertical" className="h-3!" />
  </>;
}
