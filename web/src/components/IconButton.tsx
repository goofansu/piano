import type { ComponentProps } from "react";
import { PianoButton } from "@/components/PianoButton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";

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
