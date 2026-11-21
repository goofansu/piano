import assert from "node:assert/strict";
import { test } from "node:test";
import { createScrollRenderBudget } from "../web/src/features/transcript/scrollRenderBudget.ts";

function harness() {
  let time = 0;
  let queued: Array<() => void> = [];
  const budget = createScrollRenderBudget(
    () => time,
    (run) => queued.push(run),
  );
  const frame = (ms = 16) => {
    time += ms;
    const due = queued;
    queued = [];
    for (const run of due) run();
  };
  const scroll = ({ input = true, mountMs = 0 } = {}) => {
    if (input) budget.input();
    budget.scrolled();
    const affordable = budget.affordable();
    if (mountMs > 0) {
      budget.mounted();
      time += mountMs;
      budget.settled();
    }
    frame();
    return affordable;
  };
  const wait = (ms: number) => {
    time += ms;
  };
  return { budget, frame, scroll, wait };
}

test("only scrolling the reader drives renders rows before paint", () => {
  const seeking = harness();
  assert.equal(seeking.scroll({ input: false }), false);
  assert.equal(seeking.scroll({ input: false }), false);

  const reading = harness();
  assert.equal(reading.scroll(), true);
  assert.equal(reading.scroll(), true);
});

test("sustained scrolling defers rows once mounting them costs frames, then recovers", () => {
  const { scroll } = harness();
  assert.equal(scroll({ mountMs: 120 }), true);
  assert.equal(scroll({ mountMs: 0 }), false);
  assert.equal(scroll({ mountMs: 0 }), false);
  let recovered = false;
  for (let i = 0; i < 120 && !recovered; i++) recovered = scroll();
  assert.equal(recovered, true);
});

test("cheap mounts never defer sustained scrolling", () => {
  const { scroll } = harness();
  for (let i = 0; i < 120; i++) assert.equal(scroll({ mountMs: 2 }), true);
});

test("a scroll that starts from rest renders before paint despite earlier cost", () => {
  const { scroll, frame } = harness();
  scroll({ mountMs: 120 });
  assert.equal(scroll(), false);
  frame();
  frame();
  assert.equal(scroll({ mountMs: 120 }), true);
  frame();
  frame();
  assert.equal(scroll(), true);
});

test("measuring rows that did not mount during the scroll costs nothing", () => {
  const { budget, scroll, frame, wait } = harness();
  budget.input();
  budget.scrolled();
  wait(120);
  budget.settled();
  frame();
  assert.equal(scroll(), true);
});

test("scrolling long after the reader's last input is deferred", () => {
  const { scroll, frame } = harness();
  assert.equal(scroll(), true);
  for (let i = 0; i < 300; i++) frame();
  assert.equal(scroll({ input: false }), false);
});
