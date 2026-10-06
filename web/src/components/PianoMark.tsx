import { cn } from "cn";

interface Props {
  className?: string;
  /** The keys play while Pi works and rest when it finishes. */
  playing?: boolean;
}

/** The three-key mark: Piano's wordmark glyph by day, and the instrument's live signal whenever Pi is working. */
export function PianoMark({ className, playing = false }: Props) {
  return (
    <span aria-hidden data-playing={playing || undefined} className={cn("keys inline-flex size-7 shrink-0 items-center justify-center gap-[3px] rounded-lg bg-brand text-brand-ink shadow-1", className)}>
      <span className="h-3 w-[3px] rounded-full bg-current" />
      <span className="h-4 w-[3px] rounded-full bg-current" />
      <span className="h-2.5 w-[3px] rounded-full bg-current" />
    </span>
  );
}

/** The same three keys without the tile, in the current text colour, sized for a glyph gutter or a row. */
export function Keys({ className, playing = false }: Props) {
  return (
    <span aria-hidden data-playing={playing || undefined} className={cn("keys inline-flex shrink-0 items-end justify-center gap-[2px]", className)}>
      <span className="h-[7px] w-[2px] rounded-full bg-current" />
      <span className="h-[10px] w-[2px] rounded-full bg-current" />
      <span className="h-[6px] w-[2px] rounded-full bg-current" />
    </span>
  );
}
