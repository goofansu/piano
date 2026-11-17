import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness.mjs";
import { machine, remoteFixture } from "./remote-fixture.mjs";
import { voiceInputs } from "./voice-input.mjs";

// Headless Chrome on macOS ignores agent-browser's Meta+A; run this journey on Linux.
if (process.platform === "darwin") {
  console.log(
    "SKIP remote-inputs: needs Select All by keyboard, which headless Chrome on macOS lacks",
  );
  process.exit(0);
}

const fixture = remoteFixture();
const ready = (page) =>
  page.until(`document.querySelector('[aria-label^="Model:"]')?.disabled === false`);

await run(
  "remote-inputs",
  fixture.setup,
  async (page) => {
    await page.open("/");
    await page.see("Local collision session");
    await page.click("button", "Hide sidebar");
    for (const section of [
      "providers",
      "mcp",
      "skills",
      "prompts",
      "webhooks",
      "preferences",
      "data-controls",
    ]) {
      await page.open(`/settings/${section}`);
      await page.until(`!!document.querySelector('[aria-label="Settings"] header h1')`);
      assert.equal(
        await page.evaluate(
          `!!document.querySelector('[aria-label="Settings"] header [aria-label="Machine"]')`,
        ),
        false,
        `${section} header has no machine picker`,
      );
      await page.until(
        `!!document.querySelector('[aria-label="Settings"] header [aria-label="Show sidebar"]')`,
      );
    }
    await page.capture("0-settings-without-machine-picker");
    await page.open("/m/eng-1/settings/data-controls");
    await page.until(`location.pathname === '/m/eng-1/new'`);
    await page.see("What should we work on?");
    assert.equal(await page.evaluate(`document.title`), "New session - Piano");
    assert.equal(
      await page.evaluate(`!!document.querySelector('[aria-label="Settings"]')`),
      false,
      "a remote's Settings address opens a page, not Settings",
    );
    await page.capture("0a-remote-settings-address");
    await page.open("/settings/data-controls");
    await page.until(`!!document.querySelector('[aria-label="Settings"] header h1')`);
    await page.click("button", "Show sidebar");
    await page.click("button", "Home");
    await page.see("Local collision session");
    await page.click("button", "Local collision session");
    await page.see("Local collision session saved history");
    await ready(page);

    const localRequestsFromRemote = [];
    let onRemote = false;
    await page.cdp(async (call, onEvent) => {
      onEvent(({ method, params }) => {
        if (onRemote && method === "Network.requestWillBeSent") {
          const path = new URL(params.request.url).pathname;
          const mainUtility =
            (path === "/api/settings/voice-input" && params.request.method === "GET") ||
            (path === "/api/voice/transcribe" && params.request.method === "POST");
          if (path.startsWith("/api/") && path !== "/api/machines" && !mainUtility)
            localRequestsFromRemote.push(path);
        }
        if (
          onRemote &&
          method === "Network.webSocketCreated" &&
          new URL(params.url).pathname === "/ws"
        )
          localRequestsFromRemote.push("/ws");
      });
      await call("Network.enable");
      await voiceInputs(page, call, onEvent, async (name) => {
        onRemote = name !== null && name !== "Local";
        if (name !== null) await machine(page, name);
      });
      assert.deepEqual(
        localRequestsFromRemote,
        [],
        "remote voice UI calls only named main voice utilities, never Local session/file endpoints or socket",
      );
    });
    writeFileSync(
      join(page.evidence, "local-requests-from-remote.json"),
      JSON.stringify(localRequestsFromRemote),
    );
  },
  { peers: fixture.peers },
);
