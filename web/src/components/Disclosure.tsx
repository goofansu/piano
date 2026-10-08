import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";

/** The chevron on every folding row: it points right while closed and turns down when open, at the shared enter tempo. */
export function DisclosureChevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <ChevronRightIcon
      aria-hidden
      className={cn("size-3.5 shrink-0 text-ink-3 transition-transform duration-(--dur-enter) ease-(--ease-enter) motion-reduce:transition-none", open && "rotate-90", className)}
    />
  );
}
