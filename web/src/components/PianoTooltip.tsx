import type { ComponentProps } from "react";
import { TooltipContent as BaseContent } from "@/components/ui/tooltip";
import { raisedLayer } from "@/lib/overlayStyles";

export { Tooltip, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function TooltipContent({ sideOffset = 10, ...props }: ComponentProps<typeof BaseContent>) {
  return (
    <BaseContent
      data-motion="tooltip"
      positionerClassName={raisedLayer}
      sideOffset={sideOffset}
      {...props}
    />
  );
}
