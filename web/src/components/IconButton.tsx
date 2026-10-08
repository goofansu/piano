import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * An icon-only button with its tooltip. The accessible name is the tooltip's words unless the
 * tooltip adds a hint, so what a pointer reads and what a screen reader says stay the same.
 */
export function IconButton({ label, tooltip, side, variant = "ghost", size = "icon-sm", ...props }: ComponentProps<typeof Button> & {
  label: string;
  tooltip?: React.ReactNode;
  side?: ComponentProps<typeof TooltipContent>["side"];
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant={variant} size={size} aria-label={label} {...props} />
      </TooltipTrigger>
      <TooltipContent side={side}>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  );
}
