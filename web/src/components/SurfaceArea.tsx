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
 * owns sizing and the splitter; a view owns two rows and its scrolling body. Beside the Agent area
 * the first row is the view's tab, its name and Close, and the second its toolbar: what it shows
 * on the left, its actions on the right, so naming and closing never mix with acting. One area
 * at a time the session's tabs name the view, so only the toolbar shows. Beside the Agent area,
 * Escape closes the view once its own popovers have taken theirs.
 */
export function SurfaceFrame({
  label,
  icon,
  title,
  close,
  closeLabel,
  closeWhenSingle = false,
  status,
  actions,
  below,
  children,
}: {
  /** The region's accessible name ("Changes", "File viewer"). */
  label: string;
  icon: ReactNode;
  /** The tab's name: the view's, or a file's name. */
  title: ReactNode;
  close: () => void;
  closeLabel: string;
  /**
   * One area at a time, Close joins the toolbar: for a file, whose tab has no Close of its own.
   * Changes has none there, since Agent is the way back.
   */
  closeWhenSingle?: boolean;
  /** What the view shows, at the toolbar's start: a change's size, a file's path. */
  status?: ReactNode;
  /** The view's controls, at the toolbar's end. */
  actions?: ReactNode;
  /** Rows under the toolbar, such as a stale observation's note. */
  below?: ReactNode;
  children: ReactNode;
}) {
  const single = useSurfaceSingle();
  const closeButton = (
    <IconButton size={single ? "header" : "row"} label={closeLabel} onClick={close}>
      <XIcon />
    </IconButton>
  );
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
      {!single && (
        // A browser-style tab on the area's strip; one view, so not a tab list. No shadcn
        // component is a closable tab.
        <div className="flex h-11 shrink-0 items-end border-b border-line bg-surface-0 px-2">
          <div className="relative -mb-px flex h-9 min-w-0 max-w-full items-center gap-1.5 rounded-t-lg border border-b-0 border-line bg-conversation pr-1 pl-3">
            <span className="flex shrink-0 text-ink-3 [&_svg]:size-4" aria-hidden>
              {icon}
            </span>
            <h2
              tabIndex={-1}
              data-surface-focus
              className="min-w-0 truncate text-sm font-medium text-ink outline-none"
            >
              {title}
            </h2>
            {closeButton}
          </div>
        </div>
      )}
      {/* Plain status and view controls have no dedicated shadcn layout. */}
      <div className="flex min-h-10 min-w-0 shrink-0 items-center justify-between gap-2 border-b border-line pr-2 pl-4 text-xs text-ink-2">
        <div className="flex min-w-0 items-center truncate">{status}</div>
        <div className="flex shrink-0 items-center">
          {actions}
          {single && closeWhenSingle && closeButton}
        </div>
      </div>
      {below}
      <div data-slot="panel-body" className="relative min-h-0 flex-1 overflow-auto">
        {children}
      </div>
    </section>
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
