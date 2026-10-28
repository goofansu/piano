// Critical path 2: continue a session. Click it in the sidebar to read its transcript, jump to an
// earlier message, read the session's cost, send a follow-up and see the reply and the updated
// cost, then stop a running reply.
// node test/browser/open-session.mjs [evidence-directory]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
    return {
      folders: [cwd],
      worktrees,
      projects: [{ id: "qa", name: "QA Project" }],
      sessions: [
        reference("login-bug", "Fix the login bug", 0.063),
        reference("release-notes", "Release notes", 0.63),
        ...worktrees.map((w, i) => ({
          ...reference(i === 0 ? "live" : "gone", i === 0 ? "Live worktree" : "Gone worktree", 0),
          cwd: w.path,
          projectId: "qa",
        })),
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
    // A reply below the window is still present in the full-history jump list.
    await page.click("button", "Jump to message");
    await page.see("echo: Add a regression test");
    await page.ab("press", "Escape");
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
    await page.see("Answer 60.");
    await page.capture("7-palette-switch");

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
    // Scoped to the transcript: the sidebar's open groups are expanded disclosure buttons too.
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
    const collapsed = await promptSize();
    assert.ok(collapsed.height < collapsed.content, "collapsed prompt is capped again");
    await page.ab("set", "viewport", "800", "900");
    await page.click("button", "Show more");
    const resized = await promptSize();
    assert.equal(resized.height, resized.content, "prompt still expands after resizing");
    await page.click("button", "Copy code");
    await page.until(`!!document.querySelector('button[aria-label="Code copied"]')`);
    // Headless Chrome on macOS never pastes from the clipboard: a synthetic Cmd+V does nothing
    // and clipboard reads are denied, even with the permission granted over CDP. CI (Linux)
    // checks the copied content.
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
    // Far index jump: earlier unmeasured heights are estimates, then the target is refined.
    await jump("You said Question 31: why does login fail?");
    await page.until(`(() => {
      const t = document.querySelector('[data-slot="transcript"]');
      const a = [...t.querySelectorAll('article')].find(a => a.textContent.includes('Question 31:'));
      return a && Math.abs(a.getBoundingClientRect().top - t.getBoundingClientRect().top - 16) < 2;
    })()`);
    const tool = '[role="group"][aria-label="bash tool call"]';
    await page.evaluate(`document.querySelector('[data-slot="transcript"]').scrollTop -= 200`);
    await page.ab("click", `${tool} [data-slot="collapsible-trigger"]`);
    await page.see("measured tool output");
    await page.click("button", "… 26 more lines");
    await page.capture("10-expanded-tool");
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

    // PIN-88: opening a project member keeps the branch shown on its home card, even after
    // Git stops listing its worktree. The same header segments remain on a live worktree.
    await page.ab("set", "viewport", "1280", "900");
    for (const [id, title] of [
      ["live", "Live worktree"],
      ["gone", "Gone worktree"],
    ]) {
      await page.open("/projects/qa");
      // The named menu identifies the row independently of its element type or list position.
      const card = `[role="listitem"]:has([aria-label=${JSON.stringify(`Session menu for ${title}`)}])`;
      await page.ab("wait", card);
      assert.match(await page.ab("get", "text", card), new RegExp(`${title}\\s*api\\s*feat-${id}`));
      await page.ab("click", `${card} [data-slot="item-title"] button`);
      await page.see("Answer 1.");
      const header = await page.evaluate("document.querySelector('header').textContent");
      // One line: folder then branch; the worktree segment is gone (it repeats the branch).
      assert.match(header, new RegExp(`Folder: apiGit branch: feat-${id}`));
      assert.doesNotMatch(header, /Worktree:/);
      assert.match(header, /Project: QA Project/);
      console.log(`Session header (${id}): ${header}`);
      await page.capture(`9-header-${id}`);
    }
  },
);
