import { cn } from "cn";
import { PanelLeftOpenIcon } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useSidebarLayout } from "@/lib/useSidebarLayout";

/**
 * A page's way to the sidebar below the breakpoint, where the sidebar is a sheet. It offers itself
 * as where focus returns when the sheet closes and nothing better is left to focus.
 */
export function ShowSidebarButton({
  className,
  label = "Show sidebar",
  children = <PanelLeftOpenIcon />,
}: {
  className?: string;
  label?: string;
  children?: React.ReactNode;
}) {
  const layout = useSidebarLayout();
  const register = useCallback(
    (button: HTMLButtonElement | null) =>
      button ? layout.registerFocusFallback(button) : undefined,
    [layout],
  );
  return (
    <Button
      ref={register}
      variant="ghost"
      size="icon-sm"
      className={cn("md:hidden", className)}
      aria-label={label}
      onClick={layout.show}
    >
      {children}
    </Button>
  );
}
