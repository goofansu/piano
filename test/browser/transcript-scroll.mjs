import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { measuredTranscriptAtBottom } from "./transcript-resize.mjs";

const scenarios = [
  { id: "history-idle", width: 1280, height: 900, stream: false },
  { id: "history-stream", width: 1280, height: 900, stream: true },
  { id: "history-phone", width: 390, height: 844, stream: true },
];

export function seedScrollHistory({ history, cwd }) {
  const timestamp = 1700000000000;
  const messages = Array.from({ length: 60 }, (_, i) => [
    {
      role: "user",
      content: `Question ${i + 1}. ` + "Context varies. ".repeat((i % 7) * 20),
      timestamp,
    },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text:
            `Answer ${i + 1}.\n\n` +
            ("Paragraph with **bold** and `code`. ".repeat(5) + "\n\n").repeat(1 + (i % 12)),
        },
      ],
      api: "fake",
      provider: "fake",
      model: "alpha",
      stopReason: "stop",
      timestamp,
    },
  ]).flat();
  return scenarios.map(({ id }) => {
    history({ sessionId: id, cwd, messages });
    return {
      sessionId: id,
      title: id,
      cwd,
      createdAt: new Date(timestamp).toISOString(),
      updatedAt: new Date(timestamp).toISOString(),
    };
  });
}

export async function checkTranscriptHistoryScroll(page) {
  const results = [];
  for (const { id, width, height, stream } of scenarios) {
    await page.ab("set", "viewport", String(width), String(height));
    await page.open(`/s/${id}`);
    await page.see("Answer 60.");
    await page.until(measuredTranscriptAtBottom);
    if (stream) {
      await page.ab("fill", '[aria-label="Message"]', "stream");
      await page.ab("press", "Enter");
      await page.see("Streaming line 5.");
    }
    const result = await page.cdp(async (call) => {
      const evaluate = async (expression) => {
        const reply = await call("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        assert.ok(!reply.exceptionDetails, JSON.stringify(reply.exceptionDetails));
        return reply.result.value;
      };
      await evaluate(`(() => {
        const t = document.querySelector('[data-slot="transcript"]');
        const trace = window.historyScroll = { frames: [], wheels: [], recording: true };
        const wheel = e => trace.wheels.push({ time: performance.now(), delta: e.deltaY });
        t.addEventListener('wheel', wheel, { capture: true });
        trace.stop = () => { trace.recording = false; t.removeEventListener('wheel', wheel, true); };
        function frame(time) {
          if (!trace.recording) return;
          const box = t.getBoundingClientRect();
          const mounted = [...t.querySelectorAll('[data-index]')];
          const visible = mounted.flatMap(row => {
            const r = row.getBoundingClientRect();
            return r.bottom > box.top && r.top < box.bottom
              ? [{ index: Number(row.dataset.index), y: r.top, height: r.height,
                   placeholder: !!row.querySelector('[data-slot="transcript-placeholder"]') }]
              : [];
          });
          trace.frames.push({ time, top: t.scrollTop, mounted: mounted.length, visible });
          requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      })()`);
      try {
        const box = await evaluate(`(() => {
          const b = document.querySelector('[data-slot="transcript"]').getBoundingClientRect();
          return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        })()`);
        for (let step = 0; step < 32; step++) {
          await call("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            ...box,
            deltaX: 0,
            deltaY: -800,
          });
          await setTimeout(90);
        }
        await evaluate(`new Promise((resolve, reject) => {
          const t = document.querySelector('[data-slot="transcript"]');
          const start = performance.now();
          let previous = t.scrollTop, stable = 0;
          function frame() {
            stable = t.scrollTop === previous ? stable + 1 : 0;
            previous = t.scrollTop;
            if (stable >= 12) resolve();
            else if (performance.now() - start > 5000) reject(new Error('history scroll did not settle'));
            else requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        })`);
        return {
          id,
          ...(await evaluate("({ frames: historyScroll.frames, wheels: historyScroll.wheels })")),
        };
      } finally {
        await evaluate("window.historyScroll.stop(); delete window.historyScroll");
      }
    });
    let movedUp = false;
    const shifts = [];
    for (let i = 1; i < result.frames.length; i++) {
      const previous = result.frames[i - 1];
      const frame = result.frames[i];
      if (frame.time < result.wheels[0].time) continue;
      if (frame.top < previous.top) movedUp = true;
      if (!movedUp) continue;
      for (const row of frame.visible) {
        const before = previous.visible.find((old) => old.index === row.index);
        if (before && row.y < before.y - 3)
          shifts.push({ time: frame.time, index: row.index, delta: row.y - before.y });
      }
    }
    const summary = {
      id,
      shifts,
      blankFrames: result.frames.filter((f) => !f.visible.length).length,
      placeholderFrames: result.frames.filter((f) => f.visible.some((r) => r.placeholder)).length,
      peakRows: Math.max(...result.frames.map((f) => f.mounted)),
    };
    results.push({ ...result, summary });
    writeFileSync(`${page.evidence}/history-scroll.json`, JSON.stringify(results, null, 2));
    console.log("History scroll:", summary);
    await page.capture(id);
    if (stream) await page.click("button", "Stop");
    assert.ok(movedUp && result.wheels.length === 32, "native upward scrolling was applied");
    assert.ok(
      result.frames.at(-1).visible[0].index < result.frames[0].visible[0].index - 20,
      "the reader crossed older history, not only the streaming row",
    );
    assert.equal(summary.blankFrames, 0, `${id}: history stays visible`);
    assert.equal(
      summary.placeholderFrames,
      0,
      `${id}: resident history does not flash placeholders`,
    );
    assert.deepEqual(
      shifts,
      [],
      `${id}: shared visible rows do not move backward during upward scrolling`,
    );
    assert.ok(summary.peakRows <= 25, `${id}: virtualization stays bounded`);
  }
  await page.ab("set", "viewport", "1280", "900");
}
