import assert from "node:assert/strict";

export async function projectDialogFocus(page) {
  await page.open("/projects");
  await page.see("New project");
  const trigger = `[...document.querySelectorAll('main header button')].find(e => e.textContent.trim() === 'New project')`;
  const dialog = `document.querySelector('[role=dialog][data-state=open]')`;
  const focus = async () => {
    const active = await page.evaluate(`(() => {
      const e = document.activeElement;
      return { tag: e.tagName, name: e.labels?.[0]?.textContent || e.textContent.trim().slice(0, 80), inside: !!e.closest('[role=dialog][data-state=open]') };
    })()`);
    console.log("New project focus:", active);
    return active;
  };
  const opened = async () => {
    await page.until(`!!${dialog}`);
    assert.deepEqual(await focus(), { tag: "INPUT", name: "Name", inside: true });
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
        const active = await focus();
        assert.equal(active.inside, true, `${key} stays inside New project`);
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
