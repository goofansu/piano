import { QuestionText } from "@features/sessions/web/dialogs/QuestionText";
import type { DialogResolution } from "@shared/wire";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemHeader } from "@/components/ui/item";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/shared/components/PianoPopover";
import { StatusDot } from "@/shared/components/StatusDot";
import { answerReceipt, dialogTitle } from "@/shared/state/dialogAnswer";

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
              <StatusDot tone={status.tone} />
              {status.label}
            </span>
            {details && (
              <Popover>
                <PopoverTrigger
                  render={
                    <Button variant="ghost" size="sm" aria-label="Answer details">
                      Details
                    </Button>
                  }
                />
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
