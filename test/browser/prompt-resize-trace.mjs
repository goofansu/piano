import { writeFileSync } from "node:fs";
import { join } from "node:path";

export async function withPromptResizeTrace(page, observe) {
  await page.evaluate(`(() => {
    const transcript = document.querySelector('[data-slot="transcript"]');
    const records = [];
    let total = 0;
    const describe = (element) => element instanceof Element ? {
      tag: element.tagName,
      slot: element.getAttribute('data-slot'),
      label: element.getAttribute('aria-label'),
      controls: element.getAttribute('aria-controls'),
      expanded: element.getAttribute('aria-expanded'),
    } : null;
    const buttons = () => [...transcript.querySelectorAll('button[aria-controls]')]
      .filter(button => /Show (more|less)/.test(button.textContent));
    const record = (kind, detail = {}) => {
      const entry = {
        time: performance.now(), kind, detail,
        viewport: { width: innerWidth, height: innerHeight },
        scroll: {
          top: transcript.scrollTop,
          height: transcript.scrollHeight,
          visible: transcript.clientHeight,
        },
        buttons: buttons().map(button => {
          const { x, y, width, height } = button.getBoundingClientRect();
          const content = document.getElementById(button.getAttribute('aria-controls'));
          return {
            ...describe(button), text: button.textContent.trim(),
            rect: { x, y, width, height },
            centerTarget: describe(document.elementFromPoint(x + width / 2, y + height / 2)),
            content: content && { height: content.clientHeight, full: content.scrollHeight },
          };
        }),
      };
      total++;
      if (records.length === 1000) records.shift();
      records.push(entry);
    };
    const pointer = event => {
      const detail = {
        x: event.clientX, y: event.clientY, button: event.button, detail: event.detail,
        trusted: event.isTrusted, target: describe(event.target),
        hit: describe(document.elementFromPoint(event.clientX, event.clientY)),
        path: event.composedPath().slice(0, 5).map(describe),
      };
      record(event.type, detail);
      queueMicrotask(() => record('after-' + event.type, detail));
    };
    const pointerEvents = ['pointerdown', 'pointerup', 'click'];
    for (const name of pointerEvents) document.addEventListener(name, pointer, true);
    const resized = () => record('viewport-resize');
    const scrolled = () => record('transcript-scroll');
    window.addEventListener('resize', resized);
    transcript.addEventListener('scroll', scrolled);
    const mutation = new MutationObserver(changes => record('mutation', {
      changes: changes.slice(0, 20).map(change => ({
        type: change.type, attribute: change.attributeName, old: change.oldValue,
        target: describe(change.target),
        added: change.addedNodes.length, removed: change.removedNodes.length,
      })),
    }));
    mutation.observe(transcript, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['aria-expanded', 'aria-controls'], attributeOldValue: true,
    });
    const resize = new ResizeObserver(() => record('element-resize'));
    resize.observe(transcript);
    for (const button of buttons()) {
      resize.observe(button);
      const content = document.getElementById(button.getAttribute('aria-controls'));
      if (content) resize.observe(content);
    }
    record('installed');
    window.__pianoPromptResizeTrace = () => {
      record('finished');
      for (const name of pointerEvents) document.removeEventListener(name, pointer, true);
      window.removeEventListener('resize', resized);
      transcript.removeEventListener('scroll', scrolled);
      mutation.disconnect();
      resize.disconnect();
      delete window.__pianoPromptResizeTrace;
      return { total, omitted: total - records.length, records };
    };
  })()`);
  try {
    await observe();
  } finally {
    try {
      const trace = await page.evaluate("window.__pianoPromptResizeTrace()");
      writeFileSync(
        join(page.evidence, "prompt-resize-trace.json"),
        JSON.stringify(trace, null, 2),
      );
    } catch (error) {
      console.error("Could not retain prompt resize trace:", error);
    }
  }
}
