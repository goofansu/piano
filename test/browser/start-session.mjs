// Critical path 1: start a session. Choose a folder, a model and effort and a project, send the
// first message, see Pi's reply; a reload keeps the session without sending the message again.
// node test/browser/start-session.mjs [evidence-directory]
import assert from "node:assert/strict";
import { run } from "./harness.mjs";

await run(
  "start-session",
  ({ repository }) => ({
    folders: [repository("api"), repository("web")],
    projects: [{ id: "launch", name: "Launch" }],
  }),
  async (page) => {
    await page.open("/new");

    await page.choose("Directory", "web");
    await page.ab("find", "role", "button", "click", "--name", "Model:");
    await page.click("option", "fake/gamma");
    await page.click("radio", "high");
    await page.ab("press", "Escape");
    await page.until("!document.querySelector('[data-radix-popper-content-wrapper]')");
    await page.click("button", "Project");
    await page.click("menuitem", "Launch");
    await page.until("!document.querySelector('[role=\"menu\"]')");
    await page.capture("1-new-session");

    await page.ab("fill", '[aria-label="First message"]', "Plan the launch");
    await page.click("button", "Send");
    await page.see("echo: Plan the launch");
    await page.capture("2-first-reply");

    const start = page.received().find((r) => r.command === "start" && r.sessionId !== "probe");
    assert.ok(start, "Pi was started for the session");
    const flag = (name) => start.args[start.args.indexOf(name) + 1];
    assert.equal(flag("--model"), "fake/gamma", "Pi starts with the chosen model");
    assert.equal(flag("--thinking"), "high", "Pi starts with the chosen effort");
    const header = await page.evaluate(`document.querySelector('main header').innerText`);
    assert.match(header, /Launch/, "the session belongs to the chosen project");
    assert.match(header, /web/, "the session runs in the chosen folder");

    await page.ab("reload");
    await page.see("echo: Plan the launch");
    const said = await page.evaluate(
      `[...document.querySelectorAll('[data-slot="transcript"] article')].filter(a => a.innerText.includes('Plan the launch') && !a.innerText.includes('echo:')).length`,
    );
    assert.equal(said, 1, "the first message shows once after a reload");
    assert.deepEqual(page.prompts(), ["Plan the launch"], "a reload never sends the message again");
    await page.capture("3-after-reload");
  },
);
