import type { RenderMsg } from "@shared/wire";
import { cn } from "cn";
import { ArrowDownIcon, ArrowUpIcon, MessageSquareIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { UsageListPopover } from "@/components/UsageListPopover";
import { listRow } from "@/lib/styles";
import { jumpEntries, transcriptRows } from "@/lib/transcript";
import { useTranscriptViewport } from "@/lib/useTranscriptViewport";

interface Props {
  messages: ReadonlyArray<RenderMsg>;
  working?: boolean;
}

/** A table of contents for the transcript: prompts and replies, opened from the usage row. */
export function JumpTo({ messages, working = false }: Props) {
  const [active, setActive] = useState<string>("bottom");
  const viewport = useTranscriptViewport();
  // Built from the rows the transcript renders, so every entry lands on a row that is there.
  const entries = useMemo(
    () => jumpEntries(transcriptRows(messages, { working })),
    [messages, working],
  );
  const total = entries.filter(
    (entry) => entry.kind === "user" || entry.kind === "assistant",
  ).length;
  // Opening reads where the reader is and centres that entry in the list.
  const centre = useCallback(() => {
    const id = viewport ? viewport.current(entries) : "bottom";
    setActive(id);
    return `[data-entry="${CSS.escape(id)}"]`;
  }, [entries, viewport]);
  if (entries.length <= 2) return null;
  return (
    <UsageListPopover
      label="Jump to message"
      title="Jump to…"
      icon={MessageSquareIcon}
      count={total}
      noun={["message", "messages"]}
      description="in the jump list"
      centre={centre}
    >
      {entries.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            data-entry={entry.id}
            aria-current={entry.id === active ? "true" : undefined}
            onClick={() => viewport?.jump(entry)}
            className={cn(
              listRow,
              "gap-3 px-4 py-1.5",
              entry.id === active && "bg-fill",
              (entry.kind === "top" || entry.kind === "bottom") && "italic text-ink-3",
            )}
          >
            <span
              className="flex w-4 shrink-0 items-center justify-center text-ink-3 [&_svg]:size-3.5"
              aria-hidden
            >
              {entry.kind === "top" ? (
                <ArrowUpIcon />
              ) : entry.kind === "bottom" ? (
                <ArrowDownIcon />
              ) : entry.kind === "user" ? (
                <span className="font-semibold text-brand not-italic">›</span>
              ) : (
                "•"
              )}
            </span>
            <span className="sr-only">
              {entry.kind === "user" ? "You said" : entry.kind === "assistant" ? "Pi said" : ""}
            </span>
            <span className={cn("min-w-0 flex-1 truncate", entry.kind === "user" && "text-ink")}>
              {entry.label}
            </span>
          </button>
        </li>
      ))}
    </UsageListPopover>
  );
}
