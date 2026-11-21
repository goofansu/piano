import { cn } from "cn";

interface Props {
  className?: string;
  playing?: boolean;
}

interface Grid {
  keyWidth: number;
  gap: number;
  board: number;
  white: number;
  black: number;
}

function KeyBars({ keyWidth, gap, board, white, black, className, playing }: Grid & Props) {
  const width = 3 * keyWidth + 2 * gap;
  const top = board + 1;
  const height = top + white;
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

export function PianoMark({ className, playing = false }: Props) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-ink shadow-1",
        className,
      )}
    >
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
