// Screenshots of the surfaces a shadcn upgrade or style change touches, for before/after comparison
// (docs/shadcn-ui.md §Upgrade procedure). Evidence only, not a critical-path journey, so it is not
// part of `npm run test:browser`. Run it before and after the change into two folders and compare.
// node test/browser/style-shots.mjs <evidence-directory>
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
const result = (id, name, text, details, isError = false) => ({
  role: "toolResult",
  toolCallId: id,
  toolName: name,
  content: [{ type: "text", text }],
  details,
  isError,
  timestamp,
});
const skill =
  '<skill name="review" location="/home/someone/.pi/skills/review/SKILL.md">\nReferences are relative to /home/someone/.pi/skills/review.\n\n# Review\n\nRead the diff.\n</skill>';
const longOutput = Array.from(
  { length: 14 },
  (_, i) => `line ${i + 1}: ${i % 3 === 0 ? "PASS" : "ok"} test/${i}.test.ts`,
).join("\n");

const messages = [
  user("Earlier question, summarized away."),
  assistant([{ type: "text", text: "Earlier reply, kept by the compaction." }]),
  { compaction: { summary: "## Goal\n\nFix the login bug." } },
  user("Question: why does login fail?"),
  assistant([
    {
      type: "text",
      text: "Reply: the CSRF token is stale.\n\n```ts\nconst token = session.csrf;\n```",
    },
  ]),
  assistant([call("run", "bash", { command: "npm test" })]),
  result("run", "bash", longOutput),
  assistant([call("read", "read", { path: "/home/someone/app/src/login.ts" })]),
  result("read", "read", "export function login() {\n  return csrf.check();\n}"),
  assistant([call("bad", "bash", { command: "npm run lint" })]),
  result("bad", "bash", "ERR: 3 problems (3 errors, 0 warnings)", undefined, true),
  user(`${skill}\n\nFocus on login.`),
  assistant([{ type: "text", text: "" }], { stopReason: "error", errorMessage: "Rate limited" }),
  assistant([{ type: "text", text: "Done: every row kind is above." }]),
];

const openFolds = async (page) => {
  const n = await page.evaluate(
    `[...document.querySelectorAll('[data-slot="collapsible-trigger"][aria-expanded="false"]:not(:disabled)')].map((t, i) => (t.setAttribute("data-fold-probe", String(i)), i)).length`,
  );
  for (let i = 0; i < n; i++) {
    await page.ab(
      "eval",
      `document.querySelector('[data-fold-probe="${i}"]').scrollIntoView({ block: "center" })`,
    );
    await page.ab("click", `[data-fold-probe="${i}"]`);
  }
  await page.until(
    `[...document.querySelectorAll('[data-slot="collapsible-content"]')].every((c) => c.dataset.state === "open" && !c.getAnimations().length)`,
  );
};

await run(
  "style-shots",
  ({ repository, history }) => {
    const cwd = repository("api");
    const now = new Date().toISOString();
    history({ sessionId: "rows", cwd, messages });
    return {
      folders: [cwd],
      sessions: [
        { sessionId: "rows", title: "Every row kind", cwd, createdAt: now, updatedAt: now },
      ],
    };
  },
  async (page) => {
    for (const scheme of ["light", "dark"]) {
      await page.ab("set", "media", scheme);
      await page.open("/");
      await page.see("Every row kind");
      await page.capture(`01-new-${scheme}`);
      await page.click("button", "Every row kind");
      await page.see("Done: every row kind is above.");
      await page.ab("eval", `window.scrollTo(0, 0)`);
      await page.capture(`02-session-${scheme}`);
      await openFolds(page);
      await page.ab(
        "eval",
        `document.querySelector('[role="group"][aria-label="bash tool call"]').scrollIntoView({ block: "start" })`,
      );
      await page.capture(`03-session-open-${scheme}`);
      await page.ab(
        "eval",
        `[...document.querySelectorAll('[role="group"][aria-label="bash tool call"]')].at(-1).scrollIntoView({ block: "start" })`,
      );
      await page.capture(`03b-failed-tool-${scheme}`);
      // Session settings appear when composing; first-message editors remain expanded.
      await page.ab("click", "[aria-label='Message']");
      await page.ab("click", "[aria-label^='Model:']");
      await page.ab(
        "wait",
        "--fn",
        "!!document.querySelector('[data-radix-popper-content-wrapper]')",
      );
      await page.capture(`04-model-picker-${scheme}`);
      await page.ab("press", "Escape");
      await page.ab(
        "wait",
        "--fn",
        "!document.querySelector('[data-radix-popper-content-wrapper]')",
      );
      await page.ab("click", "[aria-label='Session information and actions']");
      await page.ab("wait", "--fn", "!!document.querySelector('[role=menu]')");
      await page.capture(`05-session-menu-${scheme}`);
      await page.ab("press", "Escape");
      // Changes at the header's end opens in the Surface area beside the Agent area.
      await page.click("button", "Changes");
      await page.until("!!document.querySelector('[data-slot=surface-area]:not([inert])')");
      await page.capture(`05c-changes-${scheme}`);
      await page.click("button", "Hide changes");
      await page.until("!document.querySelector('[data-slot=surface-area]:not([inert])')");
      await page.press("Mod+k");
      await page.ab("wait", "--fn", "!!document.querySelector('[role=dialog]')");
      await page.capture(`06-palette-${scheme}`);
      await page.ab("press", "Escape");
      await page.ab("wait", "--fn", "!document.querySelector('[role=dialog]')");
      await page.open("/settings");
      await page.ab("wait", "--fn", "!!document.querySelector('main')");
      await page.capture(`07-settings-${scheme}`);
    }
    await page.ab("set", "media", "light");
    await page.ab("set", "viewport", "390", "844");
    await page.open("/");
    await page.ab("wait", "--fn", "!!document.querySelector('main')");
    await page.capture("08-mobile-home");
    await page.open("/s/rows");
    await page.see("Done: every row kind is above.");
    await page.capture("09-mobile-session");
    await page.click("button", "Session information and actions");
    await page.see("Messages only");
    await page.capture("09b-mobile-actions");
    await page.click("button", "Add to project");
    await page.see("New project…");
    await page.capture("09c-mobile-projects");
    await page.click("button", "Back");
    await page.see("Messages only");
    await page.ab("press", "Escape");
    await page.until("!document.querySelector('[data-slot=\"sheet-content\"]')");
    await page.press("Mod+k");
    await page.ab("wait", "--fn", "!!document.querySelector('[role=dialog]')");
    await page.capture("10-mobile-palette");
    // One area at a time on a phone: Changes takes the session's full width under its tab.
    await page.ab("type", "[cmdk-input]", "Changes");
    await page.until(
      `[...document.querySelectorAll('[cmdk-item]')].some((i) => i.textContent.trim() === 'Changes')`,
    );
    await page.click("option", "Changes");
    await page.until(
      "document.querySelector('[role=tab][aria-selected=true]')?.textContent === 'Changes'",
    );
    await page.capture("11-mobile-changes");
  },
);
