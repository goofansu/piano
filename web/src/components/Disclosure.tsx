import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";

/** The chevron on every folding row: it points right while closed and turns down when open. */
export function DisclosureChevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <ChevronRightIcon
      aria-hidden
      data-motion="turn"
      className={cn("size-3.5 shrink-0 text-ink-3", open && "rotate-90", className)}
    />
  );
}
