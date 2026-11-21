import { PianoSidebarReveal } from "@features/navigation/web/sidebar/PianoSidebarReveal";
import { SIDEBAR_WIDTH } from "@features/navigation/web/sidebar/sidebarLayout";
import {
  useSidebarLayout,
  useSidebarLayoutState,
} from "@features/navigation/web/sidebar/useSidebarLayout";
import { useSidebarSwipe } from "@features/navigation/web/sidebar/useSidebarSwipe";
import { cn } from "cn";
import { PanelLeftCloseIcon } from "lucide-react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { SidebarHeader, SidebarProvider } from "@/components/ui/sidebar";
import { IconButton } from "@/shared/components/IconButton";
import { HeaderLead, paneHeaderRow } from "@/shared/components/Pane";
import { PianoMark } from "@/shared/components/PianoMark";
import { trackPointerDrag } from "@/shared/lib/pointerDrag";

export function AppLayout({
  navigation,
  navigationTitle,
  content,
  children,
}: {
  navigation: ReactNode;
  navigationTitle: string;
  content: ReactNode;
  children?: ReactNode;
}) {
  const layout = useSidebarLayout();
  const { collapsed, width, resizing, mobileOpen } = useSidebarLayoutState();
  const swipe = useSidebarSwipe({
    open: mobileOpen,
    mobile: () => !layout.desktop(),
    onOpenChange: layout.setMobileOpen,
    onPreview: layout.previewMobile,
  });
  const startResize = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? width;
    const startX = event.clientX;
    layout.startResize(
      startWidth,
      trackPointerDrag(event.currentTarget, event.pointerId, {
        move: (event) => layout.resizeTo(startWidth + event.clientX - startX),
        finish: () => layout.finishResize(),
        cancel: () => layout.cancelResize(),
      }),
    );
  };
  return (
    <SidebarProvider
      keyboardShortcut={false}
      open={!collapsed}
      onOpenChange={(open) => layout.setCollapsed(!open)}
      className="relative h-dvh min-h-0 overflow-hidden bg-surface-0 text-ink"
    >
      <aside
        data-slot="layout-sidebar"
        data-state={collapsed ? "collapsed" : "expanded"}
        data-dragging={resizing}
        className="relative hidden shrink-0 md:flex md:flex-col"
        style={{ width: collapsed ? 0 : width }}
      >
        <div className="relative h-full overflow-hidden">
          <div
            inert={collapsed}
            aria-hidden={collapsed}
            className={cn("h-full py-(--pane-frame) pl-(--pane-frame)", collapsed && "invisible")}
            style={{ width }}
          >
            {navigation}
          </div>
        </div>
        {!collapsed && (
          <div
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            aria-valuenow={width}
            aria-valuemin={SIDEBAR_WIDTH.min}
            aria-valuemax={SIDEBAR_WIDTH.max}
            title="Drag to resize. Double-click to reset."
            onPointerDown={startResize}
            onDoubleClick={layout.resetWidth}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                layout.resetWidth();
              }
            }}
            className={cn(
              "absolute inset-y-0 -right-1 z-10 w-2 touch-none cursor-col-resize select-none after:absolute after:inset-y-0 after:left-[3px] after:w-px after:bg-brand after:opacity-0 hover:after:opacity-100 focus-visible:after:opacity-100",
              resizing && "after:opacity-100",
            )}
          />
        )}
      </aside>
      <PianoSidebarReveal
        open={mobileOpen}
        dragging={swipe.dragging}
        style={swipe.style}
        onOpenChange={(open) => {
          swipe.cancelDrag();
          layout.setMobileOpen(open);
        }}
        contentRef={swipe.revealRef}
        title={navigationTitle}
      >
        {navigation}
      </PianoSidebarReveal>
      <main
        ref={swipe.mainRef}
        data-slot="layout-main"
        data-motion="drawer"
        data-sidebar-dragging={swipe.dragging}
        style={swipe.style}
        className={cn(
          "relative flex min-w-0 flex-1 flex-col overflow-hidden bg-conversation md:my-(--pane-inset) md:mr-(--pane-inset) md:rounded-2xl md:border-(length:--pane-line) md:border-line md:shadow-1",
          collapsed && "md:ml-(--pane-inset)",
        )}
      >
        {content}
      </main>
      {children}
    </SidebarProvider>
  );
}

export function LayoutView({ active = true, children }: { active?: boolean; children: ReactNode }) {
  return (
    <div
      data-slot="layout-view"
      data-active={active}
      hidden={!active}
      className={cn("min-h-0 flex-1 flex-col", active ? "flex" : "hidden")}
    >
      {children}
    </div>
  );
}

export function LayoutHeader({ children }: { children?: ReactNode }) {
  const { hide } = useSidebarLayout();
  return (
    <SidebarHeader className={cn(paneHeaderRow, "flex-row gap-1 border-b-0")}>
      <HeaderLead
        className="min-w-0 flex-1"
        toggle={
          <IconButton size="header" leading label="Hide sidebar" onClick={hide}>
            <PanelLeftCloseIcon />
          </IconButton>
        }
      />
      {children}
    </SidebarHeader>
  );
}

export function LayoutFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2 px-(--row-inset) py-3">
      {children}
      <PianoMark className="mr-1 size-6 rounded-md shadow-none" />
    </div>
  );
}
