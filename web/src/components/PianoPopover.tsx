import { cn } from "cn";
import type { ComponentProps } from "react";
import { PopoverContent as BaseContent } from "@/components/ui/popover";
import { anchoredMotion, raisedOverlay } from "@/lib/overlayStyles";
import { returnFocusForKeyboard } from "@/lib/pointerClose";

export {
  Popover,
  PopoverAnchor,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

export function PopoverContent({
  className,
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof BaseContent>) {
  return (
    <BaseContent
      {...props}
      className={cn(anchoredMotion, raisedOverlay, className)}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event);
        if (!event.defaultPrevented) returnFocusForKeyboard(event);
      }}
    />
  );
}
