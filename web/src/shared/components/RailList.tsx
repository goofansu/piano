import { cn } from "cn";
import type { ComponentProps } from "react";
import { ItemTitle } from "@/components/ui/item";
import { SettingsList } from "@/shared/components/SettingsSectionFrame";

export function RailList({ className, ...props }: ComponentProps<typeof SettingsList>) {
  return <SettingsList className={cn("text-xs", className)} {...props} />;
}

export const railRow = "flex-nowrap gap-2.5 rounded-none px-3 py-2 text-xs pointer-coarse:min-h-11";

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
