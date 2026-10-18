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

/** A dialog scales in from the centre; `still` drops that for one opened by a shortcut. */
export function DialogContent({
  className,
  still = false,
  ...props
}: ComponentProps<typeof BaseContent> & { still?: boolean }) {
  return (
    <BaseContent
      data-motion={still ? undefined : "dialog"}
      {...props}
      className={cn("rounded-2xl bg-surface-3", className)}
    />
  );
}
