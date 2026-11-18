import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness.mjs";

await run(
  "start-session",
  ({ repository }) => ({
    folders: [repository("api"), repository("web")],
    projects: [{ id: "launch", name: "Launch" }],
  }),
  async (page) => {
    await page.open("/settings/preferences");
    await page.see("Voice input");
    await page.click("switch", "Voice input");
    await page.ab("fill", 'input[type="password"]', "sk-fixture-no-provider-call");
    await page.click("button", "Save");
    await page.see("Voice input turned on");
    await page.open("/new");

    await page.choose("Directory", "web");
    await page.until("document.querySelector('[aria-label^=\"Model:\"]')?.disabled === false");
    await page.until("!!document.querySelector('[aria-label=\"Voice input\"]')");
    await page.ab("fill", '[aria-label="First message"]', "Keep this draft");

    await page.cdp(async (call) => {
      const targets = () =>
        page.evaluate(`['[aria-label="Directory"]', '[aria-label="Project"]',
          '[aria-label^="Model:"]', '[aria-label="Send"]'].map(selector => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return { width: r.width, height: r.height };
        })`);
      await page.until(
        "matchMedia('(pointer: fine)').matches && matchMedia('(hover: hover)').matches",
      );
      const fine = await targets();
      assert.deepEqual(
        fine.map((r) => r.height),
        [32, 32, 32, 36],
      );
      try {
        await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
        await page.until("matchMedia('(pointer: coarse)').matches && innerWidth === 1280");
        for (const target of await targets()) {
          assert.ok(
            target.width >= 44 && target.height >= 44,
            "wide coarse target is at least 44px",
          );
        }
        await page.capture("wide-coarse-targets");
        for (const width of [390, 414]) {
          await page.ab("set", "viewport", String(width), "844");
          const controls = await page.evaluate(`(() => {
            const box = e => {
              const r = e.getBoundingClientRect();
              return { x: r.x, right: r.right, width: r.width, height: r.height };
            };
            const send = document.querySelector('[aria-label="Send"]');
            const mic = document.querySelector('[aria-label="Voice input"]');
            return {
              targets: ['[aria-label="Attach images"]', '[aria-label^="Model:"]',
                '[aria-label="Voice input"]', '[aria-label="Send"]'].map(s => box(document.querySelector(s))),
              face: box(send.firstElementChild),
              micFace: box(mic.firstElementChild),
              adjacent: mic.nextElementSibling === send,
            };
          })()`);
          for (const target of controls.targets) {
            assert.ok(target.width >= 44 && target.height >= 44, "phone target is at least 44px");
            assert.ok(target.x >= 0 && target.right <= width, "target stays on screen");
          }
          for (let i = 1; i < controls.targets.length; i++) {
            assert.ok(
              controls.targets[i - 1].right <= controls.targets[i].x,
              "targets do not overlap",
            );
          }
          assert.equal(controls.face.width, 36, "Send face stays compact");
          assert.equal(controls.face.height, 36, "Send face stays compact");
          assert.equal(controls.micFace.width, 36, "Mic matches Send");
          assert.equal(controls.micFace.height, 36, "Mic matches Send");
          assert.equal(controls.adjacent, true, "Mic immediately precedes Send in DOM/tab order");
          await page.capture(`phone-${width}-targets`);
        }
      } finally {
        await page.ab("set", "viewport", "1280", "800");
        await call("Emulation.setTouchEmulationEnabled", { enabled: false });
      }
      await page.until("!matchMedia('(pointer: coarse)').matches");
      assert.deepEqual(await targets(), fine, "leaving coarse input restores compact dimensions");
      assert.equal(
        await page.evaluate(`document.querySelector('[aria-label="First message"]').value`),
        "Keep this draft",
      );
      assert.deepEqual(page.prompts(), [], "pointer changes do not send the draft");
    });
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
    await page.until("!!document.querySelector('[aria-label=\"Send\"]')");
    assert.equal(
      await page.evaluate(
        `document.querySelector('[aria-label="Voice input"]').nextElementSibling === document.querySelector('[aria-label="Send"]')`,
      ),
      true,
      "the existing session keeps Mic immediately before Send",
    );
    await page.capture("2-first-reply");

    const start = page.received().find((r) => r.command === "start" && r.sessionId !== "probe");
    assert.ok(start, "Pi was started for the session");
    const flag = (name) => start.args[start.args.indexOf(name) + 1];
    assert.equal(flag("--model"), "fake/gamma", "Pi starts with the chosen model");
    assert.equal(flag("--thinking"), "high", "Pi starts with the chosen effort");
    assert.match(start.cwd, /\/web$/, "Pi runs in the chosen folder");
    const header = await page.evaluate(`document.querySelector('main header').innerText`);
    assert.match(header, /Launch/, "the session belongs to the chosen project");

    await page.ab("reload");
    await page.see("echo: Plan the launch");
    const said = await page.evaluate(
      `[...document.querySelectorAll('[data-slot="transcript"] article')].filter(a => a.innerText.includes('Plan the launch') && !a.innerText.includes('echo:')).length`,
    );
    assert.equal(said, 1, "the first message shows once after a reload");
    assert.deepEqual(page.prompts(), ["Plan the launch"], "a reload never sends the message again");
    await page.capture("3-after-reload");

    const origin = await page.evaluate("location.origin");
    const marker = join(start.cwd, "shell-executed");
    const prompt = [
      "  \tPIN-153 literal prompt — 中文 🎹",
      `\`touch '${marker}'\` $(touch '${marker}')`,
      "$HOME ${USER} $((1+2)) 'single' \"double\" \\backslash",
      "EOF\nEND_PROMPT\r\n'\"; exit 99; #",
      "last line  \n\n",
    ].join("\n");
    const outFile = join(page.evidence, "structured-start.json");
    const dispatched = JSON.parse(
      execFileSync(process.execPath, ["scripts/dispatch-session.ts", "--json"], {
        cwd: new URL("../../", import.meta.url),
        input: JSON.stringify({
          prompt,
          cwd: start.cwd,
          worktree: { branch: "json-dispatch" },
          outFile,
          wsUrl: origin.replace("http:", "ws:") + "/ws",
          origin,
        }),
        encoding: "utf8",
        timeout: 100_000,
      }),
    );
    assert.equal(dispatched.creation, "created", JSON.stringify(dispatched));
    assert.equal(dispatched.submission, "started");
    assert.equal(dispatched.worktree.branch, "json-dispatch");
    assert.equal(dispatched.cwd, dispatched.worktree.path);
    assert.equal(dispatched.link, `${origin}/s/${dispatched.handle.sessionId}`);
    assert.deepEqual(JSON.parse(readFileSync(outFile, "utf8")), dispatched);
    await page.ab("open", dispatched.link);
    await page.see("echo:");
    assert.equal(
      page.prompts().at(-1),
      prompt,
      "JSON stdin reaches Pi unchanged, including whitespace",
    );
    assert.equal(existsSync(marker), false, "shell-sensitive prompt text is never executed");
    const dispatchedStart = page
      .received()
      .find((r) => r.command === "start" && r.sessionId === dispatched.handle.sessionId);
    assert.equal(dispatchedStart.cwd, dispatched.cwd);
    await page.capture("4-structured-dispatch");
  },
  {
    requiresWorktrunk: true,
    // Headless Chromium can expose no pointer; force a mouse for this journey.
    browserArgs:
      "--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2",
  },
);
