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

export function SelectContent({
  alignItemWithTrigger = false,
  sideOffset = 8,
  ...props
}: ComponentProps<typeof BaseContent>) {
  return (
    <BaseContent
      data-motion="anchored"
      {...props}
      alignItemWithTrigger={alignItemWithTrigger}
      sideOffset={sideOffset}
    />
  );
}
