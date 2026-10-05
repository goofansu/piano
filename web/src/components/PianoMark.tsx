import { cn } from "cn";

/** A small, decorative set of keys. The adjacent wordmark supplies the name. */
export function PianoMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex size-7 shrink-0 items-center justify-center gap-[3px] rounded-lg bg-brand text-brand-ink shadow-1", className)}>
      <span className="h-3 w-[3px] rounded-full bg-current" />
      <span className="h-4 w-[3px] rounded-full bg-current" />
      <span className="h-2.5 w-[3px] rounded-full bg-current" />
    </span>
  );
}
