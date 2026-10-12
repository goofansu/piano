import { cn } from "cn";
import { PanelLeftCloseIcon, PanelLeftOpenIcon, XIcon } from "lucide-react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { IconButton } from "@/components/IconButton";
import { PianoMark } from "@/components/PianoMark";
import { PianoSidebarReveal, sidebarRevealStyle } from "@/components/PianoSidebarReveal";
import { TooltipProvider } from "@/components/PianoTooltip";
import { SidebarHeader, SidebarProvider } from "@/components/ui/sidebar";
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
  children,
}: {
  navigation: (compact: boolean) => ReactNode;
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
    const pointerId = event.pointerId;
    const move = (event: PointerEvent) => {
      if (event.pointerId === pointerId) layout.resizeTo(startWidth + event.clientX - startX);
    };
    const finish = (event: PointerEvent) => {
      if (event.pointerId === pointerId) layout.finishResize();
    };
    const cancel = () => layout.cancelResize();
    // The layout ends the drag on release, a collapse or a breakpoint change; listeners go with it.
    layout.startResize(startWidth, () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", finish);
      removeEventListener("pointercancel", cancel);
      removeEventListener("blur", cancel);
    });
    addEventListener("pointermove", move);
    addEventListener("pointerup", finish);
    addEventListener("pointercancel", cancel);
    addEventListener("blur", cancel);
  };
  return (
    <SidebarProvider
      open={!collapsed}
      onOpenChange={(open) => layout.setCollapsed(!open)}
      className="relative h-dvh min-h-0 overflow-hidden bg-surface-0 text-ink"
    >
      <TooltipProvider delayDuration={300}>
        <aside
          data-slot="layout-sidebar"
          data-state={collapsed ? "collapsed" : "expanded"}
          data-dragging={resizing}
          className={cn(
            "relative hidden shrink-0 md:flex md:flex-col",
            !resizing &&
              "transition-[width] duration-(--dur-layout) ease-(--ease-layout) motion-reduce:transition-none",
          )}
          style={{ width: collapsed ? SIDEBAR_WIDTH.rail : width }}
        >
          <div className="relative h-full overflow-hidden">
            {/* Visibility (not display:none) preserves scroll and avoids replaying first-load row animations. */}
            <div
              inert={collapsed}
              aria-hidden={collapsed}
              className={cn("h-full", collapsed && "invisible")}
              style={{ width }}
            >
              {navigation(false)}
            </div>
            {collapsed && <div className="absolute inset-0">{navigation(true)}</div>}
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
                "absolute inset-y-0 -right-1 z-10 w-2 touch-none cursor-col-resize select-none after:absolute after:inset-y-0 after:left-[3px] after:w-px after:bg-brand after:opacity-0 after:transition-opacity hover:after:opacity-100 focus-visible:after:opacity-100",
                resizing && "after:opacity-100",
              )}
            />
          )}
        </aside>
        <PianoSidebarReveal
          open={mobileOpen}
          dragging={swipe.dragging}
          progress={swipe.progress}
          settleDuration={swipe.settleDuration}
          settleEasing={swipe.settleEasing}
          onOpenChange={(open) => {
            swipe.cancelDrag();
            layout.setMobileOpen(open);
          }}
          contentRef={swipe.revealRef}
          title={navigationTitle}
        >
          {navigation(false)}
        </PianoSidebarReveal>
        {/* A viewport landmark, not a shadcn content Card with header/footer padding. */}
        <main
          ref={swipe.mainRef}
          data-slot="layout-main"
          data-sidebar-dragging={swipe.dragging}
          style={sidebarRevealStyle(swipe.progress, swipe.settleDuration, swipe.settleEasing)}
          className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-conversation md:my-2 md:mr-2 md:rounded-2xl md:border md:border-line md:shadow-1"
        >
          {content}
        </main>
        {children}
      </TooltipProvider>
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
      className={cn("min-h-0 flex-1 flex-col", active ? "view-enter flex" : "hidden")}
    >
      {children}
    </div>
  );
}

export function LayoutHeader({ title, children }: { title?: string; children?: ReactNode }) {
  const { hide } = useSidebarLayout();
  return (
    <SidebarHeader className="h-16 shrink-0 flex-row items-center gap-2.5 px-4">
      {title ? (
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      ) : (
        <>
          <PianoMark />
          <span className="text-lg font-semibold tracking-tight">Piano</span>
        </>
      )}
      <span className="flex-1" />
      {children}
      <IconButton label="Hide sidebar" onClick={hide}>
        <XIcon className="md:hidden" />
        <PanelLeftCloseIcon className="hidden md:block" />
      </IconButton>
    </SidebarHeader>
  );
}

export function LayoutRail({
  working = false,
  children,
  footer,
}: {
  working?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const { show } = useSidebarLayout();
  return (
    <div className="flex h-full flex-col items-center gap-1 pt-2">
      <IconButton label="Show sidebar" side="right" onClick={show}>
        <PanelLeftOpenIcon />
      </IconButton>
      {children}
      <div className="mt-auto flex flex-col items-center gap-3 pb-3">
        {footer}
        <PianoMark playing={working} className="size-6 rounded-md shadow-none" />
      </div>
    </div>
  );
}
