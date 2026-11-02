import { cn } from "cn";
import type { ComponentProps } from "react";
import {
  TooltipContent as BaseContent,
  TooltipTrigger as BaseTrigger,
} from "@/components/ui/tooltip";
import { pointerLast } from "@/lib/pointerClose";

export { Tooltip, TooltipProvider } from "@/components/ui/tooltip";

export function TooltipTrigger({ onFocus, ...props }: ComponentProps<typeof BaseTrigger>) {
  return (
    <BaseTrigger
      {...props}
      onFocus={(event) => {
        onFocus?.(event);
        // Focus restored after a pointer interaction opens no tooltip.
        if (pointerLast()) event.preventDefault();
      }}
    />
  );
}

export function TooltipContent({ className, ...props }: ComponentProps<typeof BaseContent>) {
  // The upstream arrow lives inside this stacking context; it needs no independent z-index patch.
  return <BaseContent data-motion="tooltip" {...props} className={cn("z-[60]", className)} />;
}
