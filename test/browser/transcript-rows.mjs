// Transcript rows: every row kind sits beside a gutter glyph that centres on its first text line.
// A session with each kind is seeded, and every gutter on the page is measured, with the folds as
// they start and again with every fold open (docs/testing.md §Alignment). A new row kind is added
// to `messages` here when it is added to the transcript.
// node test/browser/transcript-rows.mjs [evidence-directory]
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
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
const user = (content) => ({ role: "user", content, timestamp });
const assistant = (content, extra = {}) => ({
  role: "assistant",
  content,
  api: "fake",
  provider: "fake",
  model: "alpha",
  usage,
  stopReason: "stop",
  timestamp,
  ...extra,
});
const call = (id, name, args) => ({ type: "toolCall", id, name, arguments: args });
const result = (id, name, text, details) => ({
  role: "toolResult",
  toolCallId: id,
  toolName: name,
  content: [{ type: "text", text }],
  details,
  isError: false,
  timestamp,
});
const skill =
  '<skill name="review" location="/home/someone/.pi/skills/review/SKILL.md">\n' +
  "References are relative to /home/someone/.pi/skills/review.\n\n# Review\n\nRead the diff.\n</skill>";

/** One of each row kind, each with a distinct first line to find it by. The compaction comes
 * first: Pi's projection shows the summary and what follows it, not what it summarized. */
const messages = [
  { custom: { customType: "piano.dispatch", data: { parentSessionId: "rows-parent" } } },
  user("Earlier question, summarized away."),
  assistant([{ type: "text", text: "Earlier reply, kept by the compaction." }]),
  { compaction: { summary: "## Goal\n\nFix the login bug." } },
  user("Question: why does login fail?"),
  assistant([{ type: "text", text: "Reply: the CSRF token is stale." }]),
  assistant([call("run", "bash", { command: "npm test" })]),
  result("run", "bash", "ok"),
  assistant([
    call("questions", "ask_user", {
      questions: [
        { id: "database", question: "Which database?", options: ["PostgreSQL", "SQLite"] },
        { id: "requirements", question: "What should change?" },
      ],
    }),
  ]),
  result(
    "questions",
    "ask_user",
    JSON.stringify({
      status: "answered",
      answers: { database: "SQLite", requirements: "Keep the API\nChange the layout" },
    }),
  ),
  assistant([
    call("dispatch", "piano_start_session", {
      prompt: "Review the login fix.",
      worktree: { branch: "review-login" },
    }),
  ]),
  result(
    "dispatch",
    "piano_start_session",
    JSON.stringify({
      cwd: "/repo.review-login",
      creation: "created",
      submission: "started",
      handle: { cwd: "/repo.review-login", sessionId: "rows-parent" },
      worktree: { path: "/repo.review-login", branch: "review-login" },
      link: "http://127.0.0.1/s/rows-parent",
    }),
  ),
  assistant([call("status", "piano_session_status", { sessionId: "rows-elsewhere" })]),
  result(
    "status",
    "piano_session_status",
    JSON.stringify({
      sessionId: "rows-elsewhere",
      cwd: "/repo",
      projectId: null,
      disposition: "needs_input",
      since: new Date(timestamp).toISOString(),
      needs: { title: "Enter a value", kind: "input", link: "http://127.0.0.1/s/rows-elsewhere" },
      lastAnswer: null,
      changes: { branch: "main", files: 0, pullRequest: null },
      link: "http://127.0.0.1/s/rows-elsewhere",
    }),
  ),
  user(`${skill}\n\nFocus on login.`),
  assistant([{ type: "text", text: "" }], { stopReason: "error", errorMessage: "Rate limited" }),
  assistant([{ type: "text", text: "Done: every row kind is above." }]),
];

/** Every expected row, by the first text its gutter sits beside. */
const expected = [
  "Dispatched from",
  "Compaction summary",
  "Earlier reply, kept by the compaction.",
  "Question: why does login fail?",
  "Reply: the CSRF token is stale.",
  "Ran",
  "Answers",
  "Review the login fix.",
  "Session",
  "/skill:",
  "Rate limited",
  "Done: every row kind is above.",
];

const measure = `(() => [...document.querySelectorAll('[data-slot="gutter"]')].map((gutter) => {
  const glyph = gutter.firstElementChild;
  const walker = document.createTreeWalker(gutter.nextElementSibling, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.textContent.trim() && !n.parentElement.closest('.sr-only') ? 1 : 2,
  });
  const text = walker.nextNode();
  if (!glyph || !text) return null;
  const range = document.createRange();
  range.selectNodeContents(text);
  const line = range.getClientRects()[0], box = glyph.getBoundingClientRect();
  return { text: text.textContent.trim().slice(0, 40), offset: Math.round((box.top + box.bottom - line.top - line.bottom) / 2) };
}).filter(Boolean))()`;

await run(
  "transcript-rows",
  ({ repository, history }) => {
    const cwd = repository("api");
    const now = new Date().toISOString();
    history({ sessionId: "rows", cwd, messages });
    history({ sessionId: "rows-parent", cwd, messages: [user("Dispatch a review.")] });
    return {
      folders: [cwd],
      sessions: [
        { sessionId: "rows", title: "Every row kind", cwd, createdAt: now, updatedAt: now },
        { sessionId: "rows-parent", title: "The dispatcher", cwd, createdAt: now, updatedAt: now },
      ],
    };
  },
  async (page) => {
    // Alignment measures every fixture together; a tall viewport keeps them all in the window.
    // Bounded mounting and offscreen remounting are covered by open-session and session-perf.
    await page.ab("set", "viewport", "1280", "4000");
    await page.open("/");
    await page.click("button", "Every row kind");
    await page.see("Done: every row kind is above.");
    await page.see("Which database?");
    assert.deepEqual(
      await page.evaluate(`[...document.querySelectorAll('[data-slot="question-answers"] [role="listitem"]')].map(item => ({
        question: item.querySelector('[data-slot="item-title"]').textContent,
        answer: item.querySelector('p').textContent,
      }))`),
      [
        { question: "Which database?", answer: "SQLite" },
        { question: "What should change?", answer: "Keep the API\nChange the layout" },
      ],
      "saved question/answer pairs start expanded, not hidden behind raw JSON",
    );
    await page.capture("1-rows");
    const rows = await page.evaluate(measure);
    writeFileSync(
      join(process.argv[2] ?? ".scratch/browser/transcript-rows", "offsets.json"),
      JSON.stringify(rows, null, 2),
    );
    for (const first of expected)
      assert.ok(
        rows.some((row) => row.text.startsWith(first)),
        `no gutter row starts with ${JSON.stringify(first)}; measured: ${rows.map((r) => r.text).join(" | ")}`,
      );
    const off = rows.filter((row) => Math.abs(row.offset) > 1);
    assert.deepEqual(
      off,
      [],
      `glyphs off their first line by more than 1px: ${JSON.stringify(off)}`,
    );

    // Every folding row opens the same way: its whole body, a tool's output included, sits in
    // the fold's animated content, and the glyphs stay on their lines while open.
    const closed = await page.evaluate(`[...document.querySelectorAll(
      '[data-slot="collapsible-trigger"][aria-expanded="false"]:not(:disabled)')].map((trigger, i) => {
      trigger.setAttribute("data-fold-probe", String(i));
      return trigger.closest('[role="group"]').getAttribute("aria-label");
    })`);
    assert.ok(closed.includes("bash tool call"), `closed folds: ${closed.join(" | ")}`);
    for (const [i] of closed.entries()) {
      // Centred, so the scroll-to-bottom button never covers the header.
      await page.ab(
        "eval",
        `document.querySelector('[data-fold-probe="${i}"]').scrollIntoView({ block: "center" })`,
      );
      await page.ab("click", `[data-fold-probe="${i}"]`);
    }
    await page.until(
      `[...document.querySelectorAll('[data-slot="collapsible-content"]')].every((c) => c.dataset.state === "open" && !c.getAnimations().length)`,
    );
    await page.capture("2-open");
    const bodies = await page.evaluate(`[...document.querySelectorAll('[role="group"]')]
      .filter((group) => group.querySelector(':scope [data-slot="collapsible-trigger"]'))
      .map((group) => {
        const trigger = group.querySelector('[data-slot="collapsible-trigger"]');
        const outside = [...group.querySelectorAll('[data-slot="row-content"], pre, p, dl')].filter(
          (el) => !trigger.contains(el) && !el.contains(trigger) && !el.closest('[data-slot="collapsible-content"]'),
        );
        return { label: group.getAttribute("aria-label"), outside: outside.map((el) => el.textContent.slice(0, 40)) };
      })`);
    const leaked = bodies.filter((body) => body.outside.length);
    assert.deepEqual(leaked, [], `fold body outside its content: ${JSON.stringify(leaked)}`);
    const opened = await page.evaluate(measure);
    writeFileSync(
      join(process.argv[2] ?? ".scratch/browser/transcript-rows", "offsets-open.json"),
      JSON.stringify(opened, null, 2),
    );
    const offOpen = opened.filter((row) => Math.abs(row.offset) > 1);
    assert.deepEqual(offOpen, [], `open glyphs off their line: ${JSON.stringify(offOpen)}`);
    const tool = '[role="group"][aria-label="bash tool call"]';
    // Tool edges align optically: measure the painted SVG path (including its round stroke),
    // not just its viewBox. Equal CSS padding would leave the chevron farther in than the dot.
    const edges = [];
    for (const width of [1280, 390]) {
      await page.ab("set", "viewport", String(width), "4000");
      const edge = await page.evaluate(`(() => {
        const group = document.querySelector('${tool}');
        const trigger = group.querySelector('[data-slot="tool-header"] button');
        const header = trigger.getBoundingClientRect();
        const dot = trigger.querySelector('[data-slot="gutter"] > *').getBoundingClientRect();
        const content = trigger.querySelector('[data-slot="row-content"]').getBoundingClientRect();
        const body = group.querySelector('[data-slot="collapsible-content"] [data-slot="row-content"]').getBoundingClientRect();
        const path = trigger.querySelector('svg path'), bounds = path.getBBox(), matrix = path.getScreenCTM();
        const points = [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y],
          [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height]]
          .map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
        const inkRight = Math.max(...points.map(p => p.x)) + parseFloat(getComputedStyle(path).strokeWidth) / 2 * Math.hypot(matrix.a, matrix.b);
        return { width: innerWidth, dotInset: dot.left - header.left, chevronInset: header.right - inkRight,
          leftOffset: body.left - content.left, rightOffset: body.right - inkRight,
          clickWidth: header.width, groupWidth: group.getBoundingClientRect().width };
      })()`);
      edges.push(edge);
      assert.equal(edge.leftOffset, 0, "tool body starts under the header text");
      assert.equal(edge.clickWidth, edge.groupWidth, "tool header remains a full-width target");
      assert.ok(
        Math.abs(edge.dotInset - edge.chevronInset) <= 1,
        `tool glyph insets: ${JSON.stringify(edge)}`,
      );
      assert.ok(
        Math.abs(edge.rightOffset) <= 1,
        `tool body/chevron right edge: ${JSON.stringify(edge)}`,
      );
    }
    writeFileSync(
      join(process.argv[2] ?? ".scratch/browser/transcript-rows", "tool-edges.json"),
      JSON.stringify(edges, null, 2),
    );
    await page.ab("set", "viewport", "1280", "4000");
    assert.equal(
      await page.evaluate(
        `document.querySelector('${tool} [data-slot="collapsible-content"]').textContent.includes("ok")`,
      ),
      true,
      "the tool's output shows in its open body",
    );
    await page.ab(
      "eval",
      `document.querySelector('${tool} [data-slot="collapsible-trigger"]').scrollIntoView({ block: "center" })`,
    );
    await page.ab("click", `${tool} [data-slot="collapsible-trigger"]`);
    await page.until(
      `!document.querySelector('${tool} [data-slot="collapsible-content"]').textContent`,
    );

    // The live cancellation notice uses the same first-line gutter as transcript errors.
    await page.ab("fill", '[aria-label="Message"]', "question");
    await page.press("Enter");
    await page.see("Which checks?");
    await page.click("button", "Cancel");
    await page.see("Question cancelled");
    await page.capture("3-cancelled-question");
    const cancelled = (await page.evaluate(measure)).find(
      (row) => row.text === "Question cancelled",
    );
    assert.ok(cancelled, "cancellation has a gutter glyph");
    assert.ok(Math.abs(cancelled.offset) <= 1, `cancellation glyph offset: ${cancelled.offset}px`);
    writeFileSync(
      join(process.argv[2] ?? ".scratch/browser/transcript-rows", "offsets-cancelled.json"),
      JSON.stringify(cancelled, null, 2),
    );
  },
);
