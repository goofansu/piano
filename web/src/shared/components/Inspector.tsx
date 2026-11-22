import { cn } from "cn";
import { XIcon } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useState,
} from "react";
import { IconButton } from "@/shared/components/IconButton";
import { trackPointerDrag } from "@/shared/lib/pointerDrag";
import { ScrollRootContext } from "@/shared/lib/scrollRoot";
import { type InspectorTab, tabKey } from "@/shared/navigation/navigation";
import {
  clampPanelWidth,
  PANEL_WIDTH,
  readPanelWidth,
  writePanelWidth,
} from "@/shared/navigation/panelLayout";
import { useNavigation } from "@/shared/navigation/useNavigation";

const ownKeys = (event: ReactKeyboardEvent<HTMLElement>) => {
  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey)
    event.stopPropagation();
};

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export function inspectorTabNames(tab: InspectorTab) {
  return tab === "changes"
    ? { name: "Changes", close: "Hide changes", region: "Changes" }
    : { name: fileName(tab.path), close: `Close ${fileName(tab.path)}`, region: "File viewer" };
}

export function InspectorFrame({
  tab,
  status,
  actions,
  below,
  children,
}: {
  tab: InspectorTab;
  status?: ReactNode;
  actions?: ReactNode;
  below?: ReactNode;
  children: ReactNode;
}) {
  const { single, closeTab } = useNavigation();
  const names = inspectorTabNames(tab);
  const close = () => closeTab(tabKey(tab));
  const toolbar = status !== undefined || actions !== undefined || single;
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape closes the tab from anywhere inside it.
    <section
      aria-label={names.region}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !single && !event.defaultPrevented) {
          event.preventDefault();
          close();
        } else ownKeys(event);
      }}
    >
      {toolbar && (
        <div className="flex min-h-10 min-w-0 shrink-0 items-center justify-between gap-2 border-b border-line pr-2 pl-4 text-xs text-ink-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 py-1">{status}</div>
          <div className="flex shrink-0 items-center">
            {actions}
            {single && (
              <IconButton size="header" label={names.close} onClick={close}>
                <XIcon />
              </IconButton>
            )}
          </div>
        </div>
      )}
      {below}
      <div ref={setBody} data-slot="panel-body" className="relative min-h-0 flex-1 overflow-auto">
        <ScrollRootContext value={body}>{children}</ScrollRootContext>
      </div>
    </section>
  );
}

export function InspectorColumn({
  id,
  labelledBy,
  label,
  single,
  shown,
  children,
}: {
  id: string;
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
    const release = trackPointerDrag(event.currentTarget, event.pointerId, {
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
      data-slot="inspector"
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
          : "max-w-[calc(100%-var(--agent-min))] min-w-(--inspector-min) shrink border-l border-line",
        !shown && (single ? "invisible absolute inset-0" : "invisible absolute inset-y-0 right-0"),
      )}
    >
      {!single && shown && (
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
