import type { RenderMsg } from "@shared/wire";
import { cn } from "cn";
import { LinkIcon, MessageSquareQuoteIcon } from "lucide-react";
import { useMemo } from "react";
import { DetailsList, DetailsRowTitle, detailsRow } from "@/components/DetailsList";
import { IconButton } from "@/components/IconButton";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia } from "@/components/ui/item";
import { displayUrl, type SessionLink } from "@/lib/sessionLinks";
import { jumpEntries, revealEntries, transcriptRows } from "@/lib/transcript";
import { useTranscriptViewport } from "@/lib/useTranscriptViewport";

interface Props {
  /** The conversation's links (`sessionLinks`), in conversation order; the caller shows the section only with some. */
  links: readonly SessionLink[];
  messages: ReadonlyArray<RenderMsg>;
  working?: boolean;
}

/**
 * The web links the conversation mentions, listed in the session rail once there is one. Each
 * row is a link that opens in a new tab, its title over its URL; nothing is previewed in Piano.
 * Beside each, Jump to message scrolls the transcript, beside the rail, to the message that
 * mentioned the link last.
 */
export function SessionLinks({ links, messages, working = false }: Props) {
  const viewport = useTranscriptViewport();
  // Fallback destinations, from the rows the transcript renders, like the jump list's entries.
  const entries = useMemo(
    () => jumpEntries(transcriptRows(messages, { working })),
    [messages, working],
  );
  const reveal = (link: SessionLink) => {
    for (const entry of revealEntries(messages, entries, link.messageId))
      if (viewport?.jump(entry)) return;
  };
  return (
    <DetailsList aria-label="Links">
      {links.map((link) => (
        <Item
          key={link.url}
          size="sm"
          className={cn(
            detailsRow,
            "pr-1 has-[a:hover]:bg-fill-hover has-[a:focus-visible]:bg-fill-hover",
          )}
        >
          {/* The link covers the row up to its action, so the whole row reads as one target. */}
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="flex min-w-0 flex-1 items-center gap-2.5 outline-none"
          >
            <ItemMedia variant="icon" className="text-ink-3">
              <LinkIcon />
            </ItemMedia>
            <ItemContent className="min-w-0 gap-0">
              {link.label ? (
                <>
                  <DetailsRowTitle className="truncate">{link.label}</DetailsRowTitle>
                  <ItemDescription className="line-clamp-none block truncate font-mono text-xs text-ink-3">
                    {displayUrl(link.url)}
                  </ItemDescription>
                </>
              ) : (
                <DetailsRowTitle className="truncate font-mono">
                  {displayUrl(link.url)}
                </DetailsRowTitle>
              )}
            </ItemContent>
          </a>
          <ItemActions>
            {/* A bubble with quote marks: the message this link was cited in. */}
            <IconButton
              size="list"
              label="Jump to message"
              side="left"
              className="text-ink-3"
              onClick={() => reveal(link)}
            >
              <MessageSquareQuoteIcon />
            </IconButton>
          </ItemActions>
        </Item>
      ))}
    </DetailsList>
  );
}
