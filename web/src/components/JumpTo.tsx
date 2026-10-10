import type { RenderMsg } from "@shared/wire";
import { cn } from "cn";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { listRow } from "@/lib/styles";
import { currentEntry, type JumpEntry, jumpEntries, jumpTo, TRANSCRIPT_SELECTOR, transcriptRows } from "@/lib/transcript";

interface Props {
  messages: ReadonlyArray<RenderMsg>;
}

/** A table of contents for the transcript: prompts and replies, opened from the usage row. */
export function JumpTo({ messages }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>("bottom");
  const list = useRef<HTMLUListElement>(null);
  // Built from the rows the transcript renders, so every entry lands on a row that is there.
  const entries = useMemo(() => jumpEntries(transcriptRows(messages)), [messages]);
  const total = entries.filter(entry => entry.kind === "user" || entry.kind === "assistant").length;
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
  }, [open, entries]);
  const go = (entry: JumpEntry) => {
    setOpen(false);
    jumpTo(entry);
  };
  if (entries.length <= 2) return null;
  return <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Jump to message" aria-description={`${total} ${total === 1 ? "message" : "messages"} in the jump list`} aria-haspopup="dialog" aria-expanded={open} className="gap-1 px-1.5 font-mono text-xs font-normal text-ink-2 data-[state=open]:bg-fill-hover data-[state=open]:text-ink">
          {total} {total === 1 ? "message" : "messages"}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" collisionPadding={16} aria-label="Jump to message" className="w-[28rem] max-w-[calc(100vw-2rem)] p-0 font-sans">
        <p className="border-b border-line px-4 py-2.5 text-sm font-medium">Jump to…</p>
        <ul ref={list} className="max-h-[min(24rem,var(--radix-popover-content-available-height,60dvh))] overflow-y-auto py-1">
          {entries.map(entry => (
            <li key={entry.id}><button
              type="button"
              data-entry={entry.id}
              aria-current={entry.id === active ? "true" : undefined}
              onClick={() => go(entry)}
              className={cn(
                listRow, "gap-3 px-4 py-1.5",
                entry.id === active && "bg-fill",
                (entry.kind === "top" || entry.kind === "bottom") && "italic text-ink-3",
              )}
            >
              <span className="flex w-4 shrink-0 items-center justify-center text-ink-3 [&_svg]:size-3.5" aria-hidden>
                {entry.kind === "top" ? <ArrowUpIcon /> : entry.kind === "bottom" ? <ArrowDownIcon /> : entry.kind === "user" ? <span className="font-semibold text-brand not-italic">›</span> : "•"}
              </span>
              <span className="sr-only">{entry.kind === "user" ? "You said" : entry.kind === "assistant" ? "Pi said" : ""}</span>
              <span className={cn("min-w-0 flex-1 truncate", entry.kind === "user" && "text-ink")}>{entry.label}</span>
            </button></li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
    <Separator orientation="vertical" className="h-3!" />
  </>;
}
