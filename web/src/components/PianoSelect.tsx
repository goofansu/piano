import { cn } from "cn";
import type { ComponentProps } from "react";
import { SelectContent as BaseContent } from "@/components/ui/select";

export {
  Select,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Piano's overlay policy: the list drops below the trigger like the other menus, instead of
 * upstream's item-aligned overlay that covers the trigger and whatever sits above it.
 */
export function SelectContent({
  className,
  position = "popper",
  sideOffset = 4,
  ...props
}: ComponentProps<typeof BaseContent>) {
  return (
    <BaseContent
      data-motion="anchored"
      {...props}
      position={position}
      sideOffset={sideOffset}
      className={cn("z-[60]", className)}
    />
  );
}
