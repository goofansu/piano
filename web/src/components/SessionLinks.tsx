import type { RenderMsg } from "@shared/wire";
import { cn } from "cn";
import { LinkIcon, MessageSquareQuoteIcon } from "lucide-react";
import { useMemo } from "react";
import { IconButton } from "@/components/IconButton";
import { UsageListPopover } from "@/components/UsageListPopover";
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
 * opens in a new tab; nothing is previewed in Piano. Beside each, Jump to message scrolls the
 * transcript to the message that mentioned the link last. Absent while the session has none.
 */
export function SessionLinks({ messages, working = false }: Props) {
  const viewport = useTranscriptViewport();
  const links = useMemo(() => sessionLinks(messages), [messages]);
  // Fallback destinations, from the rows the transcript renders, like the jump list's entries.
  const entries = useMemo(
    () => jumpEntries(transcriptRows(messages, { working })),
    [messages, working],
  );
  if (links.length === 0) return null;
  const reveal = (link: SessionLink) => {
    for (const entry of revealEntries(messages, entries, link.messageId))
      if (viewport?.jump(entry)) return;
  };
  return (
    <UsageListPopover
      label="Links"
      icon={LinkIcon}
      count={links.length}
      noun={["link", "links"]}
      description="in the conversation"
    >
      {links.map((link) => (
        <li key={link.url} className="flex items-center pr-2">
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className={cn(listRow, "min-w-0 flex-1 py-1.5 pl-4 pr-2")}
          >
            {/* Two lines: links in one session mostly share a prefix, so a URL cut short
                after the host says nothing. The title, then the whole URL below it, both in
                mono like the Files rows and the file viewer. Every row is a link, so no
                glyph marks it as one. */}
            <span className="flex min-w-0 flex-1 flex-col">
              {link.label && <span className="truncate font-mono text-ink">{link.label}</span>}
              <span
                className={cn("truncate font-mono text-xs", link.label ? "text-ink-3" : "text-ink")}
              >
                {displayUrl(link.url)}
              </span>
            </span>
          </a>
          {/* A bubble with quote marks: the message this link was cited in. */}
          <IconButton
            size="list"
            label="Jump to message"
            side="left"
            className="shrink-0 text-ink-3"
            onClick={() => reveal(link)}
          >
            <MessageSquareQuoteIcon />
          </IconButton>
        </li>
      ))}
    </UsageListPopover>
  );
}
