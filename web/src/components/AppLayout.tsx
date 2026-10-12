import { cn } from "cn";
import { PanelLeftCloseIcon, PanelLeftOpenIcon, XIcon } from "lucide-react";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { IconButton } from "@/components/IconButton";
import { PianoMark } from "@/components/PianoMark";
import { Sheet, SheetContent, SheetTitle } from "@/components/PianoSheet";
import { TooltipProvider } from "@/components/PianoTooltip";
import { SidebarHeader, SidebarProvider } from "@/components/ui/sidebar";
import { readStorage, writeStorage } from "@/lib/storage";

const WIDTH = { min: 208, max: 480, default: 288, rail: 48, collapseBelow: 160 };
const desktop = () => matchMedia("(min-width: 768px)").matches;
const clampWidth = (width: number) => Math.min(WIDTH.max, Math.max(WIDTH.min, width));

/** One controller for page chrome and palette commands; navigation never owns layout state. */
export function useAppLayout() {
  const [collapsed, setCollapsedState] = useState(() => readStorage("piano.sidebar") === "hidden");
  const [width, setWidthState] = useState(() => {
    const saved = Number(readStorage("piano.sidebarWidth"));
    return saved >= WIDTH.min && saved <= WIDTH.max ? saved : WIDTH.default;
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const cancelResize = useRef<(() => void) | null>(null);
  const setCollapsed = useCallback((value: boolean) => {
    cancelResize.current?.();
    setCollapsedState(value);
    writeStorage("piano.sidebar", value ? "hidden" : "shown");
  }, []);
  const setWidth = useCallback((value: number) => {
    setWidthState(value);
    writeStorage("piano.sidebarWidth", String(value));
  }, []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const show = useCallback(() => {
    if (desktop()) setCollapsed(false);
    else {
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setMobileOpen(true);
    }
  }, [setCollapsed]);
  const hide = useCallback(() => {
    if (desktop()) setCollapsed(true);
    else closeMobile();
  }, [setCollapsed, closeMobile]);
  const toggle = useCallback(() => {
    if (desktop()) setCollapsed(!collapsed);
    else if (mobileOpen) closeMobile();
    else show();
  }, [collapsed, mobileOpen, setCollapsed, closeMobile, show]);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      cancelResize.current?.();
      const startWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? width;
      const startX = event.clientX;
      let last = startWidth;
      const pointerId = event.pointerId;
      const cleanup = () => {
        removeEventListener("pointermove", move);
        removeEventListener("pointerup", finish);
        removeEventListener("pointercancel", cancel);
        removeEventListener("blur", cancel);
        cancelResize.current = null;
        setDragging(false);
      };
      const cancel = () => {
        cleanup();
        setWidthState(width);
      };
      const move = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        last = startWidth + event.clientX - startX;
        setWidthState(clampWidth(last));
      };
      const finish = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        cleanup();
        if (last < WIDTH.collapseBelow) {
          setWidthState(width);
          setCollapsed(true);
        } else setWidth(clampWidth(last));
      };
      cancelResize.current = cancel;
      setWidthState(startWidth);
      setDragging(true);
      addEventListener("pointermove", move);
      addEventListener("pointerup", finish);
      addEventListener("pointercancel", cancel);
      addEventListener("blur", cancel);
    },
    [width, setWidth, setCollapsed],
  );

  useEffect(() => {
    const media = matchMedia("(min-width: 768px)");
    const changed = () => {
      cancelResize.current?.();
      closeMobile();
    };
    media.addEventListener("change", changed);
    return () => {
      media.removeEventListener("change", changed);
      cancelResize.current?.();
    };
  }, [closeMobile]);

  return {
    collapsed,
    width,
    dragging,
    mobileOpen,
    returnFocus,
    setCollapsed,
    closeMobile,
    show,
    hide,
    toggle,
    startResize,
    resetWidth: () => setWidth(WIDTH.default),
  };
}

type Layout = ReturnType<typeof useAppLayout>;

/** Stock Sidebar's fixed+gap geometry cannot resize as one interruptible surface. Keep its
 * menu primitives/context, but own the width-bearing aside and the persistent main landmark. */
export function AppLayout({
  layout,
  navigation,
  navigationTitle,
  content,
  children,
}: {
  layout: Layout;
  navigation: (compact: boolean) => ReactNode;
  navigationTitle: string;
  content: ReactNode;
  children?: ReactNode;
}) {
  return (
    <SidebarProvider
      open={!layout.collapsed}
      onOpenChange={(open) => layout.setCollapsed(!open)}
      className="relative h-dvh min-h-0 overflow-hidden bg-surface-0 text-ink"
    >
      <TooltipProvider delayDuration={300}>
        <aside
          data-slot="layout-sidebar"
          data-state={layout.collapsed ? "collapsed" : "expanded"}
          data-dragging={layout.dragging}
          className={cn(
            "relative hidden shrink-0 md:flex md:flex-col",
            !layout.dragging &&
              "transition-[width] duration-(--dur-layout) ease-(--ease-layout) motion-reduce:transition-none",
          )}
          style={{ width: layout.collapsed ? WIDTH.rail : layout.width }}
        >
          <div className="relative h-full overflow-hidden">
            {/* Visibility (not display:none) preserves scroll and avoids replaying first-load row animations. */}
            <div
              inert={layout.collapsed}
              aria-hidden={layout.collapsed}
              className={cn("h-full", layout.collapsed && "invisible")}
              style={{ width: layout.width }}
            >
              {navigation(false)}
            </div>
            {layout.collapsed && <div className="absolute inset-0">{navigation(true)}</div>}
          </div>
          {!layout.collapsed && (
            // No standard shadcn resize handle supports drag-to-collapse with remembered pixel width.
            // biome-ignore lint/a11y/useSemanticElements: interactive window splitter, not a thematic break.
            <div
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              aria-valuenow={layout.width}
              aria-valuemin={WIDTH.min}
              aria-valuemax={WIDTH.max}
              title="Drag to resize. Double-click to reset."
              onPointerDown={layout.startResize}
              onDoubleClick={layout.resetWidth}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  layout.resetWidth();
                }
              }}
              className={cn(
                "absolute inset-y-0 -right-1 z-10 w-2 touch-none cursor-col-resize select-none after:absolute after:inset-y-0 after:left-[3px] after:w-px after:bg-brand after:opacity-0 after:transition-opacity hover:after:opacity-100 focus-visible:after:opacity-100",
                layout.dragging && "after:opacity-100",
              )}
            />
          )}
        </aside>
        <Sheet
          open={layout.mobileOpen}
          onOpenChange={(open) => {
            if (open) layout.show();
            else layout.closeMobile();
          }}
        >
          <SheetContent
            side="left"
            className="h-dvh w-full border-0 bg-surface-0 p-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:max-w-none"
            showCloseButton={false}
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (event.currentTarget as HTMLElement | null)?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const target = layout.returnFocus.current;
              layout.returnFocus.current = null;
              // Navigation may have replaced the opener (or the command palette). Never focus hidden content.
              const fallback = [
                ...document.querySelectorAll<HTMLElement>('button[aria-label="Show sidebar"]'),
              ].find((element) => element.checkVisibility({ visibilityProperty: true }));
              if (target?.isConnected && target.checkVisibility({ visibilityProperty: true }))
                target.focus();
              else fallback?.focus();
            }}
          >
            <SheetTitle className="sr-only">{navigationTitle}</SheetTitle>
            {navigation(false)}
          </SheetContent>
        </Sheet>
        {/* A viewport landmark, not a shadcn content Card with header/footer padding. */}
        <main
          data-slot="layout-main"
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

export function LayoutHeader({
  onHide,
  title,
  children,
}: {
  onHide: () => void;
  title?: string;
  children?: ReactNode;
}) {
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
      <IconButton label="Hide sidebar" onClick={onHide}>
        <XIcon className="md:hidden" />
        <PanelLeftCloseIcon className="hidden md:block" />
      </IconButton>
    </SidebarHeader>
  );
}

export function LayoutRail({
  onShow,
  working = false,
  children,
  footer,
}: {
  onShow: () => void;
  working?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center gap-1 pt-2">
      <IconButton label="Show sidebar" side="right" onClick={onShow}>
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
