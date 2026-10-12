import { cn } from "cn";
import type { ComponentProps } from "react";
import { SheetContent as BaseContent } from "@/components/ui/sheet";

export {
  Sheet,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function SheetContent({ className, ...props }: ComponentProps<typeof BaseContent>) {
  return (
    <BaseContent
      {...props}
      className={cn(
        "transition-all ease-(--ease-enter) data-[state=closed]:duration-200 data-[state=closed]:ease-(--ease-exit) data-[state=open]:duration-300",
        className,
      )}
    />
  );
}
