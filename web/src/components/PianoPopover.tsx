import { cn } from "cn";
import type { ComponentProps } from "react";
import { PopoverContent as BaseContent } from "@/components/ui/popover";
import { keyboardFocusReturn } from "@/lib/pointerClose";
import { useExitFace } from "@/lib/useExitFace";

export {
  Popover,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

export function PopoverContent({
  className,
  finalFocus = keyboardFocusReturn,
  hideWhenDetached = false,
  still = false,
  ref,
  ...props
}: ComponentProps<typeof BaseContent> & { hideWhenDetached?: boolean; still?: boolean }) {
  const exitFace = useExitFace(ref);
  return (
    <BaseContent
      data-motion={still ? undefined : "anchored"}
      ref={still ? ref : exitFace}
      {...props}
      finalFocus={finalFocus}
      className={cn(
        "rounded-lg",
        hideWhenDetached &&
          "in-data-anchor-hidden:pointer-events-none in-data-anchor-hidden:invisible",
        className,
      )}
    />
  );
}
