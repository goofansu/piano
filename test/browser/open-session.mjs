// Critical path 2: continue a session. Click it in the sidebar to read its transcript, jump to an
// earlier message, read the session's cost, send a follow-up and see the reply and the updated
// cost, then stop a running reply.
// node test/browser/open-session.mjs [evidence-directory]
import assert from "node:assert/strict";
import { run } from "./harness.mjs";

const timestamp = Date.now();
const usage = {
  input: 1000,
  output: 250,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 1250,
  cost: { input: 0.003, output: 0.0075, cacheRead: 0, cacheWrite: 0, total: 0.0105 },
};
const paragraph = "The login form posts the password before the CSRF token is refreshed. ".repeat(
  8,
);
const exchange = (n) => [
  { role: "user", content: `Question ${n}: why does login fail?`, timestamp },
  {
    role: "assistant",
    content: [{ type: "text", text: `Answer ${n}. ${paragraph}` }],
    api: "fake",
    provider: "fake",
    model: "alpha",
    usage,
    stopReason: "stop",
    timestamp,
  },
];

await run(
  "open-session",
  ({ repository, history }) => {
    const cwd = repository("api");
    const now = new Date().toISOString();
    const reference = (sessionId, title, cost) => ({
      sessionId,
      title,
      cwd,
      createdAt: now,
      updatedAt: now,
      // Pi's last statistics, which Piano keeps for each session it has run.
      stats: { cost, statsUpdatedAt: Date.now() },
    });
    history({ sessionId: "login-bug", cwd, messages: [1, 2, 3, 4, 5, 6].flatMap(exchange) });
    // Alternating prompts and Markdown replies expose per-row forced layout on session switches.
    const release = Array.from({ length: 60 }, (_, i) => exchange(i + 1)).flat();
    release.at(-2).content += `\n\n${paragraph.repeat(4)}`;
    release.at(-1).content[0].text += '\n\n```ts\nconst release = "ready";\n```';
    history({ sessionId: "release-notes", cwd, messages: release });
    return {
      folders: [cwd],
      sessions: [
        reference("login-bug", "Fix the login bug", 0.063),
        // Metadata-only neighbors expose sidebar mounting cost without more transcript fixtures.
        ...Array.from({ length: 1000 }, (_, i) =>
          reference(`history-${i}`, `History ${String(i).padStart(4, "0")}`, 0),
        ),
        reference("release-notes", "Release notes", 0.63),
      ],
    };
  },
  async (page) => {
    await page.open("/");
    await page.see("Fix the login bug");
    const nav = '[data-slot="layout-sidebar"] nav[aria-label="Sessions"]';
    assert.ok(
      (await page.evaluate(
        `document.querySelector(${JSON.stringify(nav)}).querySelectorAll('li').length`,
      )) < 100,
      "a large sidebar mounts a window, not every session",
    );
    // Tab must traverse the next logical row, not jump over an unmounted gap to the last row.
    const lastMounted = await page.evaluate(`(() => {
      const nav = document.querySelector(${JSON.stringify(nav)});
      const rows = [...nav.querySelectorAll('[aria-posinset]')];
      const row = rows.filter(r => Number(r.getAttribute('aria-posinset')) < 1002).at(-1);
      row.querySelector('button[aria-haspopup="menu"]').focus({ preventScroll: true });
      return Number(row.getAttribute('aria-posinset'));
    })()`);
    await page.press("Tab");
    assert.equal(
      await page.evaluate(
        `Number(document.activeElement.closest('li').getAttribute('aria-posinset'))`,
      ),
      lastMounted + 1,
      "Tab crosses the virtual window boundary without skipping sessions",
    );
    await page.press("Shift+Tab");
    assert.equal(
      await page.evaluate(
        `Number(document.activeElement.closest('li').getAttribute('aria-posinset'))`,
      ),
      lastMounted,
      "reverse Tab reaches the previous row menu",
    );
    const menuLabel = await page.evaluate("document.activeElement.getAttribute('aria-label')");
    await page.press("Enter");
    await page.until("!!document.querySelector('[role=menu]')");
    await page.evaluate(`(() => {
      const viewport = document.querySelector(${JSON.stringify(nav)}).closest('[data-slot="scroll-area-viewport"]');
      viewport.scrollTop = viewport.scrollHeight;
      return true;
    })()`);
    await page.until(`(() => {
      const nav = document.querySelector(${JSON.stringify(nav)});
      return [...nav.querySelectorAll('[aria-posinset]')].some(r => Number(r.getAttribute('aria-posinset')) === 1001);
    })()`);
    assert.equal(
      await page.evaluate("!!document.querySelector('[role=menu]')"),
      true,
      "scrolling retains an open row menu",
    );
    await page.press("Escape");
    await page.until(
      `document.activeElement?.getAttribute('aria-label') === ${JSON.stringify(menuLabel)}`,
    );
    await page.click("button", "Fix the login bug");
    await page.see("Answer 6.");
    await page.capture("1-transcript");

    const inView = (text) =>
      page.evaluate(`(() => {
        const box = document.querySelector('[data-slot="transcript"]').getBoundingClientRect();
        const article = [...document.querySelectorAll('[data-slot="transcript"] article')]
          .find(a => a.innerText.includes(${JSON.stringify(text)}));
        const at = article.getBoundingClientRect();
        return at.top >= box.top && at.top < box.bottom;
      })()`);
    assert.equal(await inView("Question 1:"), false, "the first question starts out of view");
    await page.click("button", "Jump to message");
    await page.ab(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "You said Question 1: why does login fail?",
    );
    await page.until(`(() => {
      const box = document.querySelector('[data-slot="transcript"]').getBoundingClientRect();
      const article = [...document.querySelectorAll('[data-slot="transcript"] article')]
        .find(a => a.innerText.includes('Question 1:'));
      return Math.abs(article.getBoundingClientRect().top - box.top) < 80;
    })()`);
    await page.capture("2-jumped");

    const sessionCost = async (step) => {
      await page.click("button", "Context usage");
      await page.until(`!!document.querySelector('[aria-label="Token and cost breakdown"]')`);
      const row = await page.evaluate(
        `[...document.querySelectorAll('[aria-label="Token and cost breakdown"] tr')].find(r => r.innerText.startsWith('Cost'))?.innerText`,
      );
      await page.capture(step);
      await page.ab("press", "Escape");
      await page.until("!document.querySelector('[data-radix-popper-content-wrapper]')");
      return row;
    };
    // Before Pi runs it: the last response's cost and Pi's last total for the session.
    assert.match(
      await sessionCost("3-cost"),
      /\$0\.0105\s+\$0\.0630/,
      "the session's cost when opened",
    );

    await page.ab("fill", '[aria-label="Message"]', "Add a regression test");
    await page.ab("press", "Enter");
    await page.see("echo: Add a regression test");
    assert.equal(await inView("Question 1:"), true, "a reply does not move a reader who jumped up");
    await page.capture("4-follow-up");

    // Pi now runs the session, so its fresh total includes the follow-up.
    assert.match(
      await sessionCost("5-cost-after-reply"),
      /\$0\.0063\s+\$0\.0693/,
      "the cost updates after the reply",
    );

    await page.ab("fill", '[aria-label="Message"]', "hold");
    await page.ab("press", "Enter");
    // Submission returns before Pi's running state necessarily reaches the browser.
    await page.ab("wait", 'button[aria-label="Stop"]');
    await page.click("button", "Stop");
    await page.until(`!!document.querySelector('[aria-label="Send"]')`);
    assert.ok(
      page.received().some((r) => r.command === "abort" && r.sessionId === "login-bug"),
      "Stop reaches Pi",
    );
    assert.deepEqual(
      page.prompts(),
      ["Add a regression test", "hold"],
      "each message is sent once",
    );
    await page.capture("6-stopped");

    // Switching through the palette must not execute a stale row while a new query is pending.
    await page.press("Mod+k");
    await page.ab("fill", "[cmdk-input]", "release notes");
    await page.until(
      "document.querySelector('[cmdk-list]')?.getAttribute('aria-busy') === 'false'",
    );
    // One task deliberately races input with Enter; separate browser commands would hide the race.
    await page.evaluate(`(() => {
      const input = document.querySelector('[cmdk-input]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'zzzzzzz');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      return true;
    })()`);
    await page.see("No sessions or commands match.");
    assert.ok(
      await page.evaluate("location.pathname.endsWith('/login-bug')"),
      "pending Enter did not switch sessions",
    );
    await page.ab("fill", "[cmdk-input]", "release notes");
    await page.until(
      "document.querySelector('[cmdk-list]')?.getAttribute('aria-busy') === 'false'",
    );
    await page.ab("press", "Enter");
    await page.until(
      "location.pathname.endsWith('/release-notes') && !document.querySelector('[cmdk-input]')",
    );
    await page.see("Answer 1.");
    await page.capture("7-palette-switch");
    assert.equal(
      await page.evaluate(`(() => {
      const row = document.querySelector(${JSON.stringify(nav)}).querySelector('[aria-current="page"]');
      const viewport = row.closest('[data-slot="scroll-area-viewport"]').getBoundingClientRect();
      const box = row.getBoundingClientRect();
      return box.top >= viewport.top && box.bottom <= viewport.bottom;
    })()`),
      true,
      "palette selection reveals a formerly offscreen sidebar row",
    );

    // Reopening a long session must not force a transcript layout for every prompt. Counting
    // browser layouts catches read/write thrashing without a flaky wall-clock performance limit.
    await page.click("button", "Fix the login bug");
    await page.see("echo: Add a regression test");
    const layouts = await page.layouts(async () => {
      await page.click("button", "Release notes");
      await page.see("Answer 60.");
      await page.until(`!!document.querySelector('button[aria-label="Copy code"]')`);
    });
    console.log(`Reopened 60 turns: ${layouts} browser layouts`);
    assert.ok(layouts < 20, `switching a 60-turn session took ${layouts} layouts`);
    await page.until(`(() => {
      const t = document.querySelector('[data-slot="transcript"]');
      return t.scrollHeight - t.scrollTop - t.clientHeight < 2;
    })()`);

    // Deferred overflow measurement still offers long prompts' complete text and works again
    // after collapsing and resizing. Code-copy controls remain present in the adjacent reply.
    await page.click("button", "Show more");
    await page.until(
      `document.querySelector('button[aria-expanded="true"][aria-controls]')?.textContent.includes('Show less')`,
    );
    const promptSize = () =>
      page.evaluate(`(() => {
      const toggle = [...document.querySelectorAll('button[aria-controls]')]
        .find(b => /Show (more|less)/.test(b.textContent));
      const text = document.getElementById(toggle.getAttribute('aria-controls'));
      return { height: text.clientHeight, content: text.scrollHeight };
    })()`);
    const expanded = await promptSize();
    assert.equal(expanded.height, expanded.content, "expanded prompt shows all its text");
    await page.click("button", "Show less");
    const collapsed = await promptSize();
    assert.ok(collapsed.height < collapsed.content, "collapsed prompt is capped again");
    await page.ab("set", "viewport", "800", "900");
    await page.click("button", "Show more");
    const resized = await promptSize();
    assert.equal(resized.height, resized.content, "prompt still expands after resizing");
    await page.click("button", "Copy code");
    await page.until(`!!document.querySelector('button[aria-label="Code copied"]')`);
    await page.ab("focus", '[aria-label="Message"]');
    await page.press("Mod+v");
    assert.equal(
      await page.evaluate(`document.querySelector('[aria-label="Message"]').value`),
      'const release = "ready";',
      "copy contains only the fenced code",
    );
    await page.capture("8-reopened-long-session");
  },
);
