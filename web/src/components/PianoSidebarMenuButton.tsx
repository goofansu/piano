import { cn } from "cn";
import type { ComponentProps } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/PianoTooltip";
import { sidebarRowClassName } from "@/components/SidebarSessionList";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";

/**
 * A row of the main sidebar's kind (the Projects row's): its height, ink and the parchment fill
 * while it is the current one. The fill is a class here, not an `index.css` rule on
 * `data-slot`, which the tooltip trigger rewrites. Sidebar tooltips keep the same pointer/keyboard
 * policy as other app controls.
 */
const row =
  "gap-1.5 text-ink-2 data-[active=true]:bg-(--selected) data-[active=true]:text-ink hover:data-[active=true]:bg-(--selected)";

export function PianoSidebarMenuButton({
  tooltip,
  className,
  ...props
}: ComponentProps<typeof SidebarMenuButton>) {
  const { isMobile, state } = useSidebar();
  const button = (
    <SidebarMenuButton className={cn(sidebarRowClassName, row, className)} {...props} />
  );
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
