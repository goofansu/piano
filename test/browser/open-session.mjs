// Critical path 2: continue a session. Click it in the sidebar to read its transcript, jump to an
// earlier message, send a follow-up and see the reply, read the session's cost, then stop a
// running reply.
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
    const reference = (sessionId, title) => ({
      sessionId,
      title,
      cwd,
      createdAt: now,
      updatedAt: now,
    });
    history({ sessionId: "login-bug", cwd, messages: [1, 2, 3, 4, 5, 6].flatMap(exchange) });
    history({ sessionId: "release-notes", cwd, messages: exchange(1) });
    return {
      folders: [cwd],
      sessions: [
        reference("login-bug", "Fix the login bug"),
        reference("release-notes", "Release notes"),
      ],
    };
  },
  async (page) => {
    await page.open("/");
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

    await page.ab("fill", '[aria-label="Message"]', "Add a regression test");
    await page.ab("press", "Enter");
    await page.see("echo: Add a regression test");
    await page.capture("3-follow-up");

    await page.click("button", "Context usage");
    await page.until(`!!document.querySelector('[aria-label="Token and cost breakdown"]')`);
    const cost = await page.evaluate(
      `[...document.querySelectorAll('[aria-label="Token and cost breakdown"] tr')].find(r => r.innerText.startsWith('Cost'))?.innerText`,
    );
    // Pi reports the session total once it runs the session; the follow-up started it.
    assert.match(cost, /\$0\.0063\s+\$0\.0693/, "the last response's and the session's cost");
    await page.capture("4-cost");
    await page.ab("press", "Escape");

    await page.ab("fill", '[aria-label="Message"]', "hold");
    await page.ab("press", "Enter");
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
    await page.capture("5-stopped");
  },
);
