import type { RenderMsg } from "@shared/wire";
import { cn } from "cn";
import { ChevronLeftIcon, LinkIcon, MessageSquareQuoteIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "@/components/IconButton";
import { RowActions, rowActionsWidth } from "@/components/RowActions";
import { RailList, RailRowTitle, railRow } from "@/components/SessionRailList";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemDescription, ItemMedia } from "@/components/ui/item";
import { displayUrl, type SessionLink } from "@/lib/sessionLinks";
import { jumpEntries, revealEntries, transcriptRows } from "@/lib/transcript";
import { useNavigation } from "@/lib/useNavigation";
import { useTranscriptViewport } from "@/lib/useTranscriptViewport";

interface Props {
  /** The links in display order; the overview supplies its five most recent. */
  links: readonly SessionLink[];
  messages: ReadonlyArray<RenderMsg>;
  working?: boolean;
}

/**
 * The web links the conversation mentions, listed in the session rail once there is one. Each
 * row opens in a new tab, its title over its domain (or a bare URL); nothing is previewed in Piano.
 * Beside each, Jump to message scrolls the transcript, beside the rail, to the message that
 * mentioned the link last.
 */
export function SessionLinks({ links, messages, working = false }: Props) {
  const viewport = useTranscriptViewport();
  const navigation = useNavigation();
  // Fallback destinations, from the rows the transcript renders, like the jump list's entries.
  const entries = useMemo(
    () => jumpEntries(transcriptRows(messages, { working })),
    [messages, working],
  );
  const reveal = (link: SessionLink, animate: boolean) => {
    // A narrow rail covers the conversation; reveal the destination before jumping to it.
    if (navigation.single) navigation.showAgent();
    for (const entry of revealEntries(messages, entries, link.messageId))
      if (viewport?.jump(entry, { animate })) return;
  };
  return (
    <RailList aria-label="Links">
      {links.map((link) => (
        <Item
          key={link.url}
          size="sm"
          data-row
          role="listitem"
          className={cn(
            railRow,
            rowActionsWidth.list[1],
            "relative hover:bg-fill-hover focus-within:bg-fill-hover",
          )}
        >
          {/* The link covers the row up to its action, so the whole row reads as one target. */}
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            title={link.url}
            className="flex min-w-0 flex-1 items-center gap-2.5 outline-none pointer-coarse:min-h-11"
          >
            <ItemMedia variant="icon" className="text-ink-3">
              <LinkIcon />
            </ItemMedia>
            <ItemContent data-motion="yield" className="min-w-0 gap-0">
              {link.label ? (
                <>
                  <RailRowTitle className="truncate">{link.label}</RailRowTitle>
                  <ItemDescription className="line-clamp-none block truncate font-mono text-xs text-ink-3">
                    {linkHost(link.url)}
                  </ItemDescription>
                </>
              ) : (
                <RailRowTitle className="truncate font-mono">{displayUrl(link.url)}</RailRowTitle>
              )}
            </ItemContent>
          </a>
          <RowActions className="top-1/2 right-1 -translate-y-1/2">
            {/* A bubble with quote marks: the message this link was cited in. */}
            <IconButton
              size="list"
              label="Jump to message"
              side="left"
              className="text-ink-3"
              onClick={(event) => reveal(link, event.detail > 0)}
            >
              <MessageSquareQuoteIcon />
            </IconButton>
          </RowActions>
        </Item>
      ))}
    </RailList>
  );
}

/** Markdown can contain incomplete URLs, particularly while a reply is streaming. */
function linkHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return displayUrl(url);
  }
}

/** A focused view in the rail, not a modal: the conversation stays available for Jump to message. */
export function SessionLinksBrowser({
  links,
  messages,
  working,
  onBack,
  focusSearch = true,
}: Props & { onBack: () => void; focusSearch?: boolean }) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Keep the order the user opened. Newly mentioned URLs append, and repeated mentions update
  // their destination without moving the row under someone's pointer or keyboard focus.
  const [order, setOrder] = useState(() => links.map((link) => link.url));
  useEffect(() => {
    // Browsing the narrow sheet is not a request to type: keep the software keyboard down.
    (focusSearch ? searchRef.current : backRef.current)?.focus();
  }, [focusSearch]);
  useEffect(() => {
    setOrder((previous) => {
      const known = new Set(previous);
      const added = links.filter((link) => !known.has(link.url)).map((link) => link.url);
      return added.length ? [...previous, ...added] : previous;
    });
  }, [links]);
  const byUrl = new Map(links.map((link) => [link.url, link]));
  const needle = query.trim().toLowerCase();
  const visible = order.flatMap((url) => {
    const link = byUrl.get(url);
    return link && `${link.label ?? ""} ${link.url}`.toLowerCase().includes(needle) ? [link] : [];
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pt-3">
      {/* No shadcn primitive is a rail header: back navigation, then title and count. */}
      <div className="flex min-h-8 shrink-0 items-center gap-2 pointer-coarse:min-h-11">
        <IconButton ref={backRef} size="header" label="Back to overview" onClick={onBack}>
          <ChevronLeftIcon />
        </IconButton>
        <h2 className="flex flex-1 items-center gap-2 text-sm font-medium">
          Links <span className="text-xs font-normal text-ink-3">{links.length}</span>
        </h2>
      </div>
      <Input
        ref={searchRef}
        type="search"
        aria-label="Search links"
        className="pointer-coarse:h-11"
        placeholder="Search links"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          if (listRef.current) listRef.current.scrollTop = 0;
        }}
      />
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
        {visible.length ? (
          <SessionLinks links={visible} messages={messages} working={working} />
        ) : (
          <Empty role="status">
            <EmptyHeader>
              <EmptyDescription>No links found</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  );
}
