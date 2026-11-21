import { cn } from "cn";
import type { ComponentProps } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function PianoViewToggle({ className, ...props }: ComponentProps<typeof ToggleGroup>) {
  return <ToggleGroup {...props} spacing={1} className={cn("rounded-none", className)} />;
}

export function PianoViewToggleItem({
  className,
  ...props
}: ComponentProps<typeof ToggleGroupItem>) {
  return (
    <ToggleGroupItem
      {...props}
      className={cn(
        "relative h-11 rounded-none px-2 text-xs text-ink-3 hover:bg-transparent hover:text-ink data-pressed:bg-transparent data-pressed:text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full data-pressed:after:bg-ink compact:h-9",
        className,
      )}
    />
  );
}
