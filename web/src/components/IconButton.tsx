import type { ComponentProps } from "react";
import { PianoButton } from "@/components/PianoButton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";

/**
 * An icon-only button with its tooltip. The accessible name is the tooltip's words unless the
 * tooltip adds a hint, so what a pointer reads and what a screen reader says stay the same. `size`
 * names the place it sits in (see `PianoButton`); a one-off control passes a shadcn size.
 */
export function IconButton({
  label,
  tooltip,
  side,
  variant = "ghost",
  size,
  ...props
}: ComponentProps<typeof PianoButton> & {
  label: string;
  tooltip?: React.ReactNode;
  side?: ComponentProps<typeof TooltipContent>["side"];
  size: NonNullable<ComponentProps<typeof PianoButton>["size"]>;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PianoButton variant={variant} size={size} aria-label={label} {...props} />
      </TooltipTrigger>
      <TooltipContent side={side}>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  );
}
