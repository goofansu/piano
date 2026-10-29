import type { DialogResolution } from "@shared/wire";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/PianoPopover";
import { StatusDot, type StatusTone } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemHeader, ItemTitle } from "@/components/ui/item";

const delivery: Record<DialogResolution["delivery"], { label: string; tone: StatusTone } | null> = {
  pending: { label: "Sending answer…", tone: "busy" },
  written: null,
  uncertain: { label: "Delivery uncertain", tone: "warn" },
  "not-sent": { label: "Not sent", tone: "muted" },
};

/** The host's latest accepted reply, not an optimistic echo or an addition to Pi's history. */
export function AnsweredQuestion({ resolution }: { resolution: DialogResolution }) {
  const { answer } = resolution;
  if (!answer) return null;
  const status = delivery[resolution.delivery];
  const value = typeof answer.value === "boolean" ? (answer.value ? "Yes" : "No") : answer.value;
  return (
    <section aria-label="Last answer" className="px-(--gutter) pt-3">
      <Item variant="outline" className="mx-auto max-w-3xl">
        {status && (
          <ItemHeader>
            <span role="status" className="flex items-center gap-2 text-xs text-ink-2">
              <StatusDot tone={status.tone} pulse={resolution.delivery === "pending"} />
              {status.label}
            </span>
            {(resolution.delivery === "uncertain" || resolution.delivery === "not-sent") && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" aria-label="Answer details">
                    Details
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end">
                  <PopoverHeader>
                    <PopoverTitle>Answer details</PopoverTitle>
                    <PopoverDescription>{resolution.detail}</PopoverDescription>
                  </PopoverHeader>
                </PopoverContent>
              </Popover>
            )}
          </ItemHeader>
        )}
        <ItemContent className="min-w-0">
          <ItemTitle className="line-clamp-none whitespace-pre-wrap break-words">
            {answer.title || "Pi needs an answer"}
          </ItemTitle>
          <p className="max-h-32 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words">
            {value || <span className="text-ink-2">Empty answer</span>}
          </p>
        </ItemContent>
      </Item>
    </section>
  );
}
