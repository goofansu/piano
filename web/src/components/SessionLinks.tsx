import type { RenderMsg } from "@shared/wire";
import { cn } from "cn";
import { LinkIcon } from "lucide-react";
import { useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/PianoPopover";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { sessionLinks } from "@/lib/sessionLinks";
import { listRow } from "@/lib/styles";
import { useNavigation } from "@/lib/useNavigation";

interface Props {
  messages: ReadonlyArray<RenderMsg>;
}

/**
 * The web links the conversation mentions, opened from the usage row beside Jump to message. Each
 * opens in a new tab; nothing is previewed in Piano. The palette's "Links" command opens the same
 * popover through navigation. Absent while the session has none.
 */
export function SessionLinks({ messages }: Props) {
  const { settings, links: opened, openPanel, closeLinks } = useNavigation();
  const links = useMemo(() => sessionLinks(messages), [messages]);
  if (links.length === 0) return null;
  const open = !settings && opened;
  return (
    <>
      <Popover open={open} onOpenChange={(next) => (next ? openPanel("links") : closeLinks())}>
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
              <li key={link.url}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={closeLinks}
                  className={cn(listRow, "gap-3 px-4 py-1.5")}
                >
                  <span
                    className="flex w-4 shrink-0 items-center justify-center text-ink-3 [&_svg]:size-3.5"
                    aria-hidden
                  >
                    <LinkIcon />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink">{link.label}</span>
                  <span className="min-w-0 max-w-[45%] shrink-0 truncate font-mono text-xs text-ink-3">
                    {link.url}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      <Separator orientation="vertical" className="h-3!" />
    </>
  );
}
