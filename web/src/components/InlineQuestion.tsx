import type { Dialog } from "@shared/wire";
import { useId, useSyncExternalStore } from "react";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/PianoPopover";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { Client } from "@/lib/client";
import { type PendingDialogs, questionReplies } from "@/lib/piDialogs";
import { useDialogAnswer } from "@/lib/useDialogAnswer";

/** The queue head alone owns the answer surface; confirmations stay in DialogHost. */
export function InlineQuestion({
  pending: { head, surface, more, attachment, session },
  send,
}: {
  pending: PendingDialogs;
  send: Client["send"];
}) {
  return head && surface === "inline" ? (
    <Question
      key={`${head.generation}/${head.id}`}
      dialog={head}
      more={more}
      attachment={attachment}
      session={session}
      send={send}
    />
  ) : null;
}

function Question({
  dialog: d,
  more,
  attachment,
  session,
  send,
}: {
  dialog: Dialog;
  more: number;
  attachment: string | null;
  session: string | null;
  send: Client["send"];
}) {
  const id = useId();
  // The reply outlives this view (another session shown, a resync) while the question stays open.
  const reply = useSyncExternalStore(questionReplies.subscribe, () =>
    questionReplies.get(session, d),
  );
  const setReply = (next: string) => questionReplies.set(session, d, next);
  const { answer, cancel, abort, submitted, disabled, abortDisabled, title, deadline, waiting } =
    useDialogAnswer(d, attachment, send);
  const choice = d.method === "select";
  // Indices distinguish an unselected group from an option whose value is an empty string.
  const [value, selected] = choice ? ["", reply] : [reply, ""];

  return (
    <section aria-label="Question" className="px-(--gutter) pt-3">
      <form
        aria-labelledby={`${id}-title`}
        className="mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-md border border-line bg-surface-1 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (choice && !selected) return;
          answer({ value: choice ? d.options?.[Number(selected) - 1] : value });
        }}
      >
        <FieldSet disabled={disabled} className="min-w-0 gap-3">
          <FieldLegend id={`${id}-title`} variant="label" className="break-words">
            {title}
          </FieldLegend>
          <FieldGroup className="max-h-[min(16rem,35dvh)] gap-3 overflow-y-auto overscroll-contain p-1">
            {d.message && (
              <FieldDescription className="whitespace-pre-wrap break-words">
                {d.message}
              </FieldDescription>
            )}
            {choice ? (
              <RadioGroup
                aria-labelledby={`${id}-title`}
                value={selected}
                onValueChange={setReply}
                disabled={disabled}
              >
                {(d.options ?? []).map((option, index) => (
                  <Field
                    // biome-ignore lint/suspicious/noArrayIndexKey: Pi's immutable option strings may repeat.
                    key={`${index}-${option}`}
                    orientation="horizontal"
                    data-disabled={disabled}
                  >
                    <RadioGroupItem id={`${id}-${index}`} value={String(index + 1)} />
                    <FieldLabel
                      htmlFor={`${id}-${index}`}
                      className="min-w-0 flex-1 whitespace-pre-wrap break-words py-2"
                    >
                      {option}
                    </FieldLabel>
                  </Field>
                ))}
              </RadioGroup>
            ) : (
              <Field data-disabled={disabled}>
                {d.method === "editor" ? (
                  <Textarea
                    aria-labelledby={`${id}-title`}
                    value={value}
                    onChange={(event) => setReply(event.target.value)}
                    className="min-h-24"
                  />
                ) : (
                  <Input
                    aria-labelledby={`${id}-title`}
                    value={value}
                    onChange={(event) => setReply(event.target.value)}
                  />
                )}
              </Field>
            )}
          </FieldGroup>
        </FieldSet>
        <div className="flex flex-wrap items-center gap-2">
          {/* A question its tool call owns has no deadline to report, and the composer's Stop is
              its escape; only an estimated deadline is a fact worth a popover. */}
          {deadline && (
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="ghost" size="sm">
                  Details
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start">
                <PopoverHeader>
                  <PopoverTitle>Question details</PopoverTitle>
                  <PopoverDescription>
                    {deadline.label}: {deadline.remainingSeconds}s remaining. Pi may have already
                    closed this question; it sends no closure acknowledgement.
                  </PopoverDescription>
                </PopoverHeader>
                {d.placeholder && (
                  <p className="whitespace-pre-wrap break-words text-sm">{d.placeholder}</p>
                )}
                <p className="text-sm text-ink-2">
                  Abort current stops Pi’s current work and cancels waiting questions. Queued
                  messages are kept.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={abortDisabled}
                  onClick={abort}
                >
                  Abort current
                </Button>
              </PopoverContent>
            </Popover>
          )}
          {more > 0 && (
            <span className="text-xs text-ink-2">
              {more} more {more === 1 ? "question" : "questions"}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" disabled={disabled} onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={disabled || (choice && !selected)}>
              Send answer
            </Button>
          </div>
        </div>
        {submitted && (
          <p role="status" className="text-sm text-ink-2">
            {waiting}
          </p>
        )}
      </form>
    </section>
  );
}
