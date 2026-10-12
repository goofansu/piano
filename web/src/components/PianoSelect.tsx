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

export function SelectContent({ className, ...props }: ComponentProps<typeof BaseContent>) {
  return <BaseContent {...props} className={cn("z-[60]", className)} />;
}
