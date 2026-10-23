import { cn } from "cn";
import type { ComponentProps } from "react";
import {
  DropdownMenuContent as BaseContent,
  DropdownMenuItem as BaseItem,
  DropdownMenuSubContent as BaseSubContent,
} from "@/components/ui/dropdown-menu";
import { raisedOverlay } from "@/lib/overlayStyles";
import { returnFocusForKeyboard } from "@/lib/pointerClose";

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
      collisionPadding={8}
      data-motion="anchored"
      {...props}
      className={cn(raisedOverlay, "w-max min-w-48 max-w-[calc(100vw-2rem)]", className)}
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
      collisionPadding={8}
      data-motion="anchored"
      {...props}
      className={cn(
        raisedOverlay,
        "w-max min-w-48 max-w-[calc(100vw-2rem)] max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto shadow-md",
        className,
      )}
    />
  );
}

/**
 * A closing menu keeps its hands off focus. Radix refocuses the menu content when the pointer
 * leaves an item, and it does so while the menu is still mounted for its exit animation. An
 * overlay the item just opened (the PR popover) lands under the resting pointer, so the browser
 * fires `pointerleave` on the item, the closing menu takes focus, and the overlay dismisses
 * itself as focus moved outside it. Preventing the event skips Radix's handler.
 */
function keepFocusWhileClosing(event: React.PointerEvent<HTMLDivElement>) {
  const menu = event.currentTarget.closest('[role="menu"]');
  if (menu?.getAttribute("data-state") === "closed") event.preventDefault();
}

export function DropdownMenuItem({
  className,
  onPointerLeave,
  ...props
}: ComponentProps<typeof BaseItem>) {
  return (
    <BaseItem
      {...props}
      className={cn("rounded-md", className)}
      onPointerLeave={(event) => {
        onPointerLeave?.(event);
        keepFocusWhileClosing(event);
      }}
    />
  );
}
