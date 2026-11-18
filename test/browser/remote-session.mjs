import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "@effect/platform-node/NodeWS";
import { run } from "./harness.mjs";
import { machine, png, remoteFixture, sessionId } from "./remote-fixture.mjs";
import { shareResultView, shareSignIn } from "./session-sharing.mjs";
import { prepareDictation } from "./voice-input.mjs";

// Headless Chrome on macOS ignores agent-browser's Meta+A; run this journey on Linux.
if (process.platform === "darwin") {
  console.log(
    "SKIP remote-session: needs Select All by keyboard, which headless Chrome on macOS lacks",
  );
  process.exit(0);
}

const fixture = remoteFixture();
const echo = "REMOTE-ECHO-ONCE";
const created = "REMOTE-NEW-ONCE";
const imageEvent = async (page, kind, name = "pasted.png") => {
  await page.evaluate(`(() => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), c => c.charCodeAt(0));
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], ${JSON.stringify(name)}, { type: 'image/png' }));
    const editor = document.querySelector('[aria-label="Message"], [aria-label="First message"]');
    editor.focus();
    editor.dispatchEvent(${kind === "paste" ? "new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })" : "new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })"});
  })()`);
  await page.until(`!!document.querySelector('[aria-label="Remove ${name}"]')`);
};
const imageShown = (page, machine) =>
  page.until(
    `[...document.querySelectorAll('[data-slot="transcript"] img[alt="Attachment preview"]')].some(i => i.getAttribute('src').startsWith('/peer/${machine}/api/peer/image-preview?') && i.complete && i.naturalWidth > 0)`,
  );

const waitFor = async (claim, observe) => {
  const deadline = Date.now() + 15_000;
  while (!observe()) {
    assert.ok(Date.now() < deadline, claim);
    await delay(25);
  }
};
const composer = '[aria-label="Message"]';
const draft = (page) => page.evaluate(`document.querySelector('${composer}')?.value`);
const ready = (page) =>
  page.until(`document.querySelector('[aria-label^="Model:"]')?.disabled === false`);
const send = async (page, text) => {
  await ready(page);
  await page.ab("fill", composer, text);
  await page.until(`document.querySelector('[aria-label="Send"]')?.disabled === false`);
  await page.click("button", "Send");
};

const catalog = async (page, own, other, restore, capture) => {
  await page.ab("fill", composer, "/");
  await page.see(`/${own}-only`);
  if (capture) await page.capture(capture);
  const commands = await page.evaluate(
    `document.querySelector('[aria-label="Slash commands"]').textContent`,
  );
  assert.ok(!commands.includes(`/${other}-only`), `${own} catalog excludes ${other}'s command`);
  await page.press("Escape");
  await page.ab("fill", composer, restore);
};
const unsupported = async (page) => {
  const controls =
    await page.evaluate(`[...document.querySelectorAll('button, a, [role="menuitem"], [role="tab"]')]
    .filter(e => e.getClientRects().length)
    .map(e => e.getAttribute('aria-label') ?? e.textContent.trim())`);
  for (const label of ["Add folder", "Settings", "Preview", "Open preview in new tab"])
    assert.ok(!controls.includes(label), `remote does not offer unsupported ${label}`);
};
const groupBy = async (page, label) => {
  await page.press("Mod+k");
  await page.ab("fill", "[cmdk-input]", label);
  await page.until("document.querySelector('[cmdk-list]')?.getAttribute('aria-busy') === 'false'");
  await page.ab("press", "Enter");
  await page.until("!document.querySelector('[cmdk-input]')");
};
const folderRow = async (page, machineName, capture) => {
  await groupBy(page, "Group by folder");
  await page.until(`!!document.querySelector('[aria-label="New session in repo"]')`);
  const menu = await page.evaluate(
    `!!document.querySelector('[aria-label="Folder menu for repo"]')`,
  );
  assert.equal(menu, machineName === "Local", `${machineName} folder row's Close menu`);
  await page.ab("hover", '[aria-label="New session in repo"]');
  await page.capture(capture);
  await page.ab("hover", "main");
  await groupBy(page, "Group by date");
  await page.until(`!document.querySelector('[aria-label="New session in repo"]')`);
};
const remoteNewPage = async (page) => {
  await page.until(`!!document.querySelector('[aria-label="First message"]')`);
  await page.ab("click", '[aria-label="Directory"]');
  await page.until(`!!document.querySelector('[aria-label="Choose a directory"]')`);
  const choices = await page.evaluate(
    `[...document.querySelectorAll('[aria-label="Choose a directory"] [cmdk-item]')].map(e => e.textContent.trim())`,
  );
  assert.deepEqual(choices, ["repo"], "only the remote's registered folder is offered");
  await page.press("Escape");
  await page.until(`!document.querySelector('[aria-label="Choose a directory"]')`);
};

await run(
  "remote-session",
  fixture.setup,
  async (page) => {
    const cwd = fixture.cwd;
    const imageFile = join(page.evidence, "picker.png");
    const invalidFile = join(page.evidence, "invalid.txt");
    writeFileSync(imageFile, Buffer.from(png, "base64"));
    writeFileSync(invalidFile, "not an image");
    await page.open("/");
    await page.see("Local collision session");
    await page.click("button", "Local collision session");
    await page.see("Local collision session saved history");
    await ready(page);
    await folderRow(page, "Local", "1-local-folder-row");
    await shareSignIn(page, "Local", true);
    await page.open(`/s/${sessionId}`);
    await ready(page);
    await catalog(page, "local", "remote", "LOCAL-DRAFT");
    await page.capture("1-local-draft");

    const frames = [];
    const sockets = new Map();
    const localRequestsFromRemote = [];
    let onRemote = false;
    let heldUpload;
    const imageRequests = [];
    const surfaceRequests = [];
    try {
      await page.cdp(async (call, onEvent) => {
        onEvent(({ method, params }) => {
          if (method === "Fetch.requestPaused" && params.request.url.endsWith("/api/peer/images"))
            heldUpload = params.requestId;
          if (
            method === "Network.requestWillBeSent" &&
            params.request.url.includes("/api/peer/image")
          )
            imageRequests.push(params.request.url);
          if (method === "Network.requestWillBeSent") {
            const { pathname } = new URL(params.request.url);
            if (/^\/peer\/[^/]+\/api\/(session|workspace)\//.test(pathname))
              surfaceRequests.push(`${params.request.method} ${pathname}`);
          }
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
          if (
            method === "Network.webSocketCreated" &&
            new URL(params.url).pathname === "/peer/eng-1/ws"
          ) {
            sockets.set(params.requestId, { url: params.url, closed: false });
          }
          if (!sockets.has(params.requestId)) return;
          if (method === "Network.webSocketClosed") sockets.get(params.requestId).closed = true;
          if (
            method === "Network.webSocketFrameReceived" ||
            method === "Network.webSocketFrameSent"
          ) {
            try {
              frames.push({
                direction: method.endsWith("Received") ? "received" : "sent",
                requestId: params.requestId,
                message: JSON.parse(params.response.payloadData),
              });
            } catch {}
          }
        });
        await call("Network.enable");
        onRemote = true;
        await machine(page, "eng-2");
        await page.see("Second host-only session");
        await page.click("button", "Second collision session");
        await page.see("Second collision session saved history");
        await ready(page);
        const dictate = await prepareDictation(page, call, onEvent, async (name) => {
          onRemote = name !== null && name !== "Local";
          if (name !== null) await machine(page, name);
        });
        const received = () => frames.filter((frame) => frame.direction === "received");
        const selected = () =>
          received().filter(
            ({ message }) =>
              message._tag === "selected" && message.sessionId === sessionId && message.cursor,
          );
        const starts = () =>
          page.remote
            .received()
            .filter((entry) => entry.command === "start" && entry.sessionId !== "probe");

        onRemote = true;
        await machine(page, "eng-1");
        await page.until(`location.pathname === '/m/eng-1/new'`);
        await page.see("Remote host-only session");
        await remoteNewPage(page);
        assert.equal(
          await page.evaluate(`document.body.innerText.includes('Local-only session')`),
          false,
        );
        await unsupported(page);
        await page.capture("2-remote-new-page");
        await folderRow(page, "eng-1", "2-remote-folder-row");
        await page.ab("find", "role", "button", "click", "--name", "Remote collision session");
        await page.until(`location.pathname === '/m/eng-1/s/${sessionId}'`);
        await page.see("Remote collision session saved history");
        await ready(page);
        assert.equal(
          await draft(page),
          "",
          "same session/cwd/workspace on peer cannot inherit local draft",
        );
        assert.equal(
          await page.evaluate(
            `document.querySelector('[data-slot="transcript"]').innerText.includes('Local collision session saved history')`,
          ),
          false,
        );
        await shareSignIn(page, "eng-1");
        await shareResultView(page, call, onEvent);
        await catalog(page, "remote", "local", "", "2b-remote-saved-session-commands");
        await imageShown(page, "eng-1");
        assert.equal(
          await page.evaluate(
            `document.querySelector('[data-slot="transcript"] a[href*="/api/peer/image-preview"]').getAttribute('href')`,
          ),
          await page.evaluate(
            `document.querySelector('[data-slot="transcript"] img[alt="Attachment preview"]').getAttribute('src')`,
          ),
          "full-image link uses the same peer-owned address as its thumbnail",
        );
        assert.equal(
          await page.evaluate(`!!document.querySelector('[aria-label="Voice input"]')`),
          true,
        );
        await page.ab("upload", 'input[aria-label="Image files"]', imageFile);
        await page.until(`!!document.querySelector('[aria-label="Remove picker.png"]')`);
        await imageEvent(page, "paste");
        await imageEvent(page, "drop", "dropped.png");
        await page.click("button", "Remove dropped.png");
        await page.click("button", "Remove pasted.png");
        await page.ab("upload", 'input[aria-label="Image files"]', invalidFile);
        await page.see("Other files aren't supported yet.");
        assert.ok(
          await page.evaluate(`!!document.querySelector('[aria-label="Remove picker.png"]')`),
          "invalid addition preserves accepted image",
        );
        await page.capture("2c-remote-image-draft");
        await dictate(echo);
        assert.deepEqual(page.remote.prompts(), [], "reviewed voice text is still unsent");
        await call("Fetch.enable", {
          patterns: [{ urlPattern: "*/api/peer/images", requestStage: "Request" }],
        });
        try {
          await page.click("button", "Send");
          await waitFor("upload failure request paused", () => !!heldUpload);
          await call("Fetch.fulfillRequest", {
            requestId: heldUpload,
            responseCode: 404,
            body: Buffer.from(
              JSON.stringify({ error: "Image target is not listed on this machine." }),
            ).toString("base64"),
          });
          await page.see("Image target is not listed on this machine.");
          assert.equal(await draft(page), echo);
          assert.ok(
            await page.evaluate(`!!document.querySelector('[aria-label="Remove picker.png"]')`),
          );
          assert.deepEqual(page.remote.prompts(), [], "failed preparation never reaches Pi");
          await page.capture("2d-image-upload-failure");
        } finally {
          await call("Fetch.disable");
          heldUpload = undefined;
        }
        await send(page, echo);
        await page.see(`echo: ${echo}`);
        await imageShown(page, "eng-1");
        assert.equal(
          page.remote.received().find((e) => e.command === "prompt" && e.text === echo).images
            .length,
          1,
        );
        const imageAct = frames.find(
          (f) =>
            f.direction === "sent" && f.message._tag === "act" && f.message.action.text === echo,
        ).message;
        assert.ok(imageAct.preparedImages);
        assert.equal(
          imageAct.action.attachments,
          undefined,
          "image bytes never enter the conversation socket",
        );
        assert.deepEqual(page.remote.prompts(), [echo], "peer receives one prompt");
        assert.deepEqual(page.prompts(), [], "local Pi receives no remote prompt");
        await catalog(page, "remote", "local", "REMOTE-DRAFT");
        await page.capture("3-remote-reply-draft");
        await page.click("button", "Hide sidebar");
        await page.until(
          `document.querySelector('main header [aria-label="Machine"]')?.textContent.includes('eng-1')`,
        );
        await page.capture("3a-machine-with-sidebar-hidden");
        await machine(page, "eng-2", "3b-machine-picker");
        await page.until(
          `document.querySelector('main header [aria-label="Machine"]')?.textContent.includes('eng-2')`,
        );
        await page.click("button", "Show sidebar");
        await page.until(`!document.querySelector('main header [aria-label="Machine"]')`);

        await page.see("Second host-only session");
        await page.ab("find", "role", "button", "click", "--name", "Second collision session");
        await page.see("Second collision session saved history");
        await ready(page);
        assert.equal(await draft(page), "", "second peer cannot inherit first peer's draft");
        await imageShown(page, "eng-2");
        await imageEvent(page, "drop", "second.png");
        await send(page, "SECOND-ECHO-ONCE");
        await page.see("echo: SECOND-ECHO-ONCE");
        await catalog(page, "second", "remote", "SECOND-DRAFT");
        assert.deepEqual(page.remote.prompts(), [echo]);
        assert.deepEqual(page.peers["eng-2"].prompts(), ["SECOND-ECHO-ONCE"]);
        await page.capture("3b-second-peer");
        await machine(page, "eng-1");
        await page.see(`echo: ${echo}`);
        assert.equal(await draft(page), "REMOTE-DRAFT");
        await page.ab("back");
        await page.until(`location.pathname === '/m/eng-2/s/${sessionId}'`);
        await page.see("echo: SECOND-ECHO-ONCE");
        assert.equal(await draft(page), "SECOND-DRAFT", "back retains second peer ownership");
        await page.ab("forward");
        await page.until(`location.pathname === '/m/eng-1/s/${sessionId}'`);
        await page.see(`echo: ${echo}`);
        assert.equal(await draft(page), "REMOTE-DRAFT", "forward retains first peer ownership");
        await catalog(page, "remote", "second", "REMOTE-DRAFT");

        const platform = await page.evaluate("navigator.platform");
        const numericKeyConsumed = (key) =>
          page.evaluate(`(() => {
            const event = new KeyboardEvent('keydown', {
              key: ${JSON.stringify(key)}, metaKey: true, bubbles: true, cancelable: true,
            });
            document.activeElement.dispatchEvent(event);
            return event.defaultPrevented;
          })()`);
        const firstPeerRoute = `/m/eng-1/s/${sessionId}`;
        await call("Emulation.setNavigatorOverrides", { platform: "MacIntel" });
        assert.equal(
          await page.evaluate("matchMedia('(display-mode: standalone)').matches"),
          false,
          "ordinary browser mode is not standalone",
        );
        assert.equal(await numericKeyConsumed("1"), false, "browser tab chord is not consumed");
        assert.equal(await numericKeyConsumed("0"), false, "browser zoom reset is not consumed");
        assert.equal(await page.evaluate("location.pathname"), firstPeerRoute);
        // Chromium CDP ignores display-mode in setEmulatedMedia; emulate only this query.
        await page.evaluate(`(() => {
          window.originalMatchMedia = window.matchMedia;
          window.matchMedia = (query) => {
            const media = window.originalMatchMedia(query);
            if (query === '(display-mode: standalone)')
              Object.defineProperty(media, 'matches', { value: true });
            return media;
          };
        })()`);
        assert.equal(
          await page.evaluate("matchMedia('(display-mode: standalone)').matches"),
          true,
          "standalone display mode is emulated, not a native installed macOS PWA",
        );
        await call("Emulation.setNavigatorOverrides", { platform: "Linux x86_64" });
        for (const key of ["1", "0"])
          assert.equal(await numericKeyConsumed(key), false, "non-Mac PWA leaves chord alone");
        await call("Emulation.setNavigatorOverrides", { platform: "MacIntel" });
        assert.equal(
          await numericKeyConsumed("9"),
          false,
          "missing ninth machine leaves chord alone",
        );
        await page.press("Mod+k");
        await page.until("!!document.querySelector('[cmdk-input]')");
        for (const key of ["1", "0"])
          assert.equal(await numericKeyConsumed(key), false, "palette owns its editing context");
        assert.equal(await page.evaluate("location.pathname"), firstPeerRoute);
        await page.press("Escape");
        await page.until("!document.querySelector('[cmdk-input]')");
        await page.ab("focus", composer);
        await page.capture("3c-before-machine-shortcut");
        await page.press("Meta+3");
        await page.until(`location.pathname === '/m/eng-2/s/${sessionId}'`);
        await ready(page);
        assert.equal(await draft(page), "SECOND-DRAFT", "Cmd+3 restores second peer draft");
        await page.ab("focus", composer);
        await page.press("Meta+2");
        await page.until(`location.pathname === '${firstPeerRoute}'`);
        await ready(page);
        assert.equal(await draft(page), "REMOTE-DRAFT", "Cmd+2 restores first peer draft");
        await page.ab("back");
        await page.until(`location.pathname === '/m/eng-2/s/${sessionId}'`);
        assert.equal(await draft(page), "SECOND-DRAFT", "shortcut uses picker history semantics");
        await page.ab("forward");
        await page.until(`location.pathname === '${firstPeerRoute}'`);
        await page.ab("focus", composer);
        await page.press("Meta+0");
        await page.until(`location.pathname === '/m/eng-2/s/${sessionId}'`);
        await ready(page);
        assert.equal(await draft(page), "SECOND-DRAFT", "Cmd+0 restores the last machine's draft");
        await page.capture("3c-last-machine-shortcut");
        const lastMachineHistoryLength = await page.evaluate("history.length");
        await page.press("Meta+0");
        assert.equal(await page.evaluate("history.length"), lastMachineHistoryLength);
        await page.ab("back");
        await page.until(`location.pathname === '${firstPeerRoute}'`);
        await ready(page);
        assert.equal(await draft(page), "REMOTE-DRAFT", "Cmd+0 does not duplicate current history");
        onRemote = false;
        await page.press("Meta+1");
        await page.until(`location.pathname === '/s/${sessionId}'`);
        await ready(page);
        assert.equal(await draft(page), "LOCAL-DRAFT", "Cmd+1 restores Local draft");
        await page.click("button", "New session");
        await page.until("!!document.querySelector('[aria-label=\"First message\"]')");
        await page.ab("fill", '[aria-label="First message"]', "LOCAL-NEW-DRAFT");
        onRemote = true;
        await page.press("Meta+2");
        await page.until(`location.pathname === '${firstPeerRoute}'`);
        await ready(page);
        assert.equal(await draft(page), "REMOTE-DRAFT");
        onRemote = false;
        await page.press("Meta+1");
        await page.until("location.pathname === '/new'");
        assert.equal(
          await page.evaluate(`document.querySelector('[aria-label="First message"]')?.value`),
          "LOCAL-NEW-DRAFT",
          "new-session composer also retains its draft and remembered route",
        );
        onRemote = true;
        await page.press("Meta+0");
        await page.until(`location.pathname === '/m/eng-2/s/${sessionId}'`);
        await ready(page);
        assert.equal(
          await draft(page),
          "SECOND-DRAFT",
          "Cmd+0 works from the new-session composer",
        );
        await page.press("Meta+2");
        await page.until(`location.pathname === '${firstPeerRoute}'`);
        await ready(page);
        assert.equal(await draft(page), "REMOTE-DRAFT");
        await page.capture("3d-after-machine-shortcuts");
        await page.evaluate(
          "window.matchMedia = window.originalMatchMedia; delete window.originalMatchMedia",
        );
        for (const key of ["1", "0"])
          assert.equal(
            await numericKeyConsumed(key),
            false,
            "leaving standalone disables shortcut",
          );
        assert.equal(await page.evaluate("location.pathname"), firstPeerRoute);
        await call("Emulation.setNavigatorOverrides", { platform });

        await page.ab("set", "viewport", "700", "850");
        const revealOpen = `document.querySelector('[data-slot="mobile-sidebar"]')?.getAttribute('data-state') === 'open'`;
        await page.click("button", "Show sidebar");
        await page.until(revealOpen);
        await page.until(
          `document.querySelector('[data-slot="mobile-sidebar"]').getAnimations({subtree:true}).every(a => a.playState !== 'running')`,
        );
        await page.evaluate(`window.sidebarDocumentMarker = 'same-document'`);
        await page.evaluate(`(() => {
          const reveal = () => document.querySelector('[data-slot="mobile-sidebar"]');
          window.sidebarFocusLeft = [];
          document.addEventListener('focusin', (e) => {
            if (!reveal()?.contains(e.target) && !e.target.closest('[role="menu"]'))
              window.sidebarFocusLeft.push(e.target.getAttribute('aria-label') ?? e.target.localName);
          });
          window.sidebarEntrances = [];
          document.addEventListener('transitionstart', (e) => {
            const slot = e.target.dataset?.slot;
            if (slot === 'sidebar-reveal-navigation' || slot === 'sidebar-scrim')
              window.sidebarEntrances.push(slot + ':' + e.propertyName);
          }, true);
        })()`);
        await machine(page, "eng-2");
        await page.see("echo: SECOND-ECHO-ONCE");
        assert.equal(await page.evaluate(revealOpen), true, "peer switch keeps sidebar expanded");
        assert.equal(await draft(page), "SECOND-DRAFT");
        await page.capture("3b-narrow-peer-sidebar");
        await page.ab("back");
        await page.see(`echo: ${echo}`);
        assert.equal(
          await page.evaluate(revealOpen),
          true,
          "Back restores a session without dismissing sidebar",
        );
        await page.ab("forward");
        await page.see("echo: SECOND-ECHO-ONCE");
        assert.equal(await page.evaluate(revealOpen), true, "Forward keeps sidebar expanded");
        assert.equal(
          await page.evaluate(`window.sidebarDocumentMarker`),
          "same-document",
          "no document reload",
        );
        assert.deepEqual(
          await page.evaluate(`window.sidebarEntrances`),
          [],
          "peer switches and Back/Forward do not replay the sidebar's entrance",
        );
        assert.deepEqual(
          await page.evaluate(`window.sidebarFocusLeft`),
          [],
          "focus stays in the sidebar across peer switches and Back/Forward",
        );
        await page.until(
          `document.querySelector('[data-slot="mobile-sidebar"]')?.contains(document.activeElement)`,
        );
        await page.press("Escape");
        await page.until(`!(${revealOpen})`);
        await page.until(`document.activeElement?.getAttribute('aria-label') === 'Show sidebar'`);
        await page.click("button", "Show sidebar");
        await page.until(revealOpen);
        await page.until(
          `document.querySelector('[data-slot="mobile-sidebar"]').getAnimations({subtree:true}).every(a => a.playState !== 'running')`,
        );
        await page.click("button", "Second collision session");
        await page.until(`!document.querySelector('[data-slot="mobile-sidebar"]')`);
        await machine(page, "eng-1");
        await page.see(`echo: ${echo}`);
        assert.equal(await page.evaluate(revealOpen), false, "switching while closed stays closed");
        assert.equal(await draft(page), "REMOTE-DRAFT");
        await page.ab("set", "viewport", "1280", "900");

        await imageEvent(page, "paste", "cancelled.png");
        await call("Fetch.enable", {
          patterns: [{ urlPattern: "*/api/peer/images", requestStage: "Request" }],
        });
        try {
          await page.click("button", "Send");
          await waitFor("upload request paused", () => !!heldUpload);
          await page.see("Uploading images…");
          await page.ab("fill", composer, "AFTER-UPLOAD");
          await page.capture("3c-upload-new-typing");
          await machine(page, "eng-2");
          await page.see("echo: SECOND-ECHO-ONCE");
          assert.equal(await draft(page), "SECOND-DRAFT");
          await call("Fetch.continueRequest", { requestId: heldUpload }).catch(() => {});
        } finally {
          await call("Fetch.disable");
          heldUpload = undefined;
        }
        await machine(page, "eng-1");
        await page.see(`echo: ${echo}`);
        await page.until(
          `document.querySelector('${composer}')?.value === 'REMOTE-DRAFT\\n\\nAFTER-UPLOAD'`,
        );
        await page.click("button", "Remove cancelled.png");
        await page.ab("fill", composer, "REMOTE-DRAFT");
        assert.deepEqual(page.remote.prompts(), [echo], "cancelled upload never becomes an input");

        onRemote = false;
        await machine(page, "Local");
        await page.see("Local collision session");
        await page.click("button", "Local collision session");
        await page.see("Local collision session saved history");
        await ready(page);
        assert.equal(await draft(page), "LOCAL-DRAFT", "local draft survived remote input");
        await catalog(page, "local", "remote", "LOCAL-DRAFT");
        assert.equal(
          await page.evaluate(`document.body.innerText.includes('Remote host-only session')`),
          false,
        );
        await page.capture("4-local-return");

        onRemote = true;
        await machine(page, "eng-1");
        await page.see("Remote collision session");
        await page.ab("find", "role", "button", "click", "--name", "Remote collision session");
        await page.see(`echo: ${echo}`);
        await ready(page);
        assert.equal(await draft(page), "REMOTE-DRAFT", "remote draft survived local selection");
        await catalog(page, "remote", "local", "REMOTE-DRAFT");
        await page.click("button", "Context usage");
        await page.until(`!!document.querySelector('[aria-label="Context usage details"]')`);
        await page.capture("5-remote-context");
        await page.press("Escape");
        await page.until(`!document.querySelector('[aria-label="Context usage details"]')`);

        await send(page, "question");
        await page.see("Which checks?");
        onRemote = false;
        await machine(page, "Local");
        await page.see("Local collision session");
        await page.click("button", "Local collision session");
        await page.see("Local collision session saved history");
        assert.equal(
          await page.evaluate(`document.body.innerText.includes('Which checks?')`),
          false,
        );
        onRemote = true;
        await machine(page, "eng-1");
        await page.see("Remote collision session");
        await page.ab("find", "role", "button", "click", "--name", "Remote collision session");
        await page.see("Which checks?");
        await imageEvent(page, "paste", "dialog-upload.png");
        await call("Fetch.enable", {
          patterns: [{ urlPattern: "*/api/peer/images", requestStage: "Request" }],
        });
        try {
          await page.ab("fill", composer, "do not submit");
          await page.press("Enter");
          await waitFor("dialog image upload paused", () => !!heldUpload);
          await page.see("Uploading images…");
          await page.click("radio", "Quick checks");
          await page.click("button", "Send answer");
          await page.see("Answer: Quick checks");
          await page.capture("5a-dialog-answered-during-upload");
          await page.click("button", "Cancel image upload");
          await call("Fetch.continueRequest", { requestId: heldUpload }).catch(() => {});
        } finally {
          await call("Fetch.disable");
          heldUpload = undefined;
        }
        await page.until(`!!document.querySelector('[aria-label="Remove dialog-upload.png"]')`);
        await page.click("button", "Remove dialog-upload.png");
        await page.ab("fill", composer, "");
        assert.equal(
          page.remote.received().filter((entry) => entry.command === "extension_ui_response")
            .length,
          1,
        );
        assert.equal(
          page.received().filter((entry) => entry.command === "extension_ui_response").length,
          0,
        );

        await send(page, "stream");
        await page.see("Streaming line");
        await page.until(`!!document.querySelector('button[aria-label="Stop"]')`);
        await imageEvent(page, "paste", "queued.png");
        await page.ab("fill", composer, "queued image");
        await page.press("Enter");
        await page.see("Queued messages (1)");
        await page.click("button", "Edit queued message");
        await page.until(
          `document.querySelector('${composer}')?.value === 'queued image' && !document.querySelector('[aria-label="Queued messages"]')`,
        );
        assert.equal(
          await page.evaluate(`!!document.querySelector('[aria-label="Remove queued.png"]')`),
          false,
        );
        await page.ab("click", composer);
        await page.press("Mod+A");
        await page.press("Backspace");
        await imageEvent(page, "drop", "empty-queue.png");
        await page.press("Alt+Enter");
        await page.see("Queued messages (1)");
        assert.equal(
          await page.evaluate(
            `document.querySelector('[aria-label="Queued messages"] ol li').textContent.trim()`,
          ),
          "",
        );
        await page.capture("5b-image-only-pi-queue");
        await page.click("button", "Edit queued message");
        await page.until(`!document.querySelector('[aria-label="Queued messages"]')`);
        assert.equal(await draft(page), "");
        const imageInputs = page.remote
          .received()
          .filter((e) => e.command === "prompt" && e.images);
        assert.equal(imageInputs.find((e) => e.text === "queued image").streamingBehavior, "steer");
        assert.equal(imageInputs.find((e) => e.text === "").streamingBehavior, "followUp");
        const beforeOutage = page.remote
          .received()
          .filter((entry) => entry.command === "stream")
          .at(-1).line;
        await page.peers["eng-2"].stop();
        await machine(page, "eng-2");
        await page.until(`location.pathname === '/m/eng-2/s/${sessionId}'`);
        await page.see("Machine unavailable");
        assert.equal(
          await page.evaluate(`!!document.querySelector('[aria-label="Send"]:not(:disabled)')`),
          false,
        );
        await waitFor(
          "first peer keeps streaming while the selected second peer is unavailable",
          () =>
            page.remote
              .received()
              .filter((entry) => entry.command === "stream")
              .at(-1).line >
            beforeOutage + 2,
        );
        assert.deepEqual(page.peers["eng-2"].prompts(), ["SECOND-ECHO-ONCE"]);
        assert.deepEqual(page.prompts(), []);
        await page.capture("6a-second-peer-unavailable");
        await machine(page, "eng-1");
        await page.see("Streaming line");
        await page.until(`!!document.querySelector('button[aria-label="Stop"]')`);
        await waitFor("remote host has a generation", () => selected().length > 0);
        assert.equal(starts().length, 1, "switching machines reused the sole peer Pi process");
        const pid = starts()[0].pid;
        assert.ok(Number.isInteger(pid), "audit identifies the remote Pi PID");
        const secondStarts = page.peers["eng-2"]
          .received()
          .filter((entry) => entry.command === "start" && entry.sessionId !== "probe");
        assert.equal(
          secondStarts.length,
          1,
          "second peer also owns exactly one Pi for the colliding session",
        );
        assert.notEqual(secondStarts[0].pid, pid, "each backend owns its own Pi process");
        const generation = selected().at(-1).message.cursor.generation;
        const connection = received().at(-1).requestId;
        const beforeReconnect = selected().length;
        const tick = () =>
          page.remote
            .received()
            .filter((entry) => entry.command === "stream")
            .at(-1);
        let disconnectedLine;
        await page.restartBackend({
          beforeRestart: async () => {
            await waitFor("browser socket actually closed", () => sockets.get(connection)?.closed);
            await page.until(
              `document.querySelector('button[aria-label="Stop"]')?.disabled === true`,
            );
            disconnectedLine = tick().line;
            await waitFor(
              "same remote Pi continues emitting with browser disconnected",
              () => tick().line > disconnectedLine + 2 && tick().pid === pid,
            );
            process.kill(pid, 0);
            assert.equal(starts().length, 1);
            await page.capture("6-disconnected-host-still-streaming");
          },
        });
        await waitFor("reconnect attaches to same remote generation", () =>
          selected()
            .slice(beforeReconnect)
            .some(
              (frame) =>
                frame.requestId !== connection &&
                frame.message.cursor.generation === generation &&
                frame.message.snapshot.state.isStreaming,
            ),
        );
        await page.until(
          `!!document.querySelector('button[aria-label="Stop"]') && !document.body.innerText.includes('Reconnecting…')`,
        );
        await page.until(
          `[...document.querySelector('[data-slot="transcript"]').innerText.matchAll(/Streaming line ([0-9]+)/g)].some(m => Number(m[1]) > ${disconnectedLine})`,
        );
        await page.capture("7-reconnected-same-generation");

        const beforeReload = selected().length;
        const promptsBeforeStopUpload = page.remote.prompts();
        await call("Fetch.enable", {
          patterns: [{ urlPattern: "*/api/peer/images", requestStage: "Request" }],
        });
        try {
          await page.ab("reload");
          await page.until(`location.pathname === '/m/eng-1/s/${sessionId}'`);
          await waitFor(
            "deep-link reload attaches to remote generation without resend",
            () =>
              selected().length > beforeReload &&
              selected().at(-1).message.cursor.generation === generation &&
              selected().at(-1).message.snapshot.state.isStreaming,
          );
          await page.see("Streaming line");
          await page.until(`!!document.querySelector('button[aria-label="Stop"]')`);
          process.kill(pid, 0);
          assert.equal(starts().length, 1, "disconnect and reload never replace remote Pi");
          await page.capture("8-remote-deep-link-reload");
          await imageEvent(page, "paste", "stop-upload.png");
          await page.press("Enter");
          await waitFor("stop image upload paused", () => !!heldUpload);
          await page.see("Uploading images…");
          assert.deepEqual(
            page.remote.prompts(),
            promptsBeforeStopUpload,
            "the paused upload has not delivered an input to Pi",
          );
          await page.capture("8a-stop-upload-paused");
          await page.click("button", "Stop");
          await page.until(`document.querySelector('[aria-label="Send"]') !== null`);
          await call("Fetch.continueRequest", { requestId: heldUpload }).catch(() => {});
        } finally {
          await call("Fetch.disable");
          heldUpload = undefined;
        }
        await page.until(`!!document.querySelector('[aria-label="Remove stop-upload.png"]')`);
        await page.click("button", "Remove stop-upload.png");
        await waitFor("Stop reaches only remote Pi", () =>
          page.remote
            .received()
            .some((entry) => entry.command === "abort" && entry.sessionId === sessionId),
        );
        assert.equal(page.remote.received().filter((entry) => entry.command === "abort").length, 1);
        assert.equal(page.received().filter((entry) => entry.command === "abort").length, 0);
        assert.deepEqual(
          page.remote.prompts(),
          [echo, "question", "stream", "queued image", ""],
          "each input reaches the peer once, never resent",
        );
        assert.deepEqual(page.prompts(), [], "no local prompt from remote UI");
        assert.deepEqual(
          page.peers["eng-2"].prompts(),
          ["SECOND-ECHO-ONCE"],
          "no replay or cross-peer fallback",
        );
        assert.equal(
          page.peers["eng-2"]
            .received()
            .filter((entry) => entry.command === "extension_ui_response").length,
          0,
        );
        assert.equal(starts().length, 1, "Stop leaves the same remote Pi available");
        process.kill(pid, 0);
        assert.equal(
          await page.evaluate(
            `[...document.querySelectorAll('[data-slot="transcript"] article')].filter(a => a.innerText.includes('${echo}') && !a.innerText.includes('echo:')).length`,
          ),
          1,
        );
        assert.ok(
          received()
            .filter(({ message }) => message.cursor?.sessionId === sessionId)
            .every(({ message }) => message.cursor.generation === generation),
          "one host generation throughout the journey",
        );
        assert.equal(
          frames.filter(
            ({ direction, message }) => direction === "sent" && message._tag === "create_session",
          ).length,
          0,
          "continuing a remote session never creates one",
        );
        await unsupported(page);
        await page.capture("9-remote-stopped");

        await page.click("button", "New session");
        await page.until(`location.pathname === '/m/eng-1/new'`);
        await remoteNewPage(page);
        await imageEvent(page, "paste", "first.png");
        await page.ab("fill", '[aria-label="First message"]', created);
        await page.until(`document.querySelector('[aria-label="Send"]')?.disabled === false`);
        await page.capture("9a-remote-new-session-draft");
        await page.click("button", "Send");
        await page.until(
          `/^\\/m\\/eng-1\\/s\\//.test(location.pathname) && location.pathname !== '/m/eng-1/s/${sessionId}'`,
        );
        await page.see(`echo: ${created}`);
        await imageShown(page, "eng-1");
        assert.equal(
          page.remote.received().find((e) => e.command === "prompt" && e.text === created).images
            .length,
          1,
        );
        const createdId = decodeURIComponent(
          (await page.evaluate(`location.pathname`)).split("/").at(-1),
        );
        const creations = frames.filter(
          ({ direction, message }) => direction === "sent" && message._tag === "create_session",
        );
        assert.equal(creations.length, 1, "one creation request");
        assert.equal(creations[0].message.cwd, cwd);
        assert.equal(creations[0].message.projectId, undefined, "no project chosen");
        assert.deepEqual(
          page.remote.prompts(),
          [echo, "question", "stream", "queued image", "", created],
          "the new session's first message reaches the peer once",
        );
        assert.ok(
          page.remote
            .received()
            .some((entry) => entry.command === "start" && entry.sessionId === createdId),
          "the peer started the new session's Pi",
        );
        assert.deepEqual(page.prompts(), [], "local Pi receives no remote creation");
        assert.deepEqual(page.peers["eng-2"].prompts(), ["SECOND-ECHO-ONCE"]);
        await page.capture("9b-remote-new-session-reply");
        await imageEvent(page, "drop", "only.png");
        await page.click("button", "Send");
        await waitFor(
          "image-only existing input reached peer",
          () => page.remote.prompts().filter((p) => p === "").length === 2,
        );
        await page.until(
          `!document.querySelector('[aria-label="Remove only.png"]') && !document.body.innerText.includes('Uploading images…')`,
        );
        await page.click("button", "New session");
        await remoteNewPage(page);
        await imageEvent(page, "paste", "only-first.png");
        await ready(page);
        await page.click("button", "Send");
        await waitFor(
          "image-only creation reached peer",
          () => page.remote.prompts().filter((p) => p === "").length === 3,
        );
        await page.until(
          `/^\\/m\\/eng-1\\/s\\//.test(location.pathname) && location.pathname !== '/m/eng-1/s/${createdId}'`,
        );
        await imageShown(page, "eng-1");
        const beforeImageReload = page.remote.prompts().length;
        await page.ab("reload");
        await imageShown(page, "eng-1");
        assert.equal(
          page.remote.prompts().length,
          beforeImageReload,
          "reload reconstructs peer images without resending",
        );
        await page.capture("9c-image-only-reloaded");
        await page.ab("set", "viewport", "390", "844");
        await page.until(
          `document.querySelector('[aria-label="Message"]')?.getBoundingClientRect().right <= innerWidth`,
        );
        await page.capture("9c-image-only-narrow");
        await page.ab("set", "viewport", "1280", "900");
        if (process.env.PIANO_TEST_LARGE_IMAGES === "1") {
          const big = Buffer.alloc(10 * 1024 * 1024);
          Buffer.from(png, "base64").copy(big);
          const paths = Array.from({ length: 5 }, (_, i) =>
            join(page.evidence, `maximum-${i}.png`),
          );
          for (const path of paths) writeFileSync(path, big);
          await page.ab("upload", 'input[aria-label="Image files"]', ...paths);
          await page.until(
            `document.querySelectorAll('[aria-label^="Remove maximum-"]').length === 5 && !document.body.innerText.includes('Reading images…')`,
          );
          const inputsBefore = page.remote.prompts().length;
          const began = Date.now();
          await call("Network.emulateNetworkConditions", {
            offline: false,
            latency: 100,
            downloadThroughput: -1,
            uploadThroughput: 4 * 1024 * 1024,
          });
          try {
            await page.click("button", "Send");
            await page.see("Uploading images…");
            await page.capture("9d-maximum-batch-uploading");
            const deadline = Date.now() + 120_000;
            while (page.remote.prompts().length === inputsBefore) {
              assert.ok(Date.now() < deadline, "maximum batch delivered");
              await delay(100);
            }
            await imageShown(page, "eng-1");
          } finally {
            await call("Network.emulateNetworkConditions", {
              offline: false,
              latency: 0,
              downloadThroughput: -1,
              uploadThroughput: -1,
            });
          }
          const last = page.remote
            .received()
            .filter((e) => e.command === "prompt")
            .at(-1);
          assert.equal(last.images.length, 5);
          assert.ok(last.images.every((i) => i.bytes === 10 * 1024 * 1024));
          writeFileSync(
            join(page.evidence, "maximum-batch.json"),
            JSON.stringify(
              {
                originalBytes: 50 * 1024 * 1024,
                elapsedMs: Date.now() - began,
                uploadBytesPerSecond: 4 * 1024 * 1024,
                imageInputs: last.images,
              },
              null,
              2,
            ),
          );
          await page.capture("9e-maximum-batch-delivered");
        }
        assert.ok(imageRequests.some((url) => url.includes("/peer/eng-1/api/peer/image-preview")));
        assert.ok(imageRequests.some((url) => url.includes("/peer/eng-2/api/peer/image-preview")));
        assert.deepEqual(
          localRequestsFromRemote,
          [],
          "remote UI calls only named main voice utilities, never Local session/file endpoints or socket",
        );
        writeFileSync(join(cwd, "peer-notes.md"), "# Peer notes\n\nRead on eng-1.\n");
        await page.open("/m/eng-1/s/remote-only");
        await page.see("Remote host-only session saved history");
        await page.ab("click", "[data-rail-trigger]");
        await page.see("Environment");
        await page.click("button", "Changes");
        await page.until(
          `!!document.querySelector('[aria-label="Changed files"]')?.textContent.includes('peer-notes.md')`,
        );
        await page.capture("9f-remote-changes");
        await page.ab("click", '[data-local-file="peer-notes.md"]');
        await page.until(
          `[...document.querySelectorAll('[aria-label="File viewer"] h1')].some(h => h.textContent === 'Peer notes')`,
        );
        await page.capture("9f-remote-file");
        await unsupported(page);
        for (const request of [
          "POST /peer/eng-1/api/session/changes",
          "POST /peer/eng-1/api/workspace/file",
        ])
          assert.ok(surfaceRequests.includes(request), `${request}: ${surfaceRequests}`);
        assert.deepEqual(
          localRequestsFromRemote,
          [],
          "a remote session's surfaces never read Local's endpoints",
        );
        await page.open("/m/eng-1/projects");
        await page.see("No projects yet");
        await page.click("button", "New project");
        await page.ab("find", "label", "Name", "fill", "Peer project");
        await page.click("button", "Create project");
        await page.see("Project created");
        await page.until(`/^\\/m\\/eng-1\\/projects\\/[^/]+$/.test(location.pathname)`);
        const projectId = decodeURIComponent(
          (await page.evaluate(`location.pathname`)).split("/").at(-1),
        );
        await page.capture("9g-remote-project-home");
        await page.ab("click", '[aria-label="Directory"]');
        await page.until(`!!document.querySelector('[aria-label="Choose a directory"]')`);
        await page.ab("find", "role", "option", "click", "--name", "repo");
        await page.until(`!document.querySelector('[aria-label="Choose a directory"]')`);
        await ready(page);
        await page.ab("fill", '[aria-label="First message"]', "PROJECT-ONCE");
        await page.until(`document.querySelector('[aria-label="Send"]')?.disabled === false`);
        await page.click("button", "Send");
        await page.see("echo: PROJECT-ONCE");
        await page.click("button", "Session information and actions");
        await page.until(`!!document.querySelector('[role="menu"]')`);
        const actions = await page.evaluate(
          `[...document.querySelectorAll('[role="menu"] [role^="menuitem"]')].map(e => e.getAttribute('aria-label') ?? e.textContent.trim())`,
        );
        assert.ok(actions.includes("Move to project"), JSON.stringify(actions));
        for (const label of ["Rename", "Pin", "Share session", "Archive", "Delete"])
          assert.ok(actions.includes(label), `remote session menu offers ${label}`);
        await page.capture("9h-remote-session-menu");
        await page.click("menuitem", "Rename");
        await page.ab("fill", '[aria-label="Session name"]', "Renamed on peer");
        await page.click("button", "Rename");
        await page.see("Session renamed");
        await page.until(`document.querySelector('main h1')?.textContent === 'Renamed on peer'`);
        await page.until(`!document.querySelector('[role="dialog"]')`);
        await page.click("button", "Project: Peer project");
        await page.until(`location.pathname === '/m/eng-1/projects/${projectId}'`);
        await page.see("Renamed on peer");
        await page.capture("9i-remote-project-session");
        const joined = frames.filter(
          ({ direction, message }) =>
            direction === "sent" &&
            message._tag === "create_session" &&
            message.projectId === projectId,
        );
        assert.equal(joined.length, 1, "one session started in the peer's project");
        assert.ok(
          frames.some(
            ({ direction, message }) =>
              direction === "received" &&
              message._tag === "registry" &&
              message.projects?.some((p) => p.id === projectId && p.name === "Peer project") &&
              message.sessionReferences?.filter((s) => s.projectId === projectId).length === 1,
          ),
          "the peer lists the project with its one session",
        );
        assert.deepEqual(page.prompts(), [], "local Pi receives no project session");
        onRemote = false;
        await machine(page, "Local");
        await page.click("button", "Projects");
        await page.see("No projects yet");
        await page.capture("9j-local-has-no-peer-project");
        mkdirSync(join(cwd, ".agents", "skills", "demo"), { recursive: true });
        writeFileSync(
          join(cwd, ".agents", "skills", "demo", "SKILL.md"),
          "---\nname: demo\ndescription: Demo.\n---\n",
        );
        const trust = '[aria-label="Directory trust"]';
        const pressed = (value) =>
          page.until(
            `document.querySelector('${trust}')?.getAttribute('aria-pressed') === '${value}' && !document.querySelector('${trust}').disabled`,
          );
        const chooseRepo = async () => {
          await page.ab("click", '[aria-label="Directory"]');
          await page.until(`!!document.querySelector('[aria-label="Choose a directory"]')`);
          await page.ab("find", "role", "option", "click", "--name", "repo");
          await page.until(`!document.querySelector('[aria-label="Choose a directory"]')`);
        };
        onRemote = true;
        await machine(page, "eng-1");
        await page.click("button", "New session");
        await page.until(`location.pathname === '/m/eng-1/new'`);
        await chooseRepo();
        await pressed(false);
        await page.ab("click", trust);
        await pressed(true);
        await page.capture("9k-remote-folder-trusted");
        const decisions = frames.filter(
          ({ direction, message }) => direction === "sent" && message._tag === "set_trust",
        );
        assert.deepEqual(
          decisions.map(({ message }) => [message.path, message.trusted]),
          [[cwd, true]],
          "one trust decision, sent to the peer",
        );
        onRemote = false;
        await machine(page, "Local");
        await page.click("button", "New session");
        await chooseRepo();
        await pressed(false);
        await page.capture("9l-local-folder-still-untrusted");
        await page.evaluate(
          `(localStorage.setItem('piano.machine.gone.catalogs', '{}'), localStorage.setItem('piano.catalogs', '{}'), localStorage.setItem('piano.machine.eng-1.location', '/projects'), true)`,
        );
        await page.ab("reload");
        await page.until(
          `!!document.querySelector('[aria-label="First message"]') && localStorage.getItem('piano.machine.gone.catalogs') === null`,
        );
        const remembered = await page.evaluate(
          `Object.keys(localStorage).filter(k => k.startsWith('piano.machine.') || k === 'piano.catalogs' || k === 'piano.lastDir')`,
        );
        for (const key of [
          "piano.machine.local.catalogs",
          "piano.machine.eng-1.catalogs",
          "piano.machine.eng-1.lastDir",
        ])
          assert.ok(remembered.includes(key), `${key} in ${remembered}`);
        for (const key of [
          "piano.machine.gone.catalogs",
          "piano.catalogs",
          "piano.lastDir",
          "piano.machine.eng-1.location",
        ])
          assert.ok(!remembered.includes(key), `${key} forgotten`);
        assert.equal(
          await page.evaluate(`localStorage.getItem('piano.machine.eng-1.lastDir')`),
          cwd,
          "the peer's last directory is the one a session started in there",
        );
        assert.ok(
          Object.keys(
            JSON.parse(await page.evaluate(`localStorage.getItem('piano.machine.eng-1.catalogs')`)),
          ).includes(cwd),
          "the peer's model list for that directory outlives the reload",
        );
        onRemote = true;
        await machine(page, "eng-1");
        await page.see("Remote collision session");
        await page.ab("find", "role", "button", "click", "--name", "Remote collision session");
        await page.until(`location.pathname === '/m/eng-1/s/${sessionId}'`);
        onRemote = false;
        await machine(page, "Local");
        await page.ab("reload");
        await page.see("Local collision session");
        onRemote = true;
        await machine(page, "eng-1");
        await page.until(`location.pathname === '/m/eng-1/s/${sessionId}'`);
        await page.see("Remote collision session saved history");
        assert.deepEqual(
          await page.evaluate(
            `[sessionStorage.getItem('piano.machine.eng-1.location'), localStorage.getItem('piano.machine.eng-1.location')]`,
          ),
          [`/s/${sessionId}`, null],
          "the place is kept with the tab, not for every tab",
        );
        await page.capture("9m-remote-reopened-where-left");
        await page.click("button", "New session");
        await page.until(`location.pathname === '/m/eng-1/new'`);
        await page.ab("fill", '[aria-label="First message"]', "CLOSED-FOLDER");
        await page.until(
          `document.querySelector('[aria-label="Directory"]')?.textContent.includes('repo') && document.querySelector('[aria-label="Send"]')?.disabled === false`,
        );
        const owner = new WebSocket(`${page.remote.endpoint.replace("http", "ws")}/ws`, {
          headers: { Origin: page.remote.origin },
        });
        await once(owner, "open");
        owner.send(JSON.stringify({ _tag: "remove_folder", path: cwd }));
        await page.see(
          "Folder closed. Reopen it in this machine's Piano or choose another directory.",
        );
        owner.close();
        assert.deepEqual(
          await page.evaluate(
            `[location.pathname, document.querySelector('[aria-label="Directory"]')?.textContent.includes('repo'), document.querySelector('[aria-label="Send"]')?.disabled]`,
          ),
          ["/m/eng-1/new", true, true],
          "the New page keeps the closed folder, cannot send there and says why",
        );
        await page.capture("9n-remote-folder-closed");
        await page.open("/m/not-configured/s/same-session");
        await page.see("Machine unavailable");
        assert.equal(
          await page.evaluate(`!!document.querySelector('[aria-label="Message"]')`),
          false,
        );
        assert.deepEqual(localRequestsFromRemote, [], "an unknown machine cannot mount Local");
        await page.capture("10-unknown-machine");
        await page.ab("set", "viewport", "1280", "800");
        const collapsedPreference = `localStorage.getItem('piano.sidebar')`;
        const preferenceBefore = await page.evaluate(collapsedPreference);
        await page.press("Meta+b");
        await page.click("button", "Local");
        await page.until(`!document.body.innerText.includes('Machine unavailable')`);
        assert.equal(
          await page.evaluate(collapsedPreference),
          preferenceBefore,
          "Cmd+B without a machine keeps the desktop sidebar preference",
        );
        await page.press("Meta+b");
        await page.until(`${collapsedPreference} !== ${JSON.stringify(preferenceBefore)}`);
        await page.ab("set", "viewport", "700", "850");
        const narrowOpen = `document.querySelector('[data-slot="mobile-sidebar"]')?.getAttribute('data-state') === 'open'`;
        await page.click("button", "Show sidebar");
        await page.until(narrowOpen);
        await page.ab("back");
        await page.see("Machine unavailable");
        await page.until(`!(${narrowOpen})`);
        await page.press("Meta+b");
        await page.ab("forward");
        await page.until(`!document.body.innerText.includes('Machine unavailable')`);
        await page.until(`!!document.querySelector('[aria-label="Show sidebar"]')`);
        assert.equal(
          await page.evaluate(narrowOpen),
          false,
          "the sidebar stays closed after leaving an unavailable machine",
        );
        await page.capture("10b-after-unknown-machine");
        await page.open("/new");
        await page.until(`!!document.querySelector('[aria-label="First message"]')`);
        await page.click("button", "Show sidebar");
        await page.until(narrowOpen);
        await page.until(
          `document.querySelector('[data-slot="mobile-sidebar"]').getAnimations({subtree:true}).every(a => a.playState !== 'running')`,
        );
        await machine(page, "eng-2");
        await page.until(`location.pathname.startsWith('/m/eng-2/')`);
        await page.evaluate(`(() => {
          window.focusOutsideSidebar = [];
          document.addEventListener('focusin', (e) => {
            if (!document.querySelector('[data-slot="mobile-sidebar"]')?.contains(e.target))
              window.focusOutsideSidebar.push(e.target.getAttribute('aria-label') ?? e.target.localName);
          });
        })()`);
        await page.ab("back");
        await page.until(`!!document.querySelector('[aria-label="First message"]')`);
        await page.until(
          `document.querySelector('[data-slot="mobile-sidebar"]')?.contains(document.activeElement)`,
        );
        assert.equal(await page.evaluate(narrowOpen), true, "Back to Local keeps the sidebar open");
        assert.deepEqual(
          await page.evaluate(`window.focusOutsideSidebar`),
          [],
          "the New page composer does not take focus under the open sidebar",
        );
        const result = {
          generation,
          pid,
          peerPrompts: page.remote.prompts(),
          secondPeerPrompts: page.peers["eng-2"].prompts(),
          localPrompts: page.prompts(),
          disconnectedLine,
          remoteStarts: starts().length,
          secondRemoteStarts: secondStarts.length,
          secondPid: secondStarts[0].pid,
          localRequestsFromRemote,
          createdId,
        };
        writeFileSync(join(page.evidence, "remote-result.json"), JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result));
      });
    } finally {
      writeFileSync(
        join(page.evidence, "remote-websocket.jsonl"),
        frames.map((frame) => JSON.stringify(frame)).join("\n") + "\n",
      );
      writeFileSync(
        join(page.evidence, "remote-connections.json"),
        JSON.stringify([...sockets], null, 2),
      );
    }
  },
  {
    backendEnv: { RADIUS_API_KEY: "" },
    peers: fixture.peers.map((peer) => ({ ...peer, backendEnv: { RADIUS_API_KEY: "" } })),
  },
);
