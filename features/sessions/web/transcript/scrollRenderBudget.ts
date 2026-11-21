const INPUT_MS = 1000;
const SHARE = 0.25;
const DEBT_MS = 16;

export interface ScrollRenderBudget {
  input: () => void;
  scrolled: () => void;
  mounted: () => void;
  settled: () => void;
  affordable: () => boolean;
}

export function createScrollRenderBudget(
  now: () => number = () => performance.now(),
  nextFrame: (run: () => void) => void = (run) => requestAnimationFrame(run),
): ScrollRenderBudget {
  let inputAt = -Infinity;
  let debt = 0;
  let at = 0;
  let frame = 0;
  let scrolledFrame = -2;
  let counting = false;
  let mounting = false;
  let affordable = false;
  const count = () => {
    frame += 1;
    if (frame - scrolledFrame < 3) nextFrame(count);
    else counting = false;
  };
  return {
    input: () => {
      inputAt = now();
    },
    scrolled: () => {
      const time = now();
      debt = Math.max(0, debt - (time - at) * SHARE);
      at = time;
      mounting = false;
      const rested = frame - scrolledFrame > 1;
      affordable = time - inputAt < INPUT_MS && (rested || debt < DEBT_MS);
      scrolledFrame = frame;
      if (!counting) {
        counting = true;
        nextFrame(count);
      }
    },
    mounted: () => {
      mounting = true;
    },
    settled: () => {
      if (mounting) debt += now() - at;
      mounting = false;
    },
    affordable: () => affordable,
  };
}
