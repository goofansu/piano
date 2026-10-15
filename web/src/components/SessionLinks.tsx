import type { RenderMsg } from "@shared/wire";
import { cn } from "cn";
import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/PianoPopover";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { displayUrl, type SessionLink, sessionLinks } from "@/lib/sessionLinks";
import { listRow } from "@/lib/styles";
import { jumpEntries, revealEntries, transcriptRows } from "@/lib/transcript";
import { useTranscriptViewport } from "@/lib/useTranscriptViewport";

interface Props {
  messages: ReadonlyArray<RenderMsg>;
  working?: boolean;
}

/**
 * The web links the conversation mentions, opened from the usage row beside Jump to message. Each
 * opens in a new tab; nothing is previewed in Piano. Beside each, Jump scrolls the transcript to
 * the message that mentioned the link last. Absent while the session has none.
 */
export function SessionLinks({ messages, working = false }: Props) {
  const [open, setOpen] = useState(false);
  const viewport = useTranscriptViewport();
  const links = useMemo(() => sessionLinks(messages), [messages]);
  // Fallback destinations, from the rows the transcript renders, like the jump list's entries.
  const entries = useMemo(
    () => jumpEntries(transcriptRows(messages, { working })),
    [messages, working],
  );
  if (links.length === 0) return null;
  const reveal = (link: SessionLink) => {
    setOpen(false);
    for (const entry of revealEntries(messages, entries, link.messageId))
      if (viewport?.jump(entry)) return;
  };
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Links"
            aria-description={`${links.length} ${links.length === 1 ? "link" : "links"} in the conversation`}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="gap-1 px-1.5 font-mono text-xs font-normal text-ink-2 data-[state=open]:bg-fill-hover data-[state=open]:text-ink"
          >
            {links.length} {links.length === 1 ? "link" : "links"}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          collisionPadding={16}
          aria-label="Links"
          className="w-[28rem] max-w-[calc(100vw-2rem)] gap-0 p-0 font-sans"
        >
          <p className="border-b border-line px-4 py-2.5 text-sm font-medium">Links</p>
          <ul className="max-h-[min(24rem,var(--radix-popover-content-available-height,60dvh))] overflow-y-auto py-1">
            {links.map((link) => (
              <li key={link.url} className="flex items-center pr-2">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setOpen(false)}
                  className={cn(listRow, "min-w-0 flex-1 py-1.5 pl-4 pr-2")}
                >
                  {/* Two lines: links in one session mostly share a prefix, so a URL cut short
                      after the host says nothing. The title, then the whole URL below it. Every
                      row is a link, so no glyph marks it as one. */}
                  <span className="flex min-w-0 flex-1 flex-col">
                    {link.label && <span className="truncate text-ink">{link.label}</span>}
                    <span
                      className={cn(
                        "truncate font-mono text-xs",
                        link.label ? "text-ink-3" : "text-ink",
                      )}
                    >
                      {displayUrl(link.url)}
                    </span>
                  </span>
                </a>
                {/* The word, as Slack and Discord jump to a message, not a glyph: none means it. */}
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label="Jump to message"
                  className="shrink-0 text-ink-3"
                  onClick={() => reveal(link)}
                >
                  Jump
                </Button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      <Separator orientation="vertical" className="h-3!" />
    </>
  );
}
