import { cn } from "cn";
import type { ComponentProps } from "react";
import { PopoverContent as BaseContent } from "@/components/ui/popover";
import { raisedLayer } from "@/lib/overlayStyles";
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
      positionerClassName={cn(
        raisedLayer,
        hideWhenDetached && "data-anchor-hidden:pointer-events-none data-anchor-hidden:invisible",
      )}
      ref={still ? ref : exitFace}
      {...props}
      finalFocus={finalFocus}
      className={cn("rounded-lg", className)}
    />
  );
}
