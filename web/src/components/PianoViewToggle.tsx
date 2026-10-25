import { cn } from "cn";
import type { ComponentProps } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** Quiet view controls in a toolbar: small text like its other actions, Radix selection and arrow keys, no boxed segment. */
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
        "relative h-11 rounded-none px-2 text-xs text-ink-3 hover:bg-transparent hover:text-ink data-[state=on]:bg-transparent data-[state=on]:text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full data-[state=on]:after:bg-ink md:h-9",
        className,
      )}
    />
  );
}
