import { cn } from "cn";
import type { ComponentProps } from "react";
import { PopoverContent as BaseContent } from "@/components/ui/popover";
import { raisedOverlay } from "@/lib/overlayStyles";
import { returnFocusForKeyboard } from "@/lib/pointerClose";

export {
  Popover,
  PopoverAnchor,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

/** A popover scales in from its trigger; `still` drops that for one opened by a shortcut. */
export function PopoverContent({
  className,
  onCloseAutoFocus,
  still = false,
  ...props
}: ComponentProps<typeof BaseContent> & { still?: boolean }) {
  return (
    <BaseContent
      data-motion={still ? undefined : "anchored"}
      {...props}
      className={cn(raisedOverlay, className)}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event);
        if (!event.defaultPrevented) returnFocusForKeyboard(event);
      }}
    />
  );
}
