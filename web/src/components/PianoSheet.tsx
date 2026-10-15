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

/**
 * A sheet moves like a drawer: opaque, its full extent from its own edge, so the motion says where
 * it went and the swipe that brings it back works on the same axis. Upstream fades it while sliding
 * 40px, which reads as a dissolve on a tall panel; these utilities set the same enter/exit variables
 * to full travel and full opacity, and are emitted after upstream's, so they win. The reduced-motion
 * reset in index.css still cancels all of it.
 */
const drawerMotion =
  "data-open:fade-in-100 data-closed:fade-out-100 data-[side=bottom]:data-open:slide-in-from-bottom-full data-[side=bottom]:data-closed:slide-out-to-bottom-full data-[side=left]:data-open:slide-in-from-left-full data-[side=left]:data-closed:slide-out-to-left-full data-[side=right]:data-open:slide-in-from-right-full data-[side=right]:data-closed:slide-out-to-right-full data-[side=top]:data-open:slide-in-from-top-full data-[side=top]:data-closed:slide-out-to-top-full";

export function SheetContent({ className, ...props }: ComponentProps<typeof BaseContent>) {
  return (
    <BaseContent
      {...props}
      className={cn(
        "transition-all ease-(--ease-enter) data-[state=closed]:duration-200 data-[state=closed]:ease-(--ease-exit) data-[state=open]:duration-300",
        drawerMotion,
        className,
      )}
    />
  );
}
