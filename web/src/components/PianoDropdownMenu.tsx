import { cn } from "cn";
import type { ComponentProps } from "react";
import {
  DropdownMenuContent as BaseContent,
  DropdownMenuItem as BaseItem,
  DropdownMenuSubContent as BaseSubContent,
} from "@/components/ui/dropdown-menu";
import { anchoredMotion, raisedOverlay } from "@/lib/overlayStyles";
import { returnFocusForKeyboard } from "@/lib/pointerClose";

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function DropdownMenuContent({
  className,
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof BaseContent>) {
  return (
    <BaseContent
      {...props}
      className={cn(anchoredMotion, raisedOverlay, className)}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event);
        if (!event.defaultPrevented) returnFocusForKeyboard(event);
      }}
    />
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof BaseSubContent>) {
  return (
    <BaseSubContent
      {...props}
      className={cn(anchoredMotion, raisedOverlay, "shadow-md", className)}
    />
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof BaseItem>) {
  return (
    <BaseItem
      {...props}
      className={cn("rounded-md transition-colors duration-(--dur-hover)", className)}
    />
  );
}
