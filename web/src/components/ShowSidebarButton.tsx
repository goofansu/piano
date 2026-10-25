import { cn } from "cn";
import { PanelLeftOpenIcon } from "lucide-react";
import { createContext, useCallback, useContext } from "react";
import { PianoButton } from "@/components/PianoButton";
import { StatusDot } from "@/components/StatusDot";
import { useSidebarLayout, useSidebarLayoutState } from "@/lib/useSidebarLayout";

/** Whether any session's Pi is working: the one signal the hidden sidebar's rows would have shown. */
export const SidebarActivityContext = createContext(false);

/**
 * A page's way to the sidebar while it is out of sight: below the breakpoint, where the sidebar is
 * a sheet, and on desktop once it is collapsed. It sits where the sidebar's hide control was (both in the pane's frame), so
 * the toggle stands still across the collapse; it leads, so its glyph stays there when the touch
 * target grows. While any session works it carries the busy dot, since the rows that
 * would say so are hidden. It offers itself as where focus returns when the sheet closes and
 * nothing better is left to focus.
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
  const { collapsed } = useSidebarLayoutState();
  const working = useContext(SidebarActivityContext);
  const register = useCallback(
    (button: HTMLButtonElement | null) =>
      button ? layout.registerFocusFallback(button) : undefined,
    [layout],
  );
  return (
    <PianoButton
      ref={register}
      variant="ghost"
      size="header"
      leading
      className={cn("relative", !collapsed && "md:hidden", className)}
      aria-label={label}
      onClick={layout.show}
    >
      {children}
      {working && <StatusDot tone="busy" pulse className="absolute top-1.5 right-1.5" />}
    </PianoButton>
  );
}
