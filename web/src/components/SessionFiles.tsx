import type { RenderMsg } from "@shared/wire";
import { cn } from "cn";
import { useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/PianoPopover";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { abbrevHome } from "@/lib/format";
import { sessionFiles, splitPath } from "@/lib/sessionFiles";
import { listRow } from "@/lib/styles";
import { useNavigation } from "@/lib/useNavigation";

interface Props {
  messages: ReadonlyArray<RenderMsg>;
}

/**
 * The files Pi wrote or edited in this session, opened from the usage row beside Links. Each
 * opens in the right sidebar's file viewer, as a local file link in the transcript does.
 * Absent while the session wrote nothing.
 */
export function SessionFiles({ messages }: Props) {
  const [open, setOpen] = useState(false);
  const { openPanel } = useNavigation();
  const files = useMemo(() => sessionFiles(messages), [messages]);
  // Conversation order, newest at the bottom like the transcript; opening shows the end, since
  // the file wanted is nearly always the one touched last.
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const box = list.current;
      if (box) box.scrollTop = box.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  if (files.length === 0) return null;
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Files"
            aria-description={`${files.length} ${files.length === 1 ? "file" : "files"} written or edited in this session`}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="gap-1 px-1.5 font-mono text-xs font-normal text-ink-2 data-[state=open]:bg-fill-hover data-[state=open]:text-ink"
          >
            {files.length} {files.length === 1 ? "file" : "files"}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          collisionPadding={16}
          aria-label="Files"
          className="w-[28rem] max-w-[calc(100vw-2rem)] gap-0 p-0 font-sans"
        >
          <p className="border-b border-line px-4 py-2.5 text-sm font-medium">Files</p>
          <ul
            ref={list}
            className="max-h-[min(24rem,var(--radix-popover-content-available-height,60dvh))] overflow-y-auto py-1"
          >
            {files.map((file) => {
              const { name, dir } = splitPath(abbrevHome(file.path));
              return (
                <li key={file.path} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      openPanel({ kind: "file", path: file.path });
                    }}
                    className={cn(listRow, "min-w-0 flex-1 px-4 py-1.5")}
                  >
                    {/* Two lines: files in one session mostly share a directory, so the name
                        leads and the directory sits under it. Every row opens the viewer, so no
                        glyph marks it. */}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-ink">{name}</span>
                      {dir && <span className="truncate font-mono text-xs text-ink-3">{dir}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
      <Separator orientation="vertical" className="h-3!" />
    </>
  );
}
