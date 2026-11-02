import type { DialogResolution } from "@shared/wire";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/PianoPopover";
import { QuestionText } from "@/components/QuestionText";
import { StatusDot } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemHeader } from "@/components/ui/item";
import { answerReceipt, dialogTitle } from "@/lib/piDialogs";

/** The latest submitted reply and its delivery problem, never an addition to Pi’s history. */
export function AnsweredQuestion({ resolution }: { resolution: DialogResolution }) {
  const { answer } = resolution;
  if (!answer) return null;
  const { status, details } = answerReceipt(resolution);
  const value = typeof answer.value === "boolean" ? (answer.value ? "Yes" : "No") : answer.value;
  return (
    <section aria-label="Last answer" className="px-(--gutter) pt-3">
      <Item variant="outline" className="mx-auto max-w-3xl">
        {status && (
          <ItemHeader>
            <span role="status" className="flex items-center gap-2 text-xs text-ink-2">
              <StatusDot tone={status.tone} pulse={status.pulse} />
              {status.label}
            </span>
            {details && (
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
          <QuestionText text={dialogTitle(answer.title)} className="text-ink-2" />
          <p className="max-h-32 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words">
            {value || <span className="text-ink-2">Empty answer</span>}
          </p>
        </ItemContent>
      </Item>
    </section>
  );
}
