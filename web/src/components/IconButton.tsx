import type { ComponentProps } from "react";
import { PianoButton, PianoLinkButton } from "@/components/PianoButton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";

type Tip = {
  label: string;
  tooltip?: React.ReactNode;
  side?: ComponentProps<typeof TooltipContent>["side"];
};

export function IconButton({
  label,
  tooltip,
  side,
  variant = "ghost",
  size,
  ...props
}: ComponentProps<typeof PianoButton> &
  Tip & { size: NonNullable<ComponentProps<typeof PianoButton>["size"]> }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<PianoButton variant={variant} size={size} aria-label={label} {...props} />}
      />
      <TooltipContent side={side}>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  );
}

export function IconLink({
  label,
  tooltip,
  side,
  variant = "ghost",
  size,
  ...props
}: ComponentProps<typeof PianoLinkButton> &
  Tip & { size: NonNullable<ComponentProps<typeof PianoLinkButton>["size"]> }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<PianoLinkButton variant={variant} size={size} aria-label={label} {...props} />}
      />
      <TooltipContent side={side}>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  );
}
