import assert from "node:assert/strict";

export const fidelityText = "a: 1\nb: 2\nc: 3\n\nExample token: demo-not-a-real-credential";

export async function checkMessageFidelity(page) {
  await page.ab("fill", '[aria-label="Message"]', fidelityText);
  await page.press("Enter");
  await page.see("echo: a: 1");
  await page.until("!document.querySelector('[aria-label=Stop]')");
  const measure = async (stage, count) => {
    const rows = await page.evaluate(`(() => {
      return [...document.querySelectorAll('[data-slot="transcript"] article')].flatMap(article => {
        const p = [...article.querySelectorAll('p')].find(p => p.textContent.includes('a: 1') && p.textContent.includes('c: 3'));
        if (!p) return [];
        const tops = ['a: 1', 'b: 2', 'c: 3'].map(line => {
          const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
          for (let node; (node = walker.nextNode());) {
            const index = node.textContent.indexOf(line);
            if (index < 0) continue;
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + line.length);
            return range.getBoundingClientRect().top;
          }
          return null;
        });
        return [{ tops, text: article.textContent }];
      });
    })()`);
    console.log(JSON.stringify({ stage, rows }));
    await page.capture(`message-fidelity-${stage}`);
    assert.equal(rows.length, count);
    for (const row of rows) {
      const [a, b, c] = row.tops;
      assert.ok(a !== null && b > a + 5 && c > b + 5, `${stage}: three separate rendered lines`);
      assert.ok(
        row.text.includes("Example token: demo-not-a-real-credential"),
        `${stage}: original text`,
      );
    }
  };
  await measure("settled", 2);
  await page.ab("reload");
  await page.see("echo: a: 1");
  await measure("reloaded", 2);
  const copy = await page.evaluate(`(() => {
    const article = [...document.querySelectorAll('[data-slot="transcript"] article[id]')]
      .find(a => a.textContent.includes('echo: a: 1'));
    return '#' + CSS.escape(article.id) + ' button[aria-label="Copy response"]';
  })()`);
  await page.ab("focus", copy);
  await page.ab("click", copy);
  await page.until(`!!document.querySelector('[aria-label="Response copied"]')`);
  if (process.platform !== "darwin") {
    await page.ab("focus", '[aria-label="Message"]');
    await page.press("Mod+v");
    assert.equal(
      await page.evaluate(`document.querySelector('[aria-label="Message"]').value`),
      `echo: ${fidelityText}`,
      "copy retains source newlines and token-like text",
    );
  } else console.log("SKIP copied-content check on macOS (headless Chrome cannot paste)");
  await page.ab("fill", '[aria-label="Message"]', "stream-fidelity");
  await page.press("Enter");
  await page.until(
    `document.querySelector('.streaming-caret')?.textContent.includes('demo-not-a-real-credential')`,
  );
  await measure("streaming", 3);
  await page.click("button", "Stop");
  await page.until("!document.querySelector('[aria-label=Stop]')");
}
