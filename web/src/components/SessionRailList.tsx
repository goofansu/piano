import { cn } from "cn";
import type { ComponentProps } from "react";
import { SettingsList } from "@/components/SettingsSectionFrame";
import { ItemTitle } from "@/components/ui/item";

/**
 * A session rail section's rows: the bordered, hairline-divided list Settings uses, at the rail's
 * small size. Each row is an `Item` with `railRow`, its icon in `ItemMedia`, its text in
 * `ItemContent` and, for a link, Jump to message in `RowActions`.
 */
export function RailList({ className, ...props }: ComponentProps<typeof SettingsList>) {
  return <SettingsList className={cn("text-xs", className)} {...props} />;
}

/** The classes an `Item` takes to sit in a `RailList`. */
export const railRow = "flex-nowrap gap-2.5 rounded-none px-3 py-2 text-xs";

/** A row's text in the panel's weight and size: a block, so `truncate` ellipsizes it, which the title's own flex clamp would not. */
export function RailRowTitle({ className, ...props }: ComponentProps<typeof ItemTitle>) {
  return (
    <ItemTitle
      className={cn(
        "line-clamp-none block min-w-0 max-w-full text-xs font-normal text-ink",
        className,
      )}
      {...props}
    />
  );
}
