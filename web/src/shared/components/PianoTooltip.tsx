import type { ComponentProps } from "react";
import { TooltipContent as BaseContent } from "@/components/ui/tooltip";

export { Tooltip, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function TooltipContent({ sideOffset = 10, ...props }: ComponentProps<typeof BaseContent>) {
  return <BaseContent data-motion="tooltip" sideOffset={sideOffset} {...props} />;
}
