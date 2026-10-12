import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ComponentProps } from "react";

/** shadcn's radio item has no indicator slot: compose Radix for Piano's trailing check. */
export function PickerRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.RadioItem>) {
  return (
    <DropdownMenu.RadioItem
      {...props}
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
    >
      {children}
      <span className="pointer-events-none ml-auto flex size-4 shrink-0 items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <CheckIcon className="size-4" />
        </DropdownMenu.ItemIndicator>
      </span>
    </DropdownMenu.RadioItem>
  );
}
