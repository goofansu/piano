import { cn } from "cn";
import { type ComponentProps, type RefObject, useEffect, useRef } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

export { Tabs } from "@/components/ui/tabs";

/**
 * Scrolls a tab list sideways so its selected tab is whole in view: opening a file adds its tab at
 * the end, past the edge. Only the list scrolls; `scrollIntoView` would also slide the page's
 * clipped panes.
 */
function useSelectedInView(list: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const element = list.current;
    const tab = element?.querySelector<HTMLElement>(
      ':scope > [data-state="active"], :scope > [data-selected="true"]',
    );
    if (!element || !tab) return;
    // The list is its tabs' offset parent, so a tab's offset is its place along the list.
    const start = tab.offsetLeft;
    const end = start + tab.offsetWidth;
    if (start < element.scrollLeft) element.scrollLeft = start;
    else if (end > element.scrollLeft + element.clientWidth)
      element.scrollLeft = end - element.clientWidth;
  });
}

/** A plain mouse wheel only scrolls vertically, and a tab list has nothing to scroll that way. */
function wheelSideways(event: React.WheelEvent<HTMLDivElement>) {
  const list = event.currentTarget;
  if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && list.scrollWidth > list.clientWidth)
    list.scrollLeft += event.deltaY;
}

/**
 * What every tab list shares once its tabs no longer fit: they start at the first tab (upstream
 * centres them, which strands the overflow before the scroll start), scroll sideways by a wheel,
 * a trackpad, a finger or the arrow keys, and keep the selected tab in view. No scrollbar, as a
 * browser's tab strip has none: a styled one is a classic bar that takes the list's bottom edge
 * and lifts the tabs off the strip's rule. No edge fade either: a tab cut off at the edge says
 * there is more, and `scroll-fade-x` fades both edges always in a browser without scroll-driven
 * animations, even a lone tab's underline.
 */
function ScrollingTabsList({ className, onWheel, ...props }: ComponentProps<typeof TabsList>) {
  const ref = useRef<HTMLDivElement>(null);
  useSelectedInView(ref);
  return (
    <TabsList
      ref={ref}
      variant="line"
      {...props}
      onWheel={(event) => {
        onWheel?.(event);
        wheelSideways(event);
      }}
      className={cn(
        "relative max-w-full scrollbar-none justify-start overflow-x-auto overflow-y-hidden p-0 group-data-horizontal/tabs:h-auto",
        className,
      )}
    />
  );
}

/**
 * Upstream focuses a pressed tab from script, which draws the keyboard ring whenever nothing had
 * focus before (as after a reload). Focusing it first without the ring leaves upstream's focus
 * nothing to do; keyboard focus still rings.
 */
function focusPressedTab(event: React.MouseEvent<HTMLButtonElement>) {
  if (event.button === 0 && !event.ctrlKey && !event.currentTarget.disabled)
    event.currentTarget.focus({ focusVisible: false });
}

/**
 * The row a tab strip sits on: the sheet itself, with its rule under the tabs, so the session
 * header, the strip and the view beneath are one surface divided by hairlines. Hand-written: no
 * shadcn component is a row for tabs.
 */
export function PianoStripBar({
  children,
  variant = "connected",
}: {
  children: React.ReactNode;
  variant?: "connected" | "pills";
}) {
  return (
    <div
      data-variant={variant}
      className={cn(
        "group/strip flex shrink-0 items-end border-b border-line px-2",
        // Pills keep the strip's side padding above and below them too.
        variant === "pills" ? "h-11 pointer-coarse:h-15" : "h-10 pointer-coarse:h-12",
      )}
    >
      {children}
    </div>
  );
}

/**
 * The Surface area's tab strip: flat tabs on the sheet, the selected one underlined on the
 * strip's rule, as Linear's are. Tabs keep their width and scroll as every tab list does.
 */
export function PianoStripTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
  return (
    <ScrollingTabsList
      {...props}
      className={cn(
        "w-full min-w-0 flex-1 items-end gap-1 self-stretch rounded-none group-data-[variant=pills]/strip:items-center",
        className,
      )}
    />
  );
}

/** One strip tab: the trigger and, beside it, its Close (a button cannot hold a button). */
export function PianoStripTab({
  selected,
  className,
  children,
}: {
  selected: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-selected={selected}
      className={cn(
        // Keyboard focus rings the whole tab, Close included, inside its edge so the strip
        // never clips it. Sized by pointer, not width: a touch screen keeps a 44px target.
        "relative -mb-px flex h-8 pointer-coarse:h-11 max-w-48 min-w-0 shrink-0 items-center gap-0.5 rounded-md pr-1 has-[[role=tab]:focus-visible]:ring-2 has-[[role=tab]:focus-visible]:ring-ring has-[[role=tab]:focus-visible]:ring-inset",
        // The chosen tab's bar, 2px of ink sitting on the strip's rule (brand means "live").
        "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-ink after:opacity-0",
        // Single-area navigation is a filled pill, a whole rectangle apart from the content.
        "group-data-[variant=pills]/strip:mb-0 group-data-[variant=pills]/strip:h-7 group-data-[variant=pills]/strip:rounded-sm group-data-[variant=pills]/strip:after:hidden pointer-coarse:group-data-[variant=pills]/strip:h-11",
        selected
          ? "text-ink after:opacity-100 group-data-[variant=pills]/strip:bg-fill-active"
          : // Pointing at a tab fills it, as pointing at a ghost control does.
            "text-ink-3 hover:bg-fill hover:text-ink",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The strip tab's trigger: its icon and name (the children), with no underline or fill of its own.
 * A tab without Close (Agent) keeps the same room after its name as before it.
 */
export function PianoStripTabTrigger({
  icon,
  className,
  onMouseDown,
  children,
  ...props
}: ComponentProps<typeof TabsTrigger> & { icon: React.ReactNode }) {
  return (
    <TabsTrigger
      {...props}
      onMouseDown={(event) => {
        onMouseDown?.(event);
        focusPressedTab(event);
      }}
      className={cn(
        "h-full min-w-0 flex-1 justify-start gap-1.5 rounded-md border-0 pl-2.5 pr-0.5 last:pr-1.5 text-xs text-inherit after:hidden hover:text-inherit data-active:text-inherit dark:text-inherit dark:hover:text-inherit dark:data-active:text-inherit focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none",
        className,
      )}
    >
      <span className="flex shrink-0 text-ink-3" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 truncate font-medium">{children}</span>
    </TabsTrigger>
  );
}
