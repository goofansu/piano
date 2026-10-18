import { cn } from "cn";

interface Props {
  className?: string;
  /** The keys play while Pi works and rest when it finishes. */
  playing?: boolean;
}

/** Solid keys under a fallboard: white, black, white, with the black key shorter. */
interface Grid {
  /** Width of one key. */
  keyWidth: number;
  /** Open space between keys. */
  gap: number;
  /** Height of the fallboard; a 1-unit gap separates it from the keys. */
  board: number;
  white: number;
  black: number;
}

/**
 * A fallboard across the top and three keys hanging from it, so the glyph reads as a keyboard seen
 * from above and as a π with one more leg. Solid bars, like Pi's mark, so it keeps its weight at
 * favicon size. Every unit is one CSS pixel at the native size; `crispEdges` keeps edges sharp.
 */
function KeyBars({ keyWidth, gap, board, white, black, className, playing }: Grid & Props) {
  const width = 3 * keyWidth + 2 * gap;
  const top = board + 1;
  const height = top + white;
  // Round the box up to even sides so a centring parent never lands the bars on half pixels.
  const box = (n: number) => n + (n % 2);
  return (
    <svg
      aria-hidden
      data-playing={playing || undefined}
      viewBox={`0 0 ${box(width)} ${box(height)}`}
      width={box(width)}
      height={box(height)}
      overflow="visible"
      shapeRendering="crispEdges"
      className={cn("keys shrink-0", className)}
    >
      <rect width={width} height={board} fill="currentColor" />
      {(
        [
          ["left", white],
          ["black", black],
          ["right", white],
        ] as const
      ).map(([name, length], i) => (
        <rect
          key={name}
          data-key={i}
          data-motion="key"
          x={i * (keyWidth + gap)}
          y={top}
          width={keyWidth}
          height={length}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}

/** The three-key mark: Piano's wordmark glyph by day, and the instrument's live signal whenever Pi is working. */
export function PianoMark({ className, playing = false }: Props) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-ink shadow-1",
        className,
      )}
    >
      {/* A 16×16 glyph at about 4/7 of the tile, rounded to a whole multiple of its height so the
          bars always land on whole pixels: 1× in the 24 and 28px tiles, 2× in the 48px tile. */}
      <KeyBars
        keyWidth={4}
        gap={2}
        board={4}
        white={11}
        black={7}
        playing={playing}
        className="h-[57.15%] w-auto supports-[height:round(1px,1px)]:h-[round(57.15%,16px)]"
      />
    </span>
  );
}

/** The same keys without the tile, in the current text colour, sized for a glyph gutter or a row:
 * about 3/4 of the mark's 16px glyph, so the keys keep its weight beside 14px text. */
export function Keys({ className, playing = false }: Props) {
  return (
    <KeyBars
      keyWidth={3}
      gap={2}
      board={3}
      white={8}
      black={5}
      playing={playing}
      className={className}
    />
  );
}
