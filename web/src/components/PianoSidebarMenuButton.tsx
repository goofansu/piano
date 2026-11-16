import { cn } from "cn";
import type { ComponentProps } from "react";
import { sidebarRowClassName } from "@/components/SidebarSessionList";
import { SidebarMenuButton } from "@/components/ui/sidebar";

const row =
  "gap-1.5 text-ink-2 data-[active=true]:bg-(--selected) data-[active=true]:text-ink hover:data-[active=true]:bg-(--selected)";

export function PianoSidebarMenuButton({
  className,
  ...props
}: Omit<ComponentProps<typeof SidebarMenuButton>, "tooltip">) {
  return <SidebarMenuButton className={cn(sidebarRowClassName, row, className)} {...props} />;
}
