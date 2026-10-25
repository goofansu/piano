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
 * centres them, which strands the overflow before the scroll start), scroll sideways by a thin
 * scrollbar, a wheel or trackpad, or the arrow keys, and keep the selected tab in view.
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
        "relative max-w-full justify-start overflow-x-auto overflow-y-hidden p-0 group-data-horizontal/tabs:h-auto [scrollbar-color:var(--line-strong)_transparent] [scrollbar-width:thin]",
        className,
      )}
    />
  );
}

/** Quiet navigation tabs: the line variant, its tabs sized by their text, not stretched. */
export function PianoTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
  return <ScrollingTabsList {...props} className={cn("gap-1", className)} />;
}

/**
 * A tab as `PianoViewToggleItem` draws a choice: muted until selected, then ink with an underline
 * on the row's edge. Focus draws a ring, never the boxed border that would hide the underline.
 */
export function PianoTabsTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
  return (
    <TabsTrigger
      {...props}
      className={cn(
        // Sized by pointer, not width: a touch screen keeps a 44px target at any width.
        "h-8 max-w-48 flex-none gap-1.5 rounded-none border-0 px-2 text-xs text-ink-3 hover:text-ink data-active:text-ink pointer-coarse:h-11",
        // The icon never gives way to the name: a long name truncates beside it.
        "[&_svg:not([class*='size-'])]:size-3.5 [&>svg]:shrink-0",
        "group-data-horizontal/tabs:after:inset-x-2 group-data-horizontal/tabs:after:bottom-0 after:rounded-full after:bg-ink",
        "focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none",
        className,
      )}
    />
  );
}

/**
 * The Surface area's tab strip: browser-style tabs on a darker strip, the selected one joining the
 * view beneath. The strip draws its rule under the tabs, so the selected tab covers it; tabs keep
 * their width and scroll as every tab list does.
 */
export function PianoStripTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
  return (
    <ScrollingTabsList
      {...props}
      className={cn("w-full min-w-0 flex-1 items-end gap-1 self-stretch rounded-none", className)}
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
        // never clips it.
        "relative flex h-8 max-w-48 min-w-0 shrink-0 items-center gap-0.5 rounded-t-lg border border-b-0 pr-1 has-[[role=tab]:focus-visible]:ring-2 has-[[role=tab]:focus-visible]:ring-ring has-[[role=tab]:focus-visible]:ring-inset",
        selected
          ? "z-10 border-line bg-conversation text-ink"
          : // Pointing at a tab outlines it, the shape it takes when chosen.
            "border-transparent text-ink-3 hover:border-line hover:text-ink",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The strip tab's trigger: its icon and name, with no underline or fill of its own. */
export function PianoStripTabTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
  return (
    <TabsTrigger
      {...props}
      className={cn(
        "h-full min-w-0 flex-1 justify-start gap-1.5 rounded-md border-0 pl-2.5 pr-0.5 text-xs text-inherit after:hidden hover:text-inherit data-active:text-inherit dark:text-inherit dark:hover:text-inherit dark:data-active:text-inherit focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none",
        className,
      )}
    />
  );
}
