import { cn } from "cn";
import { PanelLeftOpenIcon } from "lucide-react";
import { createContext, useCallback, useContext } from "react";
import {
  useSidebarLayout,
  useSidebarLayoutState,
} from "@/features/navigation/sidebar/useSidebarLayout";
import { IconButton } from "@/shared/components/IconButton";
import { HeaderLead } from "@/shared/components/Pane";
import { StatusDot } from "@/shared/components/StatusDot";

export const SidebarActivityContext = createContext(false);

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
    <IconButton
      ref={register}
      size="header"
      leading
      className={cn("relative", !collapsed && "md:hidden", className)}
      label={label}
      onClick={layout.show}
    >
      {children}
      {working && (
        <StatusDot
          tone="busy"
          className="absolute top-[calc(50%-9px)] left-[calc(var(--glyph-pad)+10px)]"
        />
      )}
    </IconButton>
  );
}

export function SidebarPaneLead() {
  const { collapsed } = useSidebarLayoutState();
  return <HeaderLead toggle={<ShowSidebarButton />} className={cn(!collapsed && "md:hidden")} />;
}
