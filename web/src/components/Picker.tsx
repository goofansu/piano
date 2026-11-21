import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import { type ComponentProps, type RefObject, useRef } from "react";
import { CommandInput } from "@/components/PianoCommand";
import { PopoverContent } from "@/components/PianoPopover";

export function PickerContent({
  className,
  searchRef,
  ...props
}: ComponentProps<typeof PopoverContent> & { searchRef?: RefObject<HTMLInputElement | null> }) {
  const content = useRef<HTMLDivElement>(null);
  return (
    <PopoverContent
      ref={content}
      align="start"
      tabIndex={-1}
      className={cn(
        "max-h-(--available-height) w-[360px] max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto p-0",
        className,
      )}
      initialFocus={() =>
        (window.matchMedia("(pointer: coarse)").matches ? content.current : searchRef?.current) ??
        true
      }
      {...props}
    />
  );
}

export function PickerSearch({
  children,
  divider = true,
  ...props
}: ComponentProps<typeof CommandInput> & { divider?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center [&>[data-slot=command-input-wrapper]]:min-w-0 [&>[data-slot=command-input-wrapper]]:flex-1 [&>[data-slot=command-input-wrapper]]:border-b-0",
        divider && "border-b border-line",
      )}
    >
      <CommandInput {...props} />
      {children && <div className="mr-1 flex shrink-0 items-center text-ink-3">{children}</div>}
    </div>
  );
}

export function PickerCheck({ selected }: { selected: boolean }) {
  return (
    <CheckIcon aria-hidden className={cn("ml-auto", selected ? "opacity-100" : "opacity-0")} />
  );
}
