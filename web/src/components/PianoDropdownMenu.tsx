import { cn } from "cn";
import { Children, type ComponentProps, type ReactNode } from "react";
import {
  DropdownMenu as BaseMenu,
  DropdownMenuCheckboxItem as BaseCheckboxItem,
  DropdownMenuContent as BaseContent,
  DropdownMenuItem as BaseItem,
  DropdownMenuRadioItem as BaseRadioItem,
  DropdownMenuSub as BaseSub,
  DropdownMenuSubContent as BaseSubContent,
  DropdownMenuSubTrigger as BaseSubTrigger,
} from "@/components/ui/dropdown-menu";
import { keyboardFocusReturn } from "@/lib/pointerClose";

export {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Base UI's menu typeahead matches an item's untrimmed text, so the space after a leading icon hides the item from it.
function typeaheadLabel(children: ReactNode) {
  const text = Children.toArray(children)
    .filter((child) => typeof child === "string" || typeof child === "number")
    .join("")
    .trim();
  return text || undefined;
}

export function DropdownMenu({ loopFocus = false, ...props }: ComponentProps<typeof BaseMenu>) {
  return <BaseMenu loopFocus={loopFocus} {...props} />;
}

export function DropdownMenuSub({
  closeParentOnEsc = true,
  ...props
}: ComponentProps<typeof BaseSub>) {
  return <BaseSub closeParentOnEsc={closeParentOnEsc} {...props} />;
}

export function DropdownMenuContent({
  className,
  finalFocus = keyboardFocusReturn,
  ...props
}: ComponentProps<typeof BaseContent>) {
  return (
    <BaseContent
      data-motion="anchored"
      {...props}
      finalFocus={finalFocus}
      className={cn("w-max min-w-48 max-w-[calc(100vw-2rem)] rounded-lg", className)}
    />
  );
}

export function DropdownMenuSubContent({
  alignOffset = 0,
  className,
  finalFocus = keyboardFocusReturn,
  ...props
}: ComponentProps<typeof BaseSubContent>) {
  return (
    <BaseSubContent
      alignOffset={alignOffset}
      data-motion="anchored"
      {...props}
      finalFocus={finalFocus}
      className={cn("w-max min-w-48 max-w-[calc(100vw-2rem)] rounded-lg shadow-md", className)}
    />
  );
}

export function DropdownMenuItem({ className, label, ...props }: ComponentProps<typeof BaseItem>) {
  return (
    <BaseItem
      label={label ?? typeaheadLabel(props.children)}
      {...props}
      className={cn("rounded-md", className)}
    />
  );
}

export function DropdownMenuSubTrigger({ label, ...props }: ComponentProps<typeof BaseSubTrigger>) {
  return <BaseSubTrigger label={label ?? typeaheadLabel(props.children)} {...props} />;
}

export function DropdownMenuCheckboxItem({
  closeOnClick = true,
  label,
  ...props
}: ComponentProps<typeof BaseCheckboxItem>) {
  return (
    <BaseCheckboxItem
      closeOnClick={closeOnClick}
      label={label ?? typeaheadLabel(props.children)}
      {...props}
    />
  );
}

export function DropdownMenuRadioItem({
  closeOnClick = true,
  label,
  ...props
}: ComponentProps<typeof BaseRadioItem>) {
  return (
    <BaseRadioItem
      closeOnClick={closeOnClick}
      label={label ?? typeaheadLabel(props.children)}
      {...props}
    />
  );
}
