import assert from "node:assert/strict";

export async function projectDialogFocus(page) {
  await page.open("/projects");
  await page.see("New project");
  const trigger = `[...document.querySelectorAll('main header button')].find(e => e.textContent.trim() === 'New project')`;
  const dialog = `document.querySelector('[role=dialog][data-open]')`;
  const focus = async () => {
    const active = await page.evaluate(`(() => {
      const e = document.activeElement;
      return { tag: e.tagName, name: e.labels?.[0]?.textContent || e.textContent.trim().slice(0, 80), inside: !!e.closest('[role=dialog][data-open]') };
    })()`);
    console.log("New project focus:", active);
    return active;
  };
  const opened = async () => {
    await page.until(`!!${dialog}`);
    assert.deepEqual(await focus(), {
      tag: "INPUT",
      name: "Name",
      inside: true,
    });
    assert.equal(
      await page.evaluate(
        `document.getElementById(${dialog}.getAttribute('aria-labelledby')).textContent`,
      ),
      "New project",
    );
  };
  const closed = async () => {
    await page.until(`!document.querySelector('[role=dialog]')`);
    console.log("After closing New project:", await focus());
    assert.equal(await page.evaluate(`document.activeElement === ${trigger}`), true);
  };
  const cycle = async (names) => {
    for (const key of ["Tab", "Shift+Tab"]) {
      const visited = [];
      for (let i = 0; i < names.length; i++) {
        await page.press(key);
        await page.until(`!!document.activeElement.closest('[role=dialog][data-open]')`);
        const active = await focus();
        visited.push(active.name);
      }
      assert.deepEqual(new Set(visited), new Set(names));
      assert.equal((await focus()).name, "Name", `${key} wraps back to Name`);
    }
  };
  await page.until(`${trigger}?.disabled === false`);
  for (let i = 0; i < 20 && !(await page.evaluate(`document.activeElement === ${trigger}`)); i++)
    await page.press("Shift+Tab");
  assert.equal((await focus()).name, "New project");
  await page.press("Enter");
  await opened();
  const snapshot = await page.ab("snapshot");
  console.log("New project accessibility tree:", snapshot);
  assert.match(snapshot, /dialog "New project"/);
  assert.doesNotMatch(snapshot, /button "New project"|button "Settings"/);
  const disabled = () => page.evaluate(`${dialog}.querySelector('button[type=submit]').disabled`);
  assert.equal(await disabled(), true);
  await page.press("Enter");
  await opened();
  await cycle(["Name", "Instructions", "Cancel", "Close"]);
  await page.ab("keyboard", "inserttext", "   ");
  assert.equal(await disabled(), true);
  await page.press("Mod+a");
  await page.ab("keyboard", "inserttext", "Focus trial");
  assert.equal(await disabled(), false);
  await cycle(["Name", "Instructions", "Cancel", "Create project", "Close"]);
  await page.capture("new-project-keyboard");
  await page.press("Escape");
  await closed();
  await page.press("Space");
  await opened();
  await page.press("Tab");
  await page.press("Tab");
  assert.equal((await focus()).name, "Cancel");
  await page.press("Enter");
  await closed();
  for (const dismissal of ["Escape", "Cancel"]) {
    await page.press("Mod+k");
    await page.until(`!!document.querySelector('[cmdk-input]')`);
    await page.ab("keyboard", "inserttext", "New project");
    await page.until(
      `document.querySelector('[cmdk-list]')?.getAttribute('aria-busy') === 'false'`,
    );
    await page.press("Enter");
    await opened();
    if (dismissal === "Cancel") {
      await page.press("Tab");
      await page.press("Tab");
      assert.equal((await focus()).name, "Cancel");
      await page.press("Enter");
    } else await page.press("Escape");
    await closed();
  }
}

export async function commandDialogFocus(page) {
  const describe = `(() => {
    const e = document.activeElement;
    return { tag: e.tagName, label: e === document.body ? '' : e.getAttribute('aria-label') ?? e.textContent.trim().slice(0, 40), sessionMenu: e.hasAttribute('data-session-menu'), projectMenu: e.hasAttribute('data-project-menu') };
  })()`;
  const dismiss = async (path, query, option, dialog, expected) => {
    await page.open(path);
    await page.until(`!!document.querySelector('main header')?.querySelector('${expected}')`);
    await page.press("Mod+k");
    await page.until(`!!document.querySelector('[cmdk-input]')`);
    await page.ab("keyboard", "inserttext", query);
    await page.until(
      `document.querySelector('[cmdk-item][data-selected=true]')?.textContent.trim() === ${JSON.stringify(option)} && document.querySelector('[cmdk-item][data-selected=true]').getAttribute('aria-disabled') !== 'true'`,
    );
    await page.press("Enter");
    await page.until(
      `document.getElementById(document.querySelector('[role=dialog][data-open], [role=alertdialog][data-open]')?.getAttribute('aria-labelledby'))?.textContent === ${JSON.stringify(dialog)}`,
    );
    await page.press("Escape");
    await page.until(`!document.querySelector('[role=dialog], [role=alertdialog]')`);
    const returned = `document.activeElement === document.querySelector('main header ${expected}')`;
    await page.until(returned).catch(() => {});
    const active = await page.evaluate(describe);
    console.log(`After dismissing ${dialog}:`, active);
    assert.equal(
      await page.evaluate(
        `document.activeElement === document.querySelector('main header ${expected}')`,
      ),
      true,
      `Escape from ${dialog} returns focus to ${expected}, not ${JSON.stringify(active)}`,
    );
  };
  const session = "[data-session-menu]";
  const failures = [];
  for (const [path, command, dialog, expected] of [
    ["/s/login-bug", "Rename", "Rename session", session],
    ["/s/login-bug", "Share", "Share to Radius", session],
    ["/s/login-bug", "Delete", "Delete session?", session],
    ["/projects/qa", "Project settings", "Project settings", "[data-project-menu]"],
  ])
    await dismiss(path, command, command, dialog, expected).catch((error) => failures.push(error));
  assert.deepEqual(
    failures.map((error) => error.message),
    [],
  );
  const trigger = `document.querySelector('main header ${session}')`;
  await page.open("/s/login-bug");
  await page.until(`${trigger}?.disabled === false`);
  await page.ab("eval", `${trigger}.focus()`);
  await page.press("Enter");
  await page.until(`document.activeElement?.getAttribute('role') === 'menuitem'`);
  await page.press("r");
  await page.until(`document.activeElement?.textContent.trim() === 'Rename'`);
  await page.press("Enter");
  await page.until(
    `!!document.querySelector('[role=dialog][data-open]') && !document.querySelector('[role=menu]')`,
  );
  assert.equal(
    await page.evaluate(`document.activeElement?.getAttribute('aria-label')`),
    "Session name",
    "the closing menu leaves focus in the dialog its item opened",
  );
  await page.press("Escape");
  await page.until(`!document.querySelector('[role=dialog]')`);
  await page.until(`document.activeElement === ${trigger}`);
}
