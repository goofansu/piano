import { cn } from "cn";
import { XIcon } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useState,
} from "react";
import { IconButton } from "@/components/IconButton";
import { Sheet, SheetContent, SheetTitle } from "@/components/PianoSheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { clampPanelWidth, PANEL_WIDTH, readPanelWidth, writePanelWidth } from "@/lib/panelLayout";
import { trackPointerDrag } from "@/lib/pointerDrag";

/** The viewers own native button and media keys, not the composer's type-to-focus hook. */
const ownKeys = (event: ReactKeyboardEvent<HTMLElement>) => {
  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey)
    event.stopPropagation();
};

/**
 * The right sidebar: a session's Changes or an open file. On desktop it shares the conversation's
 * sheet, split off by a hairline as Linear's side panel is, resizable from that edge and
 * remembered; below the breakpoint it is a full-width sheet over the page. Hand-written: stock
 * Sidebar's fixed geometry cannot sit in flow beside the inset conversation (see AppLayout), and
 * no shadcn panel is nonmodal.
 */
export function RightSidebar({
  label,
  title,
  header,
  description,
  actions,
  toolbar,
  footer,
  close,
  children,
}: {
  /** The landmark's accessible name ("Changes", "File viewer"). */
  label: string;
  title: ReactNode;
  /** A viewer-specific heading; the shell still owns scrolling, sizing and dismissal. */
  header?: ReactNode;
  /** Secondary words under the title. */
  description?: ReactNode;
  /** Controls at the header's end, before Close. */
  actions?: ReactNode;
  /** View controls in a row below the title at every width. */
  toolbar?: ReactNode;
  footer?: ReactNode;
  close: () => void;
  children: ReactNode;
}) {
  const mobile = useIsMobile();
  const frame = (
    <>
      {header ?? (
        <PanelHeader label={label} close={close} actions={actions}>
          <h2 className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">{title}</h2>
          {description && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-ink-3">
              {description}
            </div>
          )}
        </PanelHeader>
      )}
      {toolbar && (
        <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line pr-2 pl-4">
          {toolbar}
        </div>
      )}
      <div data-slot="panel-body" className="relative min-h-0 flex-1 overflow-auto">
        {children}
      </div>
      {footer && <footer className="shrink-0 border-t border-line px-4 py-3">{footer}</footer>}
    </>
  );
  if (mobile)
    return (
      <Sheet open onOpenChange={(open) => !open && close()}>
        <SheetContent
          side="right"
          showCloseButton={false}
          aria-describedby={undefined}
          className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none"
          onKeyDown={ownKeys}
        >
          <SheetTitle className="sr-only">{label}</SheetTitle>
          {frame}
        </SheetContent>
      </Sheet>
    );
  return <DesktopColumn label={label} close={close} frame={frame} />;
}

/** The panel's header, shaped like the session header: a title with a line beneath it, then controls, then Close. */
export function PanelHeader({
  label,
  actions,
  close,
  children,
}: {
  label: string;
  actions?: ReactNode;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-line py-3 pr-3 pl-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">{children}</div>
      <div className="flex shrink-0 items-center gap-0.5">
        {actions}
        <IconButton
          label={`Close ${label.toLowerCase()}`}
          onClick={close}
          className="pointer-coarse:size-11"
        >
          <XIcon />
        </IconButton>
      </div>
    </header>
  );
}

function DesktopColumn({
  label,
  close,
  frame,
}: {
  label: string;
  close: () => void;
  frame: ReactNode;
}) {
  const [width, setWidth] = useState(readPanelWidth);
  const [resizing, setResizing] = useState(false);
  const startResize = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? width;
    const startX = event.clientX;
    let last = startWidth;
    setResizing(true);
    const release = trackPointerDrag(event.pointerId, {
      move: (event) => {
        last = clampPanelWidth(startWidth - (event.clientX - startX));
        setWidth(last);
      },
      finish: () => {
        release();
        setResizing(false);
        writePanelWidth(last);
      },
      cancel: () => {
        release();
        setResizing(false);
        setWidth(readPanelWidth());
      },
    });
  };
  const reset = () => {
    setWidth(PANEL_WIDTH.default);
    writePanelWidth(PANEL_WIDTH.default);
  };
  return (
    <aside
      data-slot="layout-panel"
      data-dragging={resizing}
      aria-label={label}
      style={{ width }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          close();
        } else ownKeys(event);
      }}
      // The remembered width is a preference, not a claim on the conversation's room: the column
      // shrinks (down to its minimum) before the conversation does (AppLayout).
      className="relative my-2 mr-2 flex max-w-[50vw] min-w-80 shrink flex-col overflow-hidden rounded-r-2xl border border-line bg-conversation shadow-1"
    >
      {/* No standard shadcn resize handle supports a remembered pixel width; mirrors the sidebar's. */}
      {/* biome-ignore lint/a11y/useSemanticElements: interactive window splitter, not a thematic break. */}
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={`Resize ${label.toLowerCase()}`}
        aria-valuenow={width}
        aria-valuemin={PANEL_WIDTH.min}
        aria-valuemax={PANEL_WIDTH.max}
        title="Drag to resize. Double-click to reset."
        onPointerDown={startResize}
        onDoubleClick={reset}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            reset();
          }
        }}
        className={cn(
          "absolute inset-y-0 -left-1 z-10 w-2 touch-none cursor-col-resize select-none after:absolute after:inset-y-0 after:left-[3px] after:w-px after:bg-brand after:opacity-0 hover:after:opacity-100 focus-visible:after:opacity-100",
          resizing && "after:opacity-100",
        )}
      />
      {frame}
    </aside>
  );
}
