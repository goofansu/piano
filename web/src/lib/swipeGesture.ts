/**
 * The mobile sidebar's swipe, as decisions over touch samples. A gesture starts where an eligible
 * touch lands, waits until the finger has clearly moved, then either yields (vertical scrolling,
 * the wrong direction, a second finger, an uncancelable event) or claims the drag and tracks it
 * 1:1. Release opens or closes the sheet: a deliberate flick follows its direction, otherwise the
 * nearer end wins. Text selection takes over the touch outright. Which touches are eligible, scroll prevention, painting and click
 * suppression stay in the DOM; nothing here depends on React or the browser.
 */

/** Movement under this many pixels in either axis decides nothing yet. */
const CLAIM_SLOP = 10;
/** A flick must travel at least this far to override the nearer end. */
const FLICK_DISTANCE = 24;
/** And move faster than this, in px/ms. */
const FLICK_SPEED = 0.5;
/** A release this long after the last movement carries no velocity. */
const STALE_VELOCITY_MS = 100;
/** Samples this far apart replace the velocity outright; closer ones are blended. */
const SMOOTHING_MS = 50;

export interface SwipeStart {
  x: number;
  y: number;
  time: number;
}

export interface SwipeMoveInput {
  /** The tracked finger, or null when it has left the screen. */
  point: { x: number; y: number } | null;
  /** Fingers on the screen now. */
  touches: number;
  time: number;
  /** The browser still lets this event's scrolling be prevented. */
  cancelable: boolean;
  /** A text selection exists, so selection has taken over the touch. */
  selecting: boolean;
}

export interface SwipeEndInput {
  /** Fingers still on the screen. */
  touches: number;
  time: number;
  selecting: boolean;
}

export type SwipeMove =
  /** Undecided: the finger has not moved far enough to choose. */
  | { kind: "ignore" }
  /** The touch is not a sidebar swipe; leave it to the browser. */
  | { kind: "cancel" }
  /** Text selection owns the touch; nothing the drag did should linger. */
  | { kind: "yield" }
  /** The drag is now the sidebar's; `opening` when it started closed. */
  | { kind: "claim"; position: number; opening: boolean }
  | { kind: "progress"; position: number };

export type SwipeEnd =
  | { kind: "cancel" }
  | { kind: "yield" }
  /** Come to rest `open`. */
  | { kind: "settle"; open: boolean };

export interface SwipeGesture {
  move(input: SwipeMoveInput): SwipeMove;
  end(input: SwipeEndInput): SwipeEnd;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Track one finger from `start` on a sheet that is `open` and `width` pixels wide. After any
 * outcome other than ignore, claim or progress the gesture is over and stays cancelled.
 */
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
        // Smooth event-to-event jitter, but respond immediately to a deliberate reversal.
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
      return { kind: "settle", open: next };
    },
  };
}
