const CLAIM_SLOP = 10;
const FLICK_DISTANCE = 24;
const FLICK_SPEED = 0.5;
const STALE_VELOCITY_MS = 100;
const SMOOTHING_MS = 50;
const SETTLE_MS = { min: 120, max: 420 };

export interface SwipeStart {
  x: number;
  y: number;
  time: number;
}

export interface SwipeMoveInput {
  point: { x: number; y: number } | null;
  touches: number;
  time: number;
  cancelable: boolean;
  selecting: boolean;
}

export interface SwipeEndInput {
  touches: number;
  time: number;
  selecting: boolean;
}

export type SwipeMove =
  | { kind: "ignore" }
  | { kind: "cancel" }
  | { kind: "yield" }
  | { kind: "claim"; position: number; opening: boolean }
  | { kind: "progress"; position: number };

export type SwipeEnd =
  | { kind: "cancel" }
  | { kind: "yield" }
  | { kind: "settle"; open: boolean; duration: number; easing: string };

export interface SwipeGesture {
  move(input: SwipeMoveInput): SwipeMove;
  end(input: SwipeEndInput): SwipeEnd;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function startSwipe(start: SwipeStart, open: boolean, width: number): SwipeGesture {
  const initial = open ? 1 : 0;
  let claimed = false;
  let over = false;
  let position = initial;
  let lastX = start.x;
  let lastTime = start.time;
  let velocity = 0;

  const finish = <T extends { kind: "cancel" | "yield" }>(outcome: T): T => {
    over = true;
    return outcome;
  };

  return {
    move({ point, touches, time, cancelable, selecting }) {
      if (over) return { kind: "cancel" };
      if (selecting) return finish({ kind: "yield" });
      if (!point || touches !== 1) return finish({ kind: "cancel" });
      const dx = point.x - start.x;
      const dy = Math.abs(point.y - start.y);
      let claimedNow = false;
      if (!claimed) {
        if (dy > CLAIM_SLOP && dy > Math.abs(dx) / 2) return finish({ kind: "cancel" });
        if (Math.abs(dx) < CLAIM_SLOP) return { kind: "ignore" };
        if ((initial === 0 ? dx : -dx) < 0 || !cancelable) return finish({ kind: "cancel" });
        claimed = claimedNow = true;
      }
      const elapsed = time - lastTime;
      if (elapsed > 0) {
        const sample = (point.x - lastX) / elapsed;
        const weight = Math.min(1, elapsed / SMOOTHING_MS);
        velocity = sample * velocity <= 0 ? sample : velocity + weight * (sample - velocity);
      }
      lastX = point.x;
      lastTime = time;
      position = clamp(initial + dx / width);
      return claimedNow
        ? { kind: "claim", position, opening: initial === 0 }
        : { kind: "progress", position };
    },
    end({ touches, time, selecting }) {
      if (over) return { kind: "cancel" };
      if (selecting) return finish({ kind: "yield" });
      if (!claimed || touches) return finish({ kind: "cancel" });
      over = true;
      const release = time - lastTime < STALE_VELOCITY_MS ? velocity : 0;
      const moved = Math.abs(position - initial) * width;
      const next =
        moved >= FLICK_DISTANCE && Math.abs(release) > FLICK_SPEED ? release > 0 : position >= 0.5;
      const remaining = Math.abs(Number(next) - position) * width;
      const speed = release * (Number(next) - position) > 0 ? Math.abs(release) : 0;
      const duration = Math.round(
        Math.min(
          SETTLE_MS.max,
          Math.max(SETTLE_MS.min, (remaining * 2) / Math.max(FLICK_SPEED, speed)),
        ),
      );
      const y1 = remaining > 0 ? Math.min(1, (speed * duration) / (remaining * 3)) : 0;
      return {
        kind: "settle",
        open: next,
        duration,
        easing: `cubic-bezier(${1 / 3}, ${y1}, 0.5, 1)`,
      };
    },
  };
}
