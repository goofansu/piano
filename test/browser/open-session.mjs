import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { run } from "./harness.mjs";
import { checkMessageFidelity } from "./message-fidelity.mjs";
import { commandDialogFocus, projectDialogFocus } from "./project-dialog.mjs";
import {
  checkTranscriptResizeReadiness,
  measuredTranscriptAtBottom,
} from "./transcript-resize.mjs";
import { checkTranscriptHistoryScroll, seedScrollHistory } from "./transcript-scroll.mjs";

const listsOwnTheirItems = async (page, where) => {
  const strays = await page.evaluate(`[...document.querySelectorAll('[role="list"]')]
    .flatMap((list) => [...list.children].filter((row) => row.getAttribute("role") !== "listitem"))
    .map((row) => (row.closest("[aria-label]")?.getAttribute("aria-label") ?? "") + " " + row.outerHTML.slice(0, 80))`);
  assert.deepEqual(strays, [], `${where}: list rows that are not list items`);
  const lists = await page.evaluate(`document.querySelectorAll('[role="list"]').length`);
  console.log(`Lists on ${where}: ${lists}, every row a list item`);
};
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

let scratchRoot;

const homeActivity = async (page) => {
  const rows = `[...document.querySelectorAll('main [role="listitem"]')].map((row) => [
    row.querySelector('[data-slot="item-title"]').innerText,
    row.querySelector('[data-activity]')?.innerText ?? null,
  ])`;
  await page.open("/s/watch");
  await page.see("Answer 1.");
  await page.ab("fill", '[aria-label="Message"]', "hold until released");
  await page.press("Enter");
  await page.ab("wait", 'button[aria-label="Stop"]');
  await page.click("button", "Project: QA Project");
  await page.ab("set", "viewport", "390", "844");
  await page.until(`!!document.querySelector('main [data-activity="working"]')`);
  const working = await page.evaluate(rows);
  await page.capture("home-activity-1-working-390");
  const watch = working.findIndex(([title]) => title === "Watch the build");
  assert.equal(working[watch]?.[1], "Working", "the running session reads Working");

  writeFileSync(join(scratchRoot, "release-hold"), "");
  await page.until(`!!document.querySelector('main [data-activity="done"]')`);
  const finished = await page.evaluate(rows);
  await page.capture("home-activity-2-finished-390");
  console.log("Project home before and after the turn ends:", working, finished);
  assert.deepEqual(
    finished,
    working.map((row, i) => (i === watch ? ["Watch the build", "Finished"] : row)),
    "the same row turns from Working to Finished in place, and rows keep their order",
  );
  await page.ab("set", "viewport", "1280", "900");
};

await run(
  "open-session",
  ({ root, repository, history }) => {
    scratchRoot = root;
    const cwd = repository("api");
    const now = new Date().toISOString();
    const reference = (sessionId, title, cost) => ({
      sessionId,
      title,
      cwd,
      createdAt: now,
      updatedAt: now,
      stats: { cost, statsUpdatedAt: Date.now() },
    });
    history({
      sessionId: "login-bug",
      cwd,
      messages: [
        ...[1, 2, 3, 4, 5, 6].flatMap(exchange),
        {
          ...exchange(6)[1],
          usage: undefined,
          content: [
            { type: "toolCall", id: "tail-tool", name: "bash", arguments: { command: "npm test" } },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "tail-tool",
          toolName: "bash",
          content: [{ type: "text", text: "tail tool output\n".repeat(60) }],
          isError: false,
          timestamp,
        },
      ],
    });
    const release = Array.from({ length: 60 }, (_, i) => exchange(i + 1)).flat();
    release.splice(
      60,
      0,
      {
        ...exchange(30)[1],
        content: [
          {
            type: "toolCall",
            id: "measured-tool",
            name: "bash",
            arguments: { command: "printf measured" },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "measured-tool",
        toolName: "bash",
        content: [{ type: "text", text: "measured tool output\n".repeat(30) }],
        isError: false,
        timestamp,
      },
    );
    release.at(-2).content += `\n\n${paragraph.repeat(4)}`;
    release.at(-1).content[0].text += '\n\n```ts\nconst release = "ready";\n```';
    history({ sessionId: "release-notes", cwd, messages: release });
    const worktrees = ["live", "gone"].map((name) => {
      const path = `${cwd}.${name}`;
      execFileSync("git", ["-C", cwd, "worktree", "add", "-b", `feat-${name}`, path]);
      if (name === "gone") execFileSync("git", ["-C", cwd, "worktree", "remove", path]);
      history({ sessionId: name, cwd: path, messages: exchange(1) });
      return { folder: cwd, path, branch: `feat-${name}` };
    });
    const navigation = Array.from({ length: 80 }, (_, n) => {
      const sessionId = `nav-${String(n).padStart(3, "0")}`;
      history({
        sessionId,
        cwd,
        messages: [{ role: "user", content: `History ${sessionId}`, timestamp }],
      });
      return {
        ...reference(sessionId, sessionId, 0),
        createdAt: "2023-11-14T12:00:00Z",
        updatedAt: "2023-11-14T12:00:00Z",
      };
    });
    history({ sessionId: "watch", cwd, messages: exchange(1) });
    history({
      sessionId: "nav-pin",
      cwd,
      messages: [{ role: "user", content: "Pinned history", timestamp }],
    });
    return {
      folders: [cwd],
      worktrees,
      projects: [{ id: "qa", name: "QA Project" }],
      sessions: [
        ...navigation,
        ...seedScrollHistory({ history, cwd }),
        { ...reference("nav-pin", "Navigation pin", 0), pinned: true },
        reference("login-bug", "Fix the login bug", 0.063),
        reference("release-notes", "Release notes", 0.63),
        ...worktrees.map((w, i) => ({
          ...reference(i === 0 ? "live" : "gone", i === 0 ? "Live worktree" : "Gone worktree", 0),
          cwd: w.path,
          projectId: "qa",
        })),
        {
          ...reference("watch", "Watch the build", 0),
          createdAt: "2023-11-13T12:00:00Z",
          updatedAt: "2023-11-13T12:00:00Z",
          projectId: "qa",
          pullRequest: { url: "https://github.com/acme/api/pull/26674", source: "manual" },
        },
      ],
    };
  },
  async (page) => {
    await projectDialogFocus(page);
    await commandDialogFocus(page);
    await page.open("/");
    await page.see("Fix the login bug");
    await page.click("button", "Fix the login bug");
    await page.see("Answer 6.");
    await page.capture("1-transcript");

    const sidebarDraft = "Keep the Cmd+B draft";
    const sidebarColumn = `document.querySelector('[data-slot="layout-sidebar"]')`;
    const sidebarReveal = `document.querySelector('[data-slot="mobile-sidebar"][role="dialog"]')`;
    await page.ab("fill", '[aria-label="Message"]', sidebarDraft);
    const sidebarChord = async (width, narrow, label) => {
      await page.ab("set", "viewport", String(width), "900");
      await page.ab("focus", '[aria-label="Message"]');
      const before = await page.evaluate(`${sidebarColumn}.getBoundingClientRect().width`);
      for (const key of ["Control+b", "Meta+Shift+b", "Meta+Alt+b", "Meta+Control+b"]) {
        await page.press(key);
        assert.equal(
          await page.evaluate(`!!${sidebarReveal}`),
          false,
          `${key} leaves reveal closed`,
        );
        assert.equal(await page.evaluate(`${sidebarColumn}.getBoundingClientRect().width`), before);
      }
      await page.press("Meta+b");
      await page.until(
        narrow ? `!!${sidebarReveal}` : `${sidebarColumn}.getBoundingClientRect().width === 0`,
      );
      await page.capture(`sidebar-${label}-${width}-toggled`);
      await page.press("Meta+b");
      await page.until(
        `!${sidebarReveal} && ${sidebarColumn}.getBoundingClientRect().width === ${before}`,
      );
      assert.equal(
        await page.evaluate(`document.activeElement?.getAttribute('aria-label')`),
        "Message",
      );
      assert.equal(
        await page.evaluate(`document.querySelector('[aria-label="Message"]').value`),
        sidebarDraft,
      );
      await page.capture(`sidebar-${label}-${width}-returned`);
    };
    for (const width of [767, 768, 769, 1146, 1280]) {
      await sidebarChord(width, width < 768, "default-font");
    }
    await page.cdp(async (cdp) => {
      await cdp("Page.setFontSizes", { fontSizes: { standard: 20 } });
      try {
        for (const width of [800, 959, 960, 961]) {
          await sidebarChord(width, width < 960, "20px-font");
        }
      } finally {
        await cdp("Page.setFontSizes", { fontSizes: { standard: 16 } });
      }
    });
    await page.press("Alt+ArrowDown");
    await page.until(`location.pathname === '/s/gone'`);
    await page.press("Alt+ArrowUp");
    await page.until(
      `location.pathname === '/s/login-bug' && document.querySelector('[aria-label="Message"]')?.value === ${JSON.stringify(sidebarDraft)}`,
    );
    await page.evaluate(`(() => {
      for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp'])
        window.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true, cancelable: true }));
    })()`);
    await page.until(`location.pathname === '/s/live'`);
    await page.press("Alt+ArrowUp");
    await page.press("Alt+ArrowUp");
    await page.until(
      `location.pathname === '/s/login-bug' && document.querySelector('[aria-label="Message"]')?.value === ${JSON.stringify(sidebarDraft)}`,
    );
    await page.capture("sidebar-alt-arrows-draft-restored");
    await page.ab("focus", '[aria-label="Message"]');
    await page.evaluate(`(() => {
      const composer = document.querySelector('[aria-label="Message"]');
      const key = (target, key) =>
        target.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true }));
      key(composer, 'ArrowDown');
      key(document.body, 'Alt');
      key(document.body, 'ArrowDown');
    })()`);
    await page.until(`location.pathname === '/s/live'`);
    await page.until(
      `document.querySelector('[aria-label="Message"]')?.disabled === false && document.activeElement?.getAttribute('aria-label') === 'Message'`,
    );
    await page.press("Alt+ArrowUp");
    await page.press("Alt+ArrowUp");
    await page.until(
      `location.pathname === '/s/login-bug' && document.querySelector('[aria-label="Message"]')?.value === ${JSON.stringify(sidebarDraft)}`,
    );
    assert.deepEqual(page.prompts(), [], "sidebar chords never submit the composer draft");
    await page.ab("fill", '[aria-label="Message"]', "");
    await page.ab("set", "viewport", "1280", "900");

    const selectedVisible = `(() => {
      const nav = document.querySelector('nav[aria-label="Sessions"]');
      const row = nav.querySelector('[aria-current="page"]')?.getBoundingClientRect();
      const box = nav.closest('[data-slot="scroll-area-viewport"]').getBoundingClientRect();
      return !!row && row.top >= box.top - 1 && row.bottom <= box.bottom + 1;
    })()`;
    await page.open("/s/nav-050");
    await page.see("History nav-050");
    await page.until(selectedVisible);
    await page.evaluate(
      `document.querySelector('nav[aria-label="Sessions"]').closest('[data-slot="scroll-area-viewport"]').scrollTop = 0`,
    );
    await page.until(`!document.querySelector('nav[aria-label="Sessions"] [aria-current="page"]')`);
    await page.ab("fill", '[aria-label="Message"]', "Offscreen draft");
    await page.press("Alt+ArrowDown");
    await page.until(`location.pathname === '/s/nav-051' && ${selectedVisible}`);
    await page.see("History nav-051");
    assert.equal(
      await page.evaluate(`document.activeElement?.getAttribute('aria-label')`),
      "Message",
    );
    assert.ok(await page.evaluate(`document.querySelectorAll('[data-session-key]').length < 45`));
    await page.capture("sidebar-alt-virtual-destination");
    await page.click("button", "Session menu for nav-051");
    await page.until(`!!document.querySelector('[role="menu"]')`);
    await page.press("Alt+ArrowDown");
    assert.equal(await page.evaluate("location.pathname"), "/s/nav-051", "menu owns its keys");
    const behindMenu = `[location.pathname, document.querySelector('[aria-label="Message"]').value]`;
    const beforeKeys = await page.evaluate(behindMenu);
    await page.evaluate(`(() => {
      for (const init of [{ key: 'ArrowDown', altKey: true }, { key: 'x' }])
        document.body.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }));
    })()`);
    await setTimeout(300);
    assert.deepEqual(
      await page.evaluate(behindMenu),
      beforeKeys,
      "an open overlay keeps Alt+Down and typing from reaching the session behind it",
    );
    await page.press("Escape");
    await page.until(`!document.querySelector('[role="menu"]')`);
    await page.ab("focus", '[aria-label="Message"]');
    await page.press("Meta+b");
    await page.evaluate(`(() => {
      for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp'])
        window.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true, repeat: true, cancelable: true }));
    })()`);
    await page.see("History nav-052");
    assert.equal(await page.evaluate(`${sidebarColumn}.getBoundingClientRect().width`), 0);
    await page.press("Meta+b");
    await page.until(selectedVisible);
    await page.press("Alt+ArrowUp");
    await page.press("Alt+ArrowUp");
    await page.until(
      `location.pathname === '/s/nav-050' && document.querySelector('[aria-label="Message"]')?.value === 'Offscreen draft' && ${selectedVisible}`,
    );
    await page.capture("sidebar-alt-hidden-return");
    await page.evaluate(
      `document.querySelector('nav[aria-label="Sessions"]').closest('[data-slot="scroll-area-viewport"]').scrollTop = 0`,
    );
    await page.until(`!document.querySelector('nav[aria-label="Sessions"] [aria-current="page"]')`);
    await page.press("Meta+b");
    await page.evaluate(`(() => {
      for (const key of ['ArrowDown', 'ArrowUp'])
        window.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true, repeat: true, cancelable: true }));
    })()`);
    await page.see("History nav-050");
    await page.press("Meta+b");
    await page.until(selectedVisible);
    await page.click("button", "Older");
    await page.press("Alt+ArrowUp");
    await page.until(`location.pathname === '/s/release-notes'`);
    await page.press("Alt+ArrowDown");
    assert.equal(await page.evaluate("location.pathname"), "/s/release-notes");
    await page.click("button", "Navigation pin");
    await page.click("button", "Pinned");
    await page.press("Alt+ArrowDown");
    await page.until(`location.pathname === '/s/login-bug'`);
    assert.equal(
      await page.evaluate(
        `[...document.querySelectorAll('nav[aria-label="Sessions"] button[aria-expanded="false"]')].map(b=>b.textContent.trim()).filter(Boolean).sort().join(',')`,
      ),
      "Older,Pinned",
    );
    await page.see("Answer 6.");
    await page.ab("fill", '[aria-label="Message"]', "");

    const tailTool = '[role="group"][aria-label="bash tool call"]';
    const tailToolGeometry = () =>
      page.evaluate(`(() => {
        const t = document.querySelector('[data-slot="transcript"]').getBoundingClientRect();
        const h = document.querySelector('${tailTool} [data-slot="tool-header"]').getBoundingClientRect();
        const pre = document.querySelector('${tailTool} [data-slot="tool-output"] pre');
        return { header: h.top - t.top, output: pre ? pre.getBoundingClientRect().top - t.top : null };
      })()`);
    const closedTool = await tailToolGeometry();
    await page.ab("click", `${tailTool} [data-slot="collapsible-trigger"]`);
    await page.until(
      `document.querySelector('${tailTool} [data-slot="collapsible-trigger"]').getAttribute('aria-expanded') === 'true'`,
    );
    const openedTool = await tailToolGeometry();
    assert.ok(
      Math.abs(openedTool.header - closedTool.header) < 1,
      `opening a tool keeps its header in place (${closedTool.header} → ${openedTool.header})`,
    );
    assert.ok(
      openedTool.output > openedTool.header,
      "the output starts below the header rather than scrolling past it",
    );
    await page.capture("1b-tool-opened-at-end");
    await page.ab(
      "click",
      `${tailTool} [data-slot="tool-header"] [data-slot="collapsible-trigger"]`,
    );
    await page.until(
      `document.querySelector('${tailTool} [data-slot="collapsible-trigger"]').getAttribute('aria-expanded') === 'false'`,
    );

    const inView = (text) =>
      page.evaluate(`(() => {
        const box = document.querySelector('[data-slot="transcript"]').getBoundingClientRect();
        const article = [...document.querySelectorAll('[data-slot="transcript"] article')]
          .find(a => a.innerText.includes(${JSON.stringify(text)}));
        if (!article) return false; // Offscreen rows are unmounted, not hidden history.
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
      await page.until("!document.querySelector('[data-slot=popover-content]')");
      return row;
    };
    assert.match(
      await sessionCost("3-cost"),
      /\$0\.0105\s+\$0\.0630/,
      "the session's cost when opened",
    );

    await page.ab("fill", '[aria-label="Message"]', "Add a regression test");
    await page.ab("press", "Enter");
    await page.click("button", "Jump to message");
    await page.see("echo: Add a regression test");
    await page.ab("press", "Escape");
    assert.equal(await inView("Question 1:"), true, "a reply does not move a reader who jumped up");
    await page.capture("4-follow-up");

    assert.match(
      await sessionCost("5-cost-after-reply"),
      /\$0\.0063\s+\$0\.0693/,
      "the cost updates after the reply",
    );

    await page.ab("fill", '[aria-label="Message"]', "hold");
    await page.ab("press", "Enter");
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

    await page.press("Mod+k");
    await page.press("Alt+ArrowDown");
    assert.equal(await page.evaluate("location.pathname"), "/s/login-bug", "palette owns its keys");
    await page.until(
      "document.querySelector('[cmdk-list]')?.getAttribute('aria-busy') === 'false'",
    );
    const paletteRows = await page.evaluate(`(() => {
      const list = document.querySelector('[cmdk-list]');
      return { rows: list.querySelectorAll('[cmdk-item]').length, overflows: list.scrollHeight > list.clientHeight };
    })()`);
    assert.ok(paletteRows.overflows, "the palette has more rows than fit");
    const selectedRowShown = `(() => {
      const list = document.querySelector('[cmdk-list]');
      const row = list.querySelector('[cmdk-item][aria-selected="true"]');
      const box = list.getBoundingClientRect();
      const at = row.getBoundingClientRect();
      return at.top >= box.top - 0.5 && at.bottom <= box.bottom + 0.5;
    })()`;
    for (const key of ["ArrowDown", "ArrowUp"])
      for (let step = 1; step < paletteRows.rows; step++) {
        await page.press(key);
        assert.ok(
          await page.evaluate(selectedRowShown),
          `the selected palette row is fully shown after ${key} ${step}`,
        );
      }
    assert.ok(
      await page.evaluate(`(() => {
        const list = document.querySelector('[cmdk-list]');
        return list.querySelector('[cmdk-group-heading]').getBoundingClientRect().top >= list.getBoundingClientRect().top - 0.5;
      })()`),
      "returning to the first palette row shows its heading",
    );
    await page.ab("fill", "[cmdk-input]", "release notes");
    await page.until(
      "document.querySelector('[cmdk-list]')?.getAttribute('aria-busy') === 'false'",
    );
    await page.evaluate(`(() => {
      const input = document.querySelector('[cmdk-input]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'zzzzzzz');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      return true;
    })()`);
    await page.see("No sessions, projects or commands match.");
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
    await page.see("Answer 60.");
    await page.capture("7-palette-switch");

    await page.click("button", "Fix the login bug");
    await page.see("echo: Add a regression test");
    const layouts = await page.layouts(async () => {
      await page.click("button", "Release notes");
      await page.see("Answer 60.");
      await page.until(`!!document.querySelector('button[aria-label="Copy code"]')`);
    });
    console.log(`Reopened 60 turns: ${layouts} browser layouts`);
    assert.ok(layouts < 20, `switching a 60-turn session took ${layouts} layouts`);
    await page.until(measuredTranscriptAtBottom);

    await page.click("button", "Show more");
    await page.until(
      `document.querySelector('[data-slot="transcript"] button[aria-expanded="true"][aria-controls]')?.textContent.includes('Show less')`,
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
    await page.see("Show more");
    const collapsed = await promptSize();
    assert.ok(collapsed.height < collapsed.content, "collapsed prompt is capped again");
    await page.ab("set", "viewport", "800", "900");
    await page.until(measuredTranscriptAtBottom);
    await page.click("button", "Show more");
    await page.see("Show less");
    const resized = await promptSize();
    assert.equal(resized.height, resized.content, "prompt still expands after resizing");
    const copyOpacity = (label) =>
      page.evaluate(`(() => {
        const button = document.querySelector('button[aria-label="${label}"]');
        return button ? Number(getComputedStyle(button).opacity) : -1;
      })()`);
    await page.ab("mouse", "move", "0", "0");
    await page.ab("focus", '[aria-label="Message"]');
    for (const width of [1280, 390, 800]) {
      await page.ab("set", "viewport", String(width), "900");
      assert.equal(
        await copyOpacity("Copy code"),
        1,
        "code copy is visible without hover or focus",
      );
      await page.capture(`code-copy-rest-${width}`);
    }
    await page.click("button", "Copy code");
    await page.until(`!!document.querySelector('button[aria-label="Code copied"]')`);
    await page.until(
      `Number(getComputedStyle(document.querySelector('button[aria-label="Code copied"]')).opacity) === 1`,
    );
    await page.capture("code-copy-copied");
    // Headless Chrome on macOS cannot paste or read the clipboard, even with CDP permission.
    if (process.platform === "darwin") {
      console.log(
        "SKIP copied-content check on macOS (headless Chrome cannot paste); CI covers it",
      );
    } else {
      await page.ab("focus", '[aria-label="Message"]');
      await page.press("Mod+v");
      assert.equal(
        await page.evaluate(`document.querySelector('[aria-label="Message"]').value`),
        'const release = "ready";',
        "copy contains only the fenced code",
      );
    }
    await page.ab("mouse", "move", "0", "0");
    await page.ab("focus", '[aria-label="Message"]');
    await page.until(`!!document.querySelector('button[aria-label="Copy code"]')`);
    assert.equal(
      await copyOpacity("Copy code"),
      1,
      "code copy stays visible after confirmation resets",
    );
    await page.capture("8-reopened-long-session");
    assert.ok(
      await page.evaluate(
        `document.querySelectorAll('[data-slot="transcript"] article[id]').length < 25`,
      ),
      "mounted transcript stays bounded",
    );
    const jump = async (label) => {
      await page.click("button", "Jump to message");
      await page.ab("find", "role", "button", "click", "--name", label);
    };
    await jump("You said Question 31: why does login fail?");
    await page.until(`(() => {
      const t = document.querySelector('[data-slot="transcript"]');
      const a = [...t.querySelectorAll('article')].find(a => a.textContent.includes('Question 31:'));
      return a && Math.abs(a.getBoundingClientRect().top - t.getBoundingClientRect().top - 16) < 2;
    })()`);
    const tool = '[role="group"][aria-label="bash tool call"]';
    await page.evaluate(`document.querySelector('[data-slot="transcript"]').scrollTop -= 200`);
    const headerGeometry = () =>
      page.evaluate(`(() => {
        const h = document.querySelector('${tool} [data-slot="tool-header"]').getBoundingClientRect();
        const g = document.querySelector('${tool} [data-slot="tool-header"] [data-slot="gutter"]').getBoundingClientRect();
        return { padding: [g.top - h.top, h.bottom - g.bottom], height: h.height };
      })()`);
    const compact = await headerGeometry();
    assert.deepEqual(compact.padding, [4, 4], "tool headers retain their original compact density");
    await page.ab("click", `${tool} [data-slot="collapsible-trigger"]`);
    await page.see("measured tool output");
    assert.deepEqual(await headerGeometry(), compact, "opening does not change header height");
    assert.equal(
      await page.evaluate(`(() => {
        const h = document.querySelector('${tool} [data-slot="tool-header"]').getBoundingClientRect();
        const body = document.querySelector('${tool} [data-slot="collapsible-content"] pre').getBoundingClientRect();
        return body.top - h.bottom;
      })()`),
      8,
      "tool output retains its original separation from the header",
    );
    assert.equal(
      await page.evaluate(
        `document.querySelector('${tool} [data-slot="tool-output"]').textContent.match(/measured tool output/g).length`,
      ),
      30,
      "one disclosure opens the tool's entire output",
    );
    await page.capture("10-expanded-tool");
    assert.equal(
      await page.evaluate(`(async () => {
        const tool = document.querySelector('${tool}');
        const row = tool.closest('[data-index]');
        const next = row.parentElement.querySelector('[data-index="' + (Number(row.dataset.index) + 1) + '"]');
        const button = tool.querySelector('[data-slot="collapsible-trigger"]');
        const frame = () => new Promise((done) => requestAnimationFrame(() => done()));
        const out = [];
        for (const step of ["close", "open"]) {
          button.click();
          await frame();
          const spacing = parseFloat(next.style.top) - parseFloat(row.style.top);
          out.push(step + (spacing === row.offsetHeight ? " ok" : " lags (" + spacing + " vs " + row.offsetHeight + ")"));
        }
        return out.join(", ");
      })()`),
      "close ok, open ok",
      "the rows below a toggled tool move before the first frame paints",
    );
    await page.click("button", "Scroll to bottom");
    await page.until(`!document.querySelector('${tool}')`);
    await jump("You said Question 31: why does login fail?");
    await page.until(
      `document.querySelector('${tool} [data-slot="collapsible-trigger"]')?.getAttribute('aria-expanded') === 'true'`,
    );
    await page.see("measured tool output");
    assert.equal(
      await page.evaluate(
        `document.querySelector('${tool} [data-slot="tool-output"]').textContent.match(/measured tool output/g).length`,
      ),
      30,
      "the expanded output stays expanded across remount",
    );
    await page.capture("11-remounted-tool");
    await page.evaluate(`(() => {
      const t = document.querySelector('[data-slot="transcript"]');
      const tool = document.querySelector('${tool}');
      t.scrollTop += tool.getBoundingClientRect().top - t.getBoundingClientRect().top + 120;
    })()`);
    const headerOffset = () =>
      page.evaluate(`(() => {
      const t = document.querySelector('[data-slot="transcript"]');
      const h = document.querySelector('${tool} [data-slot="tool-header"]');
      return h.getBoundingClientRect().top - t.getBoundingClientRect().top;
    })()`);
    assert.ok(Math.abs(await headerOffset()) < 1, "the tool header pins at the transcript edge");
    assert.deepEqual(await headerGeometry(), compact, "pinning does not change header height");
    await page.ab("click", `${tool} [data-slot="tool-header"] .font-medium`);
    await page.until(
      `document.querySelector('${tool} [data-slot="collapsible-trigger"]').getAttribute('aria-expanded') === 'false'`,
    );
    assert.ok(Math.abs(await headerOffset()) < 1, "collapse preserves the header's position");
    await page.capture("11b-collapsed-tool");
    await page.click("button", "Scroll to bottom");
    await page.ab("fill", '[aria-label="Message"]', "stream");
    await page.ab("press", "Enter");
    await page.see("Streaming line 5.");
    await page.until(`(() => {
      const t = document.querySelector('[data-slot="transcript"]');
      return t.scrollHeight - t.scrollTop - t.clientHeight < 2;
    })()`);
    await page.evaluate(`(() => {
      const t = document.querySelector('[data-slot="transcript"]');
      window.readerScrollEnded = false;
      t.addEventListener('scrollend', function ended() {
        if (t.scrollHeight - t.scrollTop - t.clientHeight > 100) {
          window.readerScrollEnded = true;
          t.removeEventListener('scrollend', ended);
        }
      });
    })()`);
    await page.ab("scroll", "up", "300", "--selector", '[data-slot="transcript"]');
    await page.until("window.readerScrollEnded");
    await page.evaluate(`(() => {
      const t = document.querySelector('[data-slot="transcript"]');
      const row = [...t.querySelectorAll('[data-index]')].find(r => r.getBoundingClientRect().bottom > t.getBoundingClientRect().top + 80);
      window.readingIndex = row.dataset.index;
      window.readingTop = row.getBoundingClientRect().top;
      window.streamingLength = t.textContent.length;
    })()`);
    await page.until(
      `document.querySelector('[data-slot="transcript"]').textContent.length > window.streamingLength + 1000`,
    );
    const reading = await page.evaluate(`(() => {
      const t = document.querySelector('[data-slot="transcript"]');
      const row = t.querySelector('[data-index="' + window.readingIndex + '"]');
      return { index: window.readingIndex, before: window.readingTop, after: row?.getBoundingClientRect().top, top: t.scrollTop, gap: t.scrollHeight - t.scrollTop - t.clientHeight };
    })()`);
    console.log("Streaming reading anchor:", reading);
    assert.ok(
      Math.abs(reading.after - reading.before) < 2,
      "streaming does not move an unpinned reader",
    );
    await page.capture("12-streaming-unpinned");
    await page.click("button", "Scroll to bottom");
    await page.evaluate(
      `window.streamingLength = document.querySelector('[data-slot="transcript"]').textContent.length`,
    );
    await page.until(`(() => {
      const t = document.querySelector('[data-slot="transcript"]');
      return t.textContent.length > window.streamingLength + 1000 && t.scrollHeight - t.scrollTop - t.clientHeight < 2;
    })()`);
    await page.capture("13-streaming-pinned");
    await page.click("button", "Stop");

    await page.ab("set", "viewport", "1280", "900");
    for (const [id, title] of [
      ["live", "Live worktree"],
      ["gone", "Gone worktree"],
    ]) {
      await page.open("/projects/qa");
      const card = `[role="listitem"]:has([aria-label=${JSON.stringify(`Session menu for ${title}`)}])`;
      await page.ab("wait", card);
      await listsOwnTheirItems(page, "project home");
      assert.match(
        await page.ab("get", "text", card),
        new RegExp(`${title}\\s*Folder:\\s*api\\s*Git branch:\\s*feat-${id}`),
      );
      await page.ab("click", `${card} [data-slot="item-title"] button`);
      await page.see("Answer 1.");
      await listsOwnTheirItems(page, `session ${id}`);
      const header = await page.evaluate("document.querySelector('header').textContent");
      assert.match(header, /Project: QA Project/);
      assert.doesNotMatch(header, new RegExp(`feat-${id}`));
      console.log(`Session header (${id}): ${header}`);
      await page.capture(`9-header-${id}`);
    }

    await page.open("/s/live");
    await page.see("Answer 1.");
    await page.ab("fill", '[aria-label="Message"]', "Keep the boundary draft");
    await page.ab("set", "viewport", "1146", "900");
    const areasWidth = `document.querySelector('[data-slot="agent-area"]').parentElement.getBoundingClientRect().width`;
    await page.until(`${areasWidth} === 848 && !document.querySelector('[data-rail-trigger]')`);
    await page.click("button", "Changes");
    await page.until(`!!document.querySelector('[role="tab"][aria-selected="true"]')`);
    assert.equal(
      await page.evaluate(`document.querySelector('[data-slot="agent-area"]').inert`),
      true,
    );
    assert.ok(
      await page.evaluate(`document.querySelector('[data-session-menu]').closest('nav') !== null`),
    );
    assert.ok(
      await page.evaluate(`document.querySelector('main header nav button').checkVisibility()`),
    );
    assert.match(
      await page.evaluate(`document.querySelector('main header').textContent`),
      /Folder:\s*api\s*Git branch:\s*feat-live/,
    );
    await page.capture("17-wide-one-area");
    await page.click("button", "Session information and actions");
    await page.until(`!!document.querySelector('[role="dialog"][data-slot="sheet-content"]')`);
    await page.capture("18-wide-one-area-sheet");
    for (const [width, areas] of [
      [1147, 849],
      [1148, 850],
    ]) {
      await page.ab("set", "viewport", String(width), "900");
      await page.until(
        `${areasWidth} === ${areas} && !!document.querySelector('[data-rail-trigger]') && !document.querySelector('[role="dialog"]')`,
      );
      assert.equal(
        await page.evaluate(`document.querySelector('[data-slot="agent-area"]').inert`),
        false,
      );
      assert.equal(
        await page.evaluate(
          `document.querySelector('[data-session-menu]').getAttribute('aria-haspopup')`,
        ),
        "menu",
      );
      assert.doesNotMatch(
        await page.evaluate(`document.querySelector('main header').innerText`),
        /feat-live/,
      );
    }
    await page.capture("19-side-by-side-boundary");
    await page.ab("set", "viewport", "1146", "900");
    await page.until(`${areasWidth} === 848 && !document.querySelector('[data-rail-trigger]')`);
    assert.equal(
      await page.evaluate(`!!document.querySelector('[role="dialog"]')`),
      false,
      "the sheet must not resurrect",
    );
    assert.equal(
      await page.evaluate(`document.querySelector('[aria-label="Message"]').value`),
      "Keep the boundary draft",
    );
    assert.equal(
      await page.evaluate(`document.querySelector('[data-slot="agent-area"]').inert`),
      true,
      "the chosen inspection area survives",
    );
    await page.capture("20-one-area-return");

    await page.open("/s/login-bug");
    await page.see("echo: Add a regression test");
    const draft = "Keep  this draft ";
    await page.ab("fill", '[aria-label="Message"]', draft);
    const headerKey = async (width, trigger, key) => {
      await page.ab("set", "viewport", String(width), "900");
      await page.until(`!!document.querySelector('${trigger}')`);
      const before = await page.evaluate(
        `document.querySelector('${trigger}').getAttribute('aria-pressed')`,
      );
      await page.ab("focus", trigger);
      await page.press(key);
      const after = await page.evaluate(`(() => ({
        pressed: document.querySelector('${trigger}')?.getAttribute('aria-pressed'),
        sheet: !!document.querySelector('[role=dialog][data-slot=sheet-content]'),
        rail: !!document.querySelector('[data-rail-trigger]'),
        draft: document.querySelector('[aria-label="Message"]').value,
        focus: document.activeElement?.getAttribute('aria-label'),
      }))()`);
      await page.capture(`16-rail-${key.toLowerCase()}-${width}`);
      assert.equal(after.draft, draft, `${key} at ${width}px leaves the draft alone`);
      assert.notEqual(after.focus, "Message", `${key} at ${width}px does not focus the composer`);
      return { before, after };
    };
    for (const key of ["Space", "Enter"]) {
      const { before, after } = await headerKey(1280, "[data-rail-trigger]", key);
      assert.equal(
        after.pressed,
        before === "true" ? "false" : "true",
        `${key} toggles the rail once`,
      );
      if (after.pressed === "true") {
        await page.until(`!!document.querySelector('[role="list"][aria-label="Environment"]')`);
        await listsOwnTheirItems(page, "session rail");
      }
    }
    for (const key of ["Space", "Enter"]) {
      const { after } = await headerKey(600, "[data-session-menu]", key);
      assert.ok(after.sheet, `${key} opens the session menu as a sheet`);
      assert.equal(after.rail, false, "one area at a time the header has no rail toggle");
      await page.press("Escape");
      await page.until("!document.querySelector('[role=dialog]')");
      assert.equal(
        await page.evaluate("document.activeElement?.hasAttribute('data-session-menu')"),
        true,
        "Escape returns focus to the session menu's button",
      );
    }
    await page.ab("set", "viewport", "1280", "900");

    await page.open("/s/login-bug");
    await page.see("echo: Add a regression test");
    await page.ab("fill", '[aria-label="Message"]', "question");
    await page.press("Enter");
    await page.see("Which checks?");
    assert.equal(await page.evaluate("!!document.querySelector('[role=dialog]')"), false);
    const answers = () => page.received().filter((r) => r.command === "extension_ui_response");
    // agent-browser releases arrows before the radio group's deferred focus; select with Space.
    const radio = (name, checked) =>
      `[...document.querySelectorAll('[role=radio]')].some((r) => r === document.activeElement && r.getAttribute('aria-checked') === '${checked}' && (r.getAttribute('aria-labelledby') ?? '').split(' ').some((id) => document.getElementById(id)?.innerText.trim() === ${JSON.stringify(name)}))`;
    await page.click("radio", "Quick checks");
    await page.until(radio("Quick checks", true));
    await page.press("ArrowDown");
    await page.until(`${radio("Full suite", false)} || ${radio("Full suite", true)}`);
    await page.press("Space");
    await page.until(radio("Full suite", true));
    assert.equal(
      await page.evaluate("document.activeElement?.getAttribute('role')"),
      "radio",
      "Space belongs to the question, not the composer",
    );
    assert.equal(answers().length, 0, "selection is not submission");
    await page.capture("14-inline-question");
    await page.click("button", "Send answer");
    await page.see("Answer: Full suite");
    assert.equal(answers().length, 1);
    assert.equal(answers()[0].answer.value, "Full suite");
    await page.until("!document.querySelector('[aria-label=Question]')");
    await page.capture("15-inline-answered");
    await checkTranscriptResizeReadiness(page);
    await checkTranscriptHistoryScroll(page);
    await page.open("/s/login-bug");
    await page.see("echo: Add a regression test");
    await checkMessageFidelity(page);
    await homeActivity(page);
  },
);
