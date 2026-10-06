import { CheckIcon } from "lucide-react"
import { cn } from "cn"

/**
 * One row style for every dropdown: select, menu, command list and plain row buttons.
 * Each primitive adds its own highlight and disabled selectors. Touch-sized on phones.
 */
export const menuItem =
  "relative flex min-h-11 w-full cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm outline-hidden select-none md:min-h-9 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-ink-2"

/** The selected mark, always at the row's right edge. Unchecked rows keep its space so labels never shift. */
export function MenuCheck({ checked = true, className }: { checked?: boolean; className?: string }) {
  return <CheckIcon aria-hidden className={cn("ml-auto size-4 shrink-0", !checked && "opacity-0", className)} />
}
