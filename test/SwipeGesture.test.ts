import assert from "node:assert/strict";
import { test } from "node:test";
import { type SwipeEnd, type SwipeMove, startSwipe } from "../web/src/lib/swipeGesture.ts";

/** A 300px-wide sheet, so position 0.1 is 30px. Touches start 30px from the edge at y=200. */
const WIDTH = 300;
type Step = [x: number, t: number, y?: number];

function swipe({ open = false, x = 30 } = {}) {
  const gesture = startSwipe({ x, y: 200, time: 0 }, open, WIDTH);
  return {
    move: ([x, time, y = 200]: Step, extra: { cancelable?: boolean; selecting?: boolean } = {}) =>
      gesture.move({
        point: { x, y },
        touches: 1,
        time,
        cancelable: extra.cancelable ?? true,
        selecting: extra.selecting ?? false,
      }),
    drag(steps: Step[]): SwipeMove[] {
      return steps.map((step) => this.move(step));
    },
    end: (time: number, extra: { touches?: number; selecting?: boolean } = {}) =>
      gesture.end({ touches: extra.touches ?? 0, time, selecting: extra.selecting ?? false }),
    raw: gesture,
  };
}

const settled = (outcome: SwipeEnd) => {
  assert.equal(outcome.kind, "settle");
  if (outcome.kind !== "settle") throw new Error("unreachable");
  const [x1, y1, x2, y2] = outcome.easing.match(/[\d.]+/g)?.map(Number) ?? [];
  return { ...outcome, x1, y1, x2, y2 };
};

test("a touch decides nothing until it clearly moves, then claims horizontal drags only", () => {
  const cases: { name: string; open?: boolean; x?: number; steps: Step[]; last: SwipeMove }[] = [
    { name: "a small wobble", steps: [[36, 16, 204]], last: { kind: "ignore" } },
    { name: "vertical scrolling", steps: [[33, 16, 212]], last: { kind: "cancel" } },
    {
      name: "a wobble, then vertical scrolling",
      steps: [
        [36, 16, 204],
        [38, 32, 230],
      ],
      last: { kind: "cancel" },
    },
    {
      name: "an opening drag with some vertical drift",
      steps: [[54, 16, 212]],
      last: { kind: "claim", position: 0.08, opening: true },
    },
    { name: "a diagonal steeper than 1:2", steps: [[46, 16, 212]], last: { kind: "cancel" } },
    { name: "closing a closed sheet", steps: [[15, 16]], last: { kind: "cancel" } },
    {
      name: "opening an open sheet",
      open: true,
      x: 200,
      steps: [[215, 16]],
      last: { kind: "cancel" },
    },
    {
      name: "closing an open sheet",
      open: true,
      x: 200,
      steps: [[185, 16]],
      last: { kind: "claim", position: 0.95, opening: false },
    },
    {
      name: "progress after the claim, clamped at fully open",
      steps: [
        [45, 16],
        [480, 32],
      ],
      last: { kind: "progress", position: 1 },
    },
  ];
  for (const { name, open, x, steps, last } of cases) {
    const outcomes = swipe({ open, x }).drag(steps);
    assert.deepEqual(outcomes.at(-1), last, name);
  }
});

test("a cancelled gesture stays cancelled", () => {
  const g = swipe();
  assert.equal(g.move([33, 16, 212]).kind, "cancel");
  assert.equal(g.move([90, 32]).kind, "cancel");
  assert.equal(g.end(48).kind, "cancel");
});

test("the browser keeping the scroll, a second finger or a lost finger cancel the swipe", () => {
  assert.equal(swipe().move([45, 16], { cancelable: false }).kind, "cancel");
  for (const input of [
    { point: { x: 45, y: 200 }, touches: 2 },
    { point: null, touches: 1 },
  ]) {
    const g = swipe();
    assert.equal(g.move([45, 16]).kind, "claim");
    const outcome = g.raw.move({ ...input, time: 32, cancelable: true, selecting: false });
    assert.equal(outcome.kind, "cancel");
  }
});

test("a release without a claimed drag, or with a finger still down, does not settle", () => {
  const unclaimed = swipe();
  unclaimed.move([36, 16]);
  assert.equal(unclaimed.end(32).kind, "cancel");
  const fingerDown = swipe();
  fingerDown.move([90, 16]);
  assert.equal(fingerDown.end(32, { touches: 1 }).kind, "cancel");
});

test("release follows a deliberate flick, otherwise the nearer end", () => {
  const cases: {
    name: string;
    open?: boolean;
    x?: number;
    steps: Step[];
    release: number;
    opens: boolean;
  }[] = [
    {
      name: "a quick short flick opens",
      steps: [
        [45, 10],
        [60, 20],
        [75, 30],
      ],
      release: 40,
      opens: true,
    },
    {
      name: "the same distance dragged slowly stays closed",
      steps: [
        [45, 100],
        [60, 200],
        [75, 300],
      ],
      release: 310,
      opens: false,
    },
    {
      name: "a slow drag past halfway opens",
      steps: [
        [90, 300],
        [150, 600],
        [210, 900],
      ],
      release: 910,
      opens: true,
    },
    {
      name: "a slow drag short of halfway stays closed",
      steps: [
        [90, 300],
        [150, 900],
      ],
      release: 910,
      opens: false,
    },
    {
      name: "a fast flick too short to be deliberate stays closed",
      steps: [
        [42, 4],
        [50, 8],
      ],
      release: 10,
      opens: false,
    },
    {
      name: "a flick held still before release stays closed",
      steps: [
        [45, 10],
        [60, 20],
        [75, 30],
      ],
      release: 180,
      opens: false,
    },
    {
      name: "a fast stroke past halfway then a quick reversal closes",
      steps: [
        [90, 10],
        [150, 20],
        [210, 30],
        [200, 40],
      ],
      release: 45,
      opens: false,
    },
    {
      name: "a fast stroke past halfway without the reversal opens",
      steps: [
        [90, 10],
        [150, 20],
        [210, 30],
      ],
      release: 35,
      opens: true,
    },
    {
      name: "one slow jittery sample does not undo a fast stroke",
      steps: [
        [90, 10],
        [91, 15],
      ],
      release: 20,
      opens: true,
    },
    {
      name: "a quick closing flick on an open sheet closes",
      open: true,
      x: 240,
      steps: [
        [225, 10],
        [200, 20],
      ],
      release: 25,
      opens: false,
    },
  ];
  for (const { name, open, x, steps, release, opens } of cases) {
    const g = swipe({ open, x });
    g.drag(steps);
    assert.equal(settled(g.end(release)).open, opens, name);
  }
});

test("the settle carries the finger's speed into a stop, within 120-420ms", () => {
  // 1.5px/ms released 45px in: 255px remain, crossed at the finger's speed then easing out.
  const steady = swipe();
  steady.drag([
    [45, 10],
    [60, 20],
    [75, 30],
  ]);
  const s = settled(steady.end(40));
  assert.equal(s.open, true);
  assert.ok(s.duration > 120 && s.duration < 420, `duration ${s.duration}`);
  const handoff = ((s.y1 / s.x1) * 255) / s.duration; // px/ms at the first frame
  assert.ok(Math.abs(handoff - 1.5) < 0.01, `handoff ${handoff}px/ms`);
  assert.deepEqual([s.x2, s.y2], [0.5, 1], "ends with zero velocity");

  // A very fast flick is capped at the shortest settle and the steepest monotonic curve.
  const flick = swipe();
  flick.drag([
    [40, 1],
    [100, 7],
  ]);
  const fast = settled(flick.end(8));
  assert.equal(fast.duration, 120);
  assert.equal(fast.y1, 1);

  // A release from rest just past halfway glides the remaining 135px over the longest settle.
  const rest = swipe();
  rest.drag([
    [90, 300],
    [195, 900],
  ]);
  const slow = settled(rest.end(1200));
  assert.equal(slow.open, true);
  assert.equal(slow.duration, 420);
  assert.equal(slow.y1, 0, "starts from rest");

  // Nothing left to travel: the shortest settle, from rest.
  const full = swipe();
  full.drag([
    [100, 300],
    [400, 900],
  ]);
  const done = settled(full.end(1200));
  assert.deepEqual([done.open, done.duration, done.y1], [true, 120, 0]);
});

test("text selection takes over the touch and the swipe never resumes", () => {
  const beforeClaim = swipe();
  assert.deepEqual(beforeClaim.move([36, 16], { selecting: true }), { kind: "yield" });
  assert.equal(beforeClaim.move([90, 32]).kind, "cancel");

  // A long press selects mid-drag; the range collapsing while a handle moves does not revive it.
  const midDrag = swipe();
  assert.equal(midDrag.move([90, 16]).kind, "claim");
  assert.deepEqual(midDrag.move([150, 32], { selecting: true }), { kind: "yield" });
  assert.equal(midDrag.move([210, 48]).kind, "cancel");
  assert.equal(midDrag.end(56).kind, "cancel");

  // Selection that arrives only by release still keeps the sheet where it was.
  const atRelease = swipe();
  atRelease.drag([
    [90, 10],
    [210, 20],
  ]);
  assert.deepEqual(atRelease.end(25, { selecting: true }), { kind: "yield" });
});
