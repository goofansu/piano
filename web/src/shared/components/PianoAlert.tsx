import { cn } from "cn";
import type { ComponentProps } from "react";
import { Alert } from "@/components/ui/alert";

type Props = Omit<ComponentProps<typeof Alert>, "variant"> & {
  variant?: ComponentProps<typeof Alert>["variant"] | "warning";
};

export function PianoAlert({ variant, className, ...props }: Props) {
  return (
    <Alert
      {...props}
      variant={variant === "warning" ? null : variant}
      className={cn(
        variant === "warning" &&
          "bg-card text-warning *:data-[slot=alert-description]:text-warning/90 [&>svg]:text-current",
        className,
      )}
    />
  );
}
