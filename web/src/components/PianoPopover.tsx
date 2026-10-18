import { cn } from "cn";
import type { ComponentProps } from "react";
import { PopoverContent as BaseContent } from "@/components/ui/popover";
import { raisedOverlay } from "@/lib/overlayStyles";
import { returnFocusForKeyboard } from "@/lib/pointerClose";
import { useExitFace } from "@/lib/useExitFace";

export {
  Popover,
  PopoverAnchor,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

/** A popover scales in from its trigger and exits on its last open face; `still` drops that for
 * one opened by a shortcut. */
export function PopoverContent({
  className,
  onCloseAutoFocus,
  still = false,
  ref,
  ...props
}: ComponentProps<typeof BaseContent> & { still?: boolean }) {
  const exitFace = useExitFace(ref);
  return (
    <BaseContent
      data-motion={still ? undefined : "anchored"}
      ref={still ? ref : exitFace}
      {...props}
      className={cn(raisedOverlay, className)}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event);
        if (!event.defaultPrevented) returnFocusForKeyboard(event);
      }}
    />
  );
}
