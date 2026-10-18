import { cn } from "cn";
import type { ComponentProps } from "react";
import { DialogContent as BaseContent } from "@/components/ui/dialog";
import { useExitFace } from "@/lib/useExitFace";

export {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** A dialog scales in from the centre and exits on its last open face; `still` drops that for
 * one opened by a shortcut. */
export function DialogContent({
  className,
  still = false,
  ref,
  ...props
}: ComponentProps<typeof BaseContent> & { still?: boolean }) {
  const exitFace = useExitFace(ref);
  return (
    <BaseContent
      data-motion={still ? undefined : "dialog"}
      ref={still ? ref : exitFace}
      {...props}
      className={cn("rounded-2xl bg-surface-3", className)}
    />
  );
}
