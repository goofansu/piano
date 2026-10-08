import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import { type ComponentProps, type RefObject, useRef } from "react";
import { CommandInput } from "@/components/ui/command";
import { PopoverContent } from "@/components/ui/popover";

/**
 * The searchable pickers (folder, project, worktree, model) share one popover: one width, scrolling
 * inside the viewport, no padding of its own. Opening focuses the search field with a keyboard, and
 * the panel itself on a touch screen, so no software keyboard appears.
 */
export function PickerContent({ className, searchRef, ...props }: ComponentProps<typeof PopoverContent> & { searchRef?: RefObject<HTMLInputElement | null> }) {
  const content = useRef<HTMLDivElement>(null);
  return (
    <PopoverContent
      ref={content}
      align="start"
      tabIndex={-1}
      className={cn("max-h-(--radix-popover-content-available-height) w-[360px] max-w-[calc(100vw-2rem)] overflow-y-auto p-0", className)}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        if (window.matchMedia("(pointer: coarse)").matches) content.current?.focus({ preventScroll: true });
        else searchRef?.current?.focus({ preventScroll: true });
      }}
      {...props}
    />
  );
}

/** A picker's search row: the input takes the width and any action buttons sit at its end. */
export function PickerSearch({ children, ...props }: ComponentProps<typeof CommandInput>) {
  return (
    <div className="flex items-center border-b border-line [&>[data-slot=command-input-wrapper]]:min-w-0 [&>[data-slot=command-input-wrapper]]:flex-1 [&>[data-slot=command-input-wrapper]]:border-b-0">
      <CommandInput {...props} />
      {children && <div className="mr-1 flex shrink-0 items-center text-ink-3">{children}</div>}
    </div>
  );
}

/** The trailing check on a picker option: shown on the chosen one, invisible but space-keeping on the others. */
export function PickerCheck({ selected }: { selected: boolean }) {
  return <CheckIcon aria-hidden className={cn("ml-auto", selected ? "opacity-100" : "opacity-0")} />;
}
