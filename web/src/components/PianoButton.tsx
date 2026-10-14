import { cn } from "cn";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

const variants = {
  "outline-solid":
    "border border-input bg-popover text-popover-foreground shadow-xs hover:bg-accent hover:text-accent-foreground",
  "outline-transparent": "border border-input bg-transparent hover:border-ring",
  "rail-action":
    "border border-line bg-transparent text-ink shadow-none hover:border-brand/25 hover:bg-brand-soft [&_svg]:text-brand",
};

type Props = Omit<ComponentProps<typeof Button>, "variant"> & {
  variant?: ComponentProps<typeof Button>["variant"] | keyof typeof variants;
};

/** App variants opt out of the base variant so its hover/dark styles cannot leak through. */
export function PianoButton({ variant, className, ...props }: Props) {
  if (
    variant === "outline-solid" ||
    variant === "outline-transparent" ||
    variant === "rail-action"
  ) {
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
