import { cn } from "cn";
import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";

const variants = {
  success: "border-success/20 bg-success/12 text-success",
  merged: "border-merged/20 bg-merged/12 text-merged",
  error: "border-err/20 bg-err/12 text-err",
  warning: "border-warning/20 bg-warning/12 text-warning",
};

type Props = Omit<ComponentProps<typeof Badge>, "variant"> & {
  variant?: ComponentProps<typeof Badge>["variant"] | keyof typeof variants;
};

export function StatusBadge({ variant, className, ...props }: Props) {
  if (
    variant === "success" ||
    variant === "merged" ||
    variant === "error" ||
    variant === "warning"
  ) {
    return (
      <Badge
        {...props}
        variant={null}
        data-variant={variant}
        className={cn(variants[variant], className)}
      />
    );
  }
  return <Badge {...props} variant={variant} className={className} />;
}
