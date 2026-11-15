import { cn } from "cn";
import type { ComponentProps } from "react";
import { sidebarRowClassName } from "@/components/SidebarSessionList";
import { SidebarMenuButton } from "@/components/ui/sidebar";

/**
 * A row of the main sidebar's kind (the Projects row's): its height, ink and the parchment fill
 * while it is the current one. Rows show their label, so they take no tooltip: the stock collapsed
 * icon rail that would need one never draws, because a collapsed Piano sidebar has no width.
 */
const row =
  "gap-1.5 text-ink-2 data-[active=true]:bg-(--selected) data-[active=true]:text-ink hover:data-[active=true]:bg-(--selected)";

export function PianoSidebarMenuButton({
  className,
  ...props
}: Omit<ComponentProps<typeof SidebarMenuButton>, "tooltip">) {
  return <SidebarMenuButton className={cn(sidebarRowClassName, row, className)} {...props} />;
}
