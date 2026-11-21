import { cn } from "cn";
import { type ComponentProps, type RefObject, useCallback, useEffect, useRef } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { wheelSideways } from "@/shared/lib/wheelSideways";

export { Tabs } from "@/components/ui/tabs";

function useSelectedInView(list: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const element = list.current;
    const tab = element?.querySelector<HTMLElement>(':scope > [data-selected="true"]');
    if (!element || !tab) return;
    const start = tab.offsetLeft;
    const end = start + tab.offsetWidth;
    if (start < element.scrollLeft) element.scrollLeft = start;
    else if (end > element.scrollLeft + element.clientWidth)
      element.scrollLeft = end - element.clientWidth;
  });
}

function ScrollingTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
  const ref = useRef<HTMLDivElement>(null);
  useSelectedInView(ref);
  const list = useCallback((element: HTMLDivElement | null) => {
    ref.current = element;
    const detach = wheelSideways(element);
    return () => {
      ref.current = null;
      detach?.();
    };
  }, []);
  return (
    <TabsList
      ref={list}
      variant="line"
      activateOnFocus
      {...props}
      className={cn(
        "relative max-w-full scrollbar-none justify-start overflow-x-auto overflow-y-hidden p-0 group-data-horizontal/tabs:h-auto",
        className,
      )}
    />
  );
}

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
        variant === "pills" ? "h-11 pointer-coarse:h-15" : "h-10 pointer-coarse:h-12",
      )}
    >
      {children}
    </div>
  );
}

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
        "relative -mb-px flex h-8 pointer-coarse:h-11 max-w-48 min-w-0 shrink-0 items-center gap-0.5 rounded-md pr-1 has-[[role=tab]:focus-visible]:ring-2 has-[[role=tab]:focus-visible]:ring-ring has-[[role=tab]:focus-visible]:ring-inset",
        "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-ink after:opacity-0",
        "group-data-[variant=pills]/strip:mb-0 group-data-[variant=pills]/strip:h-7 group-data-[variant=pills]/strip:rounded-sm group-data-[variant=pills]/strip:after:hidden pointer-coarse:group-data-[variant=pills]/strip:h-11",
        selected
          ? "text-ink after:opacity-100 group-data-[variant=pills]/strip:bg-fill-active"
          : "text-ink-3 hover:bg-fill hover:text-ink",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PianoStripTabTrigger({
  icon,
  className,
  children,
  ...props
}: ComponentProps<typeof TabsTrigger> & { icon: React.ReactNode }) {
  return (
    <TabsTrigger
      {...props}
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
