import { cn } from "cn";
import type { ComponentProps } from "react";
import { DialogContent as BaseContent } from "@/components/ui/dialog";

export {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function DialogContent({ className, ...props }: ComponentProps<typeof BaseContent>) {
  return (
    <BaseContent
      {...props}
      className={cn(
        "rounded-2xl bg-surface-3 duration-(--dur-enter) ease-(--ease-enter) data-[state=closed]:duration-(--dur-exit) data-[state=closed]:ease-(--ease-exit) data-[state=closed]:zoom-out-[0.96] data-[state=open]:zoom-in-[0.96]",
        className,
      )}
    />
  );
}
