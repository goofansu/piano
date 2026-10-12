import type { ComponentProps } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";

/** Keep sidebar tooltips on the same pointer/keyboard policy as other app controls. */
export function PianoSidebarMenuButton({
  tooltip,
  ...props
}: ComponentProps<typeof SidebarMenuButton>) {
  const { isMobile, state } = useSidebar();
  const button = <SidebarMenuButton {...props} />;
  if (!tooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
        {...(typeof tooltip === "string" ? { children: tooltip } : tooltip)}
      />
    </Tooltip>
  );
}
