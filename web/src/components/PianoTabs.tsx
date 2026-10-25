import { cn } from "cn";
import type { ComponentProps } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

export { Tabs } from "@/components/ui/tabs";

/** Quiet navigation tabs: the line variant, its tabs sized by their text, not stretched. */
export function PianoTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
  return (
    <TabsList
      variant="line"
      {...props}
      className={cn("gap-1 p-0 group-data-horizontal/tabs:h-auto", className)}
    />
  );
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
        "h-11 flex-none rounded-none border-0 px-2 text-ink-3 hover:text-ink data-active:text-ink md:h-9",
        "group-data-horizontal/tabs:after:inset-x-2 group-data-horizontal/tabs:after:bottom-0 after:rounded-full after:bg-ink",
        "focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    />
  );
}
