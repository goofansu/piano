import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

// Optional diagnostic, not a universal FPS guarantee. CDP input adds overhead; compare runs on
// the same host. This deliberately measures visible movement, not React implementation details.
export async function sidebarDragPerformance(send) {
  const evaluate = async (expression) =>
    (await send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
  await send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await evaluate(`(() => {
    window.sidebarPerf = { recording: false, lastX: 0, lastChange: 0, gaps: [], frame: 0 };
    const sample = (time) => {
      const state = window.sidebarPerf;
      if (state.recording) {
        const x = document.querySelector('[data-slot="layout-main"]').getBoundingClientRect().left;
        if (x !== state.lastX) {
          if (state.lastChange) state.gaps.push(time - state.lastChange);
          state.lastX = x;
          state.lastChange = time;
        }
      }
      state.frame = requestAnimationFrame(sample);
    };
    window.sidebarPerf.frame = requestAnimationFrame(sample);
    return true;
  })()`);
  try {
    for (let run = 0; run < 5; run++) {
      await evaluate("window.sidebarPerf.lastChange = 0; window.sidebarPerf.recording = true");
      await send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: 40, y: 300, id: 1 }],
      });
      const start = performance.now();
      for (let step = 1; step <= 28; step++) {
        await delay(Math.max(0, start + step * 16.67 - performance.now()));
        await send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: 40 + step * 10, y: 300, id: 1 }],
        });
      }
      await evaluate("window.sidebarPerf.recording = false");
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await delay(400);
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      await delay(350);
    }
    const gaps = await evaluate("window.sidebarPerf.gaps");
    assert.ok(gaps.length >= 100, "recorded motion throughout the five drags");
    const sorted = [...gaps].sort((a, b) => a - b);
    return {
      environment: "Chromium, 390x844, 4x CPU throttle; CDP-driven input, not physical Safari",
      samples: gaps.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      max: Math.max(...gaps),
      gaps,
    };
  } finally {
    await evaluate("cancelAnimationFrame(window.sidebarPerf.frame); delete window.sidebarPerf");
    await send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
}
