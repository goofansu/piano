import assert from "node:assert/strict";

export const measuredTranscriptAtBottom = `(() => {
  const transcript = document.querySelector('[data-slot="transcript"]');
  if (!transcript || transcript.hasAttribute('data-window-pending') ||
      transcript.querySelector('[data-slot="transcript-placeholder"]') ||
      transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight >= 2) return false;
  const rows = [...transcript.querySelectorAll('[data-index]')];
  if (rows.length === 0) return false;
  const boxes = rows.map(row => row.getBoundingClientRect());
  const last = rows.at(-1);
  if (Math.abs(boxes.at(-1).bottom - last.parentElement.getBoundingClientRect().bottom) > 1) return false;
  return boxes.slice(0, -1).every((box, index) =>
    Number(rows[index + 1].dataset.index) === Number(rows[index].dataset.index) + 1 &&
    Math.abs(box.bottom - boxes[index + 1].top) <= 1);
})()`;

export async function checkTranscriptResizeReadiness(page) {
  await page.ab("set", "viewport", "1280", "900");
  await page.open("/new");
  await page.see("Release notes");
  await page.evaluate(`(() => {
    const Native = window.ResizeObserver;
    const pending = new Map();
    const gate = window.__transcriptResize = {
      hold: false,
      pending: () => pending.size,
      release: () => {
        gate.hold = false;
        const callbacks = [...pending.values()];
        pending.clear();
        for (const callback of callbacks) callback();
      },
      restore: () => {
        gate.release();
        window.ResizeObserver = Native;
        delete window.__transcriptResize;
      },
    };
    window.ResizeObserver = class extends Native {
      constructor(callback) {
        super((entries, observer) => {
          if (gate.hold && entries.some(entry => entry.target.closest('[data-slot="transcript"]')))
            pending.set(observer, () => callback(entries, observer));
          else callback(entries, observer);
        });
      }
    };
  })()`);
  try {
    await page.click("button", "Release notes");
    await page.see("Answer 60.");
    await page.until(measuredTranscriptAtBottom);
    await page.evaluate("window.__transcriptResize.hold = true; true");
    await page.ab("set", "viewport", "800", "900");
    await page.until("window.__transcriptResize.pending() > 0");
    assert.equal(
      await page.evaluate(`(() => {
        const transcript = document.querySelector('[data-slot="transcript"]');
        return transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 2;
      })()`),
      true,
      "the old bottom-only check passes before resized rows are measured",
    );
    assert.equal(
      await page.evaluate(measuredTranscriptAtBottom),
      false,
      "a transcript with pending row measurements is not ready for a pointer click",
    );
    await page.evaluate("window.__transcriptResize.release(); true");
    await page.until(measuredTranscriptAtBottom);
    await page.click("button", "Show more");
    await page.see("Show less");
    const size = await page.evaluate(`(() => {
      const toggle = [...document.querySelectorAll('[data-slot="transcript"] button[aria-controls]')]
        .find(button => button.textContent.includes('Show less'));
      const content = document.getElementById(toggle.getAttribute('aria-controls'));
      return { height: content.clientHeight, full: content.scrollHeight };
    })()`);
    assert.equal(
      size.height,
      size.full,
      "the prompt expands after real resize measurements settle",
    );
    await page.capture("21-resize-measurements-settled");
  } finally {
    await page.evaluate("window.__transcriptResize.restore(); true");
  }
}
