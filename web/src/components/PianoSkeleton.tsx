import { cn } from "cn";
import type { ComponentProps } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function PianoSkeleton({ className, ...props }: ComponentProps<typeof Skeleton>) {
  return <Skeleton {...props} className={cn("bg-fill-active", className)} />;
}
