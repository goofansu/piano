import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const sessionId = "same-session";
const workspaceId = "same-workspace";
export const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=";
const imagesFor = (machine) =>
  Buffer.concat([Buffer.from(png, "base64"), Buffer.from(machine)]).toString("base64");

export const remoteFixture = () => {
  let cwd;
  const seed = (machine, { root, history }) => {
    mkdirSync(join(root, "prompts"));
    writeFileSync(join(root, "prompts", `${machine}-only.md`), `Only ${machine}'s catalog.\n`);
    const titles =
      machine === "local"
        ? [
            [sessionId, "Local collision session"],
            ["local-only", "Local-only session"],
          ]
        : machine === "remote"
          ? [
              [sessionId, "Remote collision session"],
              ["remote-only", "Remote host-only session"],
            ]
          : [
              [sessionId, "Second collision session"],
              ["second-only", "Second host-only session"],
            ];
    const now = new Date().toISOString();
    return {
      folders: [cwd],
      workspaces: [{ id: workspaceId, path: cwd, folder: cwd }],
      sessions: titles.map(([id, title]) => {
        history({
          sessionId: id,
          cwd,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: `${title} saved history` },
                { type: "image", mimeType: "image/png", data: imagesFor(machine) },
              ],
              timestamp: Date.now(),
            },
            ...(id === "remote-only"
              ? [
                  {
                    role: "assistant",
                    content: [{ type: "text", text: "See [peer notes](peer-notes.md)." }],
                    timestamp: Date.now(),
                  },
                ]
              : []),
          ],
        });
        return { sessionId: id, cwd, title, createdAt: now, updatedAt: now };
      }),
    };
  };

  return {
    get cwd() {
      return cwd;
    },
    setup: (fixture) => {
      cwd = fixture.repository("repo");
      return seed("local", fixture);
    },
    peers: [
      { id: "eng-1", setup: (fixture) => seed("remote", fixture) },
      { id: "eng-2", setup: (fixture) => seed("second", fixture) },
    ],
  };
};

export const machine = async (page, name, capture) => {
  await page.click("button", "Machine");
  await page.until(
    `[...document.querySelectorAll('[role="menu"], [role="listbox"]')].some(e => e.getAnimations({subtree:true}).every(a => a.playState !== 'running'))`,
  );
  const role = await page.evaluate(`(() => {
    const option = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]')]
      .find(e => (e.getAttribute('aria-label') ?? e.textContent.trim()) === ${JSON.stringify(name)});
    return option?.getAttribute('role');
  })()`);
  assert.ok(role, `Machine picker offers ${name}`);
  if (capture) await page.capture(capture);
  await page.click(role, name);
  await page.until(`!document.querySelector('[role="menu"], [role="listbox"]')`);
};
