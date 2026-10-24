import { cn } from "cn";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

const variants = {
  // Stays solid on hover, so whatever the button floats over never shows through it.
  "outline-solid":
    "border border-input bg-popover text-popover-foreground shadow-xs hover:bg-popover-hover",
  "outline-transparent": "border border-input bg-transparent hover:border-ring",
};

type Props = Omit<ComponentProps<typeof Button>, "variant"> & {
  variant?: ComponentProps<typeof Button>["variant"] | keyof typeof variants;
};

/** App variants opt out of the base variant so its hover/dark styles cannot leak through. */
export function PianoButton({ variant, className, ...props }: Props) {
  if (variant === "outline-solid" || variant === "outline-transparent") {
    return (
      <Button
        {...props}
        variant={null}
        data-variant={variant}
        className={cn(variants[variant], className)}
      />
    );
  }
  return <Button {...props} variant={variant} className={className} />;
}
