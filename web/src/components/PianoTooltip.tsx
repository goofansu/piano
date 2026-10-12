import { cn } from "cn";
import type { ComponentProps } from "react";
import {
  TooltipContent as BaseContent,
  TooltipTrigger as BaseTrigger,
} from "@/components/ui/tooltip";
import { anchoredMotion } from "@/lib/overlayStyles";
import { preventPointerFocus } from "@/lib/pointerClose";

export { Tooltip, TooltipProvider } from "@/components/ui/tooltip";

export function TooltipTrigger({ onFocus, ...props }: ComponentProps<typeof BaseTrigger>) {
  return (
    <BaseTrigger
      {...props}
      onFocus={(event) => {
        onFocus?.(event);
        preventPointerFocus(event);
      }}
    />
  );
}

export function TooltipContent({ className, ...props }: ComponentProps<typeof BaseContent>) {
  // The upstream arrow lives inside this stacking context; it needs no independent z-index patch.
  return (
    <BaseContent
      {...props}
      className={cn(
        anchoredMotion,
        "z-[60] duration-(--dur-hover) ease-(--ease-enter) zoom-in-[0.96] data-[state=closed]:zoom-out-[0.96]",
        className,
      )}
    />
  );
}
