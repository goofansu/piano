import { cn } from "cn";
import { XIcon } from "lucide-react";
import {
  createContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useContext,
  useState,
} from "react";
import { IconButton } from "@/components/IconButton";
import { clampPanelWidth, PANEL_WIDTH, readPanelWidth, writePanelWidth } from "@/lib/panelLayout";
import { trackPointerDrag } from "@/lib/pointerDrag";

/** The viewers own native button and media keys, not the composer's type-to-focus hook. */
const ownKeys = (event: ReactKeyboardEvent<HTMLElement>) => {
  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey)
    event.stopPropagation();
};

/**
 * Whether the session shows one area at a time. There a tab names the view, so a view drops the
 * heading and Close it has beside the Agent area.
 */
export const SurfaceSingleContext = createContext(false);
export const useSurfaceSingle = () => useContext(SurfaceSingleContext);

/**
 * One view in the Surface area: a session's Changes or an open file. The area (`SurfaceColumn`)
 * owns sizing and the splitter; a view owns its header, toolbar and scrolling body. Beside the
 * Agent area, Escape closes the view once its own popovers have taken theirs.
 */
export function SurfaceFrame({
  label,
  title,
  header,
  description,
  actions,
  toolbar,
  footer,
  close,
  closeLabel,
  children,
}: {
  /** The region's accessible name ("Changes", "File viewer"). */
  label: string;
  closeLabel?: string;
  title?: ReactNode;
  /** A viewer-specific heading; the frame still owns scrolling. */
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
  const single = useSurfaceSingle();
  return (
    <section
      aria-label={label}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !single && !event.defaultPrevented) {
          event.preventDefault();
          close();
        } else ownKeys(event);
      }}
    >
      {header ?? (
        <PanelHeader label={label} closeLabel={closeLabel} close={close} actions={actions}>
          <h2
            tabIndex={-1}
            data-surface-focus
            className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink outline-none"
          >
            {title}
          </h2>
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
    </section>
  );
}

/** A view's header, shaped like the session header: a title with a line beneath it, then controls, then Close. */
export function PanelHeader({
  label,
  closeLabel = `Close ${label.toLowerCase()}`,
  actions,
  close,
  children,
}: {
  label: string;
  closeLabel?: string;
  actions?: ReactNode;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-line py-3 pr-3 pl-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">{children}</div>
      <div className="flex shrink-0 items-center gap-0.5">
        {actions}
        <IconButton size="header" label={closeLabel} onClick={close}>
          <XIcon />
        </IconButton>
      </div>
    </header>
  );
}

/**
 * The Surface area's place in the session. Beside the Agent area it is a column split off by a
 * hairline, as Linear's side panel is, resizable from that edge and remembered; one area at a time
 * it takes the session's full width. Hidden, it keeps its layout box (invisible and inert, not
 * `display: none`), so a view's scroll and disclosure wait for its return. Hand-written: no shadcn
 * component is a nonmodal, resizable split.
 */
export function SurfaceColumn({
  id,
  labelledBy,
  label,
  single,
  shown,
  children,
}: {
  id: string;
  /** One area at a time, the area is the tab panel its tab names. */
  labelledBy: string | undefined;
  label: string;
  single: boolean;
  shown: boolean;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(readPanelWidth);
  const [resizing, setResizing] = useState(false);
  const resize = (next: number) => {
    const clamped = clampPanelWidth(next);
    setWidth(clamped);
    writePanelWidth(clamped);
  };
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
  return (
    <aside
      id={id}
      data-slot="surface-area"
      data-dragging={resizing}
      role={labelledBy ? "tabpanel" : undefined}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      inert={!shown}
      aria-hidden={!shown}
      style={single ? undefined : { width }}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-col bg-conversation",
        single
          ? "flex-1"
          : // The remembered width is a preference, not a claim on the Agent area's room: the
            // column gives way (down to its minimum) before the Agent area does.
            "max-w-[calc(100%-var(--agent-min))] min-w-(--surface-min) shrink border-l border-line",
        // Hidden at the width it shows at, so nothing rewraps and its scroll stays put.
        !shown && (single ? "invisible absolute inset-0" : "invisible absolute inset-y-0 right-0"),
      )}
    >
      {!single && shown && (
        // No standard shadcn resize handle supports a remembered pixel width; mirrors the sidebar's.
        // biome-ignore lint/a11y/useSemanticElements: interactive window splitter, not a thematic break.
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
          onDoubleClick={() => resize(PANEL_WIDTH.default)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 64 : 16;
            const next =
              event.key === "Enter"
                ? PANEL_WIDTH.default
                : event.key === "ArrowLeft"
                  ? width + step
                  : event.key === "ArrowRight"
                    ? width - step
                    : event.key === "Home"
                      ? PANEL_WIDTH.max
                      : event.key === "End"
                        ? PANEL_WIDTH.min
                        : null;
            if (next === null) return;
            event.preventDefault();
            resize(next);
          }}
          className={cn(
            "absolute inset-y-0 -left-1 z-20 w-2 touch-none cursor-col-resize select-none after:absolute after:inset-y-0 after:left-[3px] after:w-px after:bg-brand after:opacity-0 hover:after:opacity-100 focus-visible:after:opacity-100",
            resizing && "after:opacity-100",
          )}
        />
      )}
      {children}
    </aside>
  );
}
