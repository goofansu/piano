import { cn } from "cn";
import { PanelLeftCloseIcon, XIcon } from "lucide-react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { IconButton } from "@/components/IconButton";
import { PianoMark } from "@/components/PianoMark";
import { PianoSidebarReveal } from "@/components/PianoSidebarReveal";
import { SidebarHeader, SidebarProvider } from "@/components/ui/sidebar";
import { trackPointerDrag } from "@/lib/pointerDrag";
import { SIDEBAR_WIDTH } from "@/lib/sidebarLayout";
import { useSidebarLayout, useSidebarLayoutState } from "@/lib/useSidebarLayout";
import { useSidebarSwipe } from "@/lib/useSidebarSwipe";

/** Stock Sidebar's fixed+gap geometry cannot resize as one interruptible surface. Keep its
 * menu primitives/context, but own the width-bearing aside and the persistent main landmark.
 * The sidebar layout (lib/sidebarLayout) owns what is shown; this draws it and feeds it pointers. */
export function AppLayout({
  navigation,
  navigationTitle,
  content,
  aside,
  children,
}: {
  navigation: ReactNode;
  navigationTitle: string;
  content: ReactNode;
  /** The right sidebar, when one is open: a second sheet beside the conversation. */
  aside?: ReactNode;
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
    // The layout ends the drag on release, a collapse or a breakpoint change; listeners go with it.
    layout.startResize(
      startWidth,
      trackPointerDrag(event.pointerId, {
        move: (event) => layout.resizeTo(startWidth + event.clientX - startX),
        finish: () => layout.finishResize(),
        cancel: () => layout.cancelResize(),
      }),
    );
  };
  return (
    <SidebarProvider
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
        {/* Collapsed, the column has no width and no rail: each pane's header carries the control
            that brings it back. Visibility (not display:none) preserves scroll. */}
        <div className="relative h-full overflow-hidden">
          <div
            inert={collapsed}
            aria-hidden={collapsed}
            className={cn("h-full", collapsed && "invisible")}
            style={{ width }}
          >
            {navigation}
          </div>
        </div>
        {!collapsed && (
          // No standard shadcn resize handle supports drag-to-collapse with remembered pixel width.
          // biome-ignore lint/a11y/useSemanticElements: interactive window splitter, not a thematic break.
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
      {/* A viewport landmark, not a shadcn content Card with header/footer padding. */}
      <main
        ref={swipe.mainRef}
        data-slot="layout-main"
        data-motion="drawer"
        data-sidebar-dragging={swipe.dragging}
        style={swipe.style}
        className={cn(
          "relative flex min-w-0 flex-1 flex-col overflow-hidden bg-conversation md:my-(--pane-inset) md:mr-(--pane-inset) md:rounded-2xl md:border-(length:--pane-line) md:border-line md:shadow-1",
          // With the sidebar collapsed the pane keeps the gap the column gave it.
          collapsed && "md:ml-(--pane-inset)",
          // With the right sidebar open the two are one sheet, split by a hairline (RightSidebar).
          // The conversation keeps a readable column; the sidebar gives way when space runs short.
          "md:[&:has(~[data-slot=layout-panel])]:mr-0 md:[&:has(~[data-slot=layout-panel])]:min-w-[28rem] md:[&:has(~[data-slot=layout-panel])]:rounded-r-none md:[&:has(~[data-slot=layout-panel])]:border-r-0",
        )}
      >
        {content}
      </main>
      {aside}
      {children}
    </SidebarProvider>
  );
}

/** Removing the entrance class while hidden replays it on return without remounting children. */
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

/**
 * The sidebar's header, in the one header shape and no heavier: the hide control first, where
 * each pane's show control appears once the sidebar is collapsed, so the toggle never moves; a
 * title only when the sidebar is not the session list; then the pane's controls, its one primary
 * action last. The mark lives in the footer.
 */
export function LayoutHeader({ title, children }: { title?: string; children?: ReactNode }) {
  const { hide } = useSidebarLayout();
  return (
    // The sidebar shares the panes' gutter and, on desktop, the pane's inset and line, so the hide
    // control sits on the rows' left edge and, once collapsed, each pane's show control appears at
    // exactly the same point; its hairline is level with the pane header's, one band across the screen.
    <SidebarHeader className="h-16 shrink-0 flex-row items-center gap-2.5 border-b border-line px-(--gutter) md:mt-[calc(var(--pane-inset)+var(--pane-line))] md:pl-[calc(var(--gutter)+var(--pane-line))]">
      <IconButton label="Hide sidebar" onClick={hide}>
        <XIcon className="md:hidden" />
        <PanelLeftCloseIcon className="hidden md:block" />
      </IconButton>
      {title && <h2 className="text-sm font-medium">{title}</h2>}
      <span className="flex-1" />
      {children}
    </SidebarHeader>
  );
}

/** The sidebar's footer: its one plain action and the mark, which marks the app once, at rest. */
export function LayoutFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2 px-(--gutter) py-3">
      {children}
      <PianoMark className="mr-1 size-6 rounded-md shadow-none" />
    </div>
  );
}
