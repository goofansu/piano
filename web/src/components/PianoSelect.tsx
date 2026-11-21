import type { ComponentProps } from "react";
import { SelectContent as BaseContent } from "@/components/ui/select";
import { raisedLayer } from "@/lib/overlayStyles";

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
      positionerClassName={raisedLayer}
      {...props}
      alignItemWithTrigger={alignItemWithTrigger}
      sideOffset={sideOffset}
    />
  );
}
