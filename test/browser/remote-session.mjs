// Critical path: continue a peer's session without crossing machine identities or owning its run.
// INV-01, INV-02, INV-05, INV-07: identical cwd/workspace/session IDs on independent backends.
// node test/browser/remote-session.mjs [evidence-directory]
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { run } from "./harness.mjs";

const sessionId = "same-session";
const workspaceId = "same-workspace";
const echo = "REMOTE-ECHO-ONCE";
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
      : [
          [sessionId, "Remote collision session"],
          ["remote-only", "Remote host-only session"],
        ];
  const now = new Date().toISOString();
  return {
    folders: [cwd],
    workspaces: [{ id: workspaceId, path: cwd, folder: cwd }],
    sessions: titles.map(([id, title]) => {
      history({
        sessionId: id,
        cwd,
        messages: [{ role: "user", content: `${title} saved history`, timestamp: Date.now() }],
      });
      return { sessionId: id, cwd, title, createdAt: now, updatedAt: now };
    }),
  };
};

// Audit/CDP events have their own clock, independent of a browser rendering an acknowledgement.
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
const machine = async (page, name) => {
  // The Machine control can be a dropdown button or combobox; both use real pointer clicks.
  await page.ab("click", '[aria-label="Machine"]');
  await page.until(
    `[...document.querySelectorAll('[role="menu"], [role="listbox"]')].some(e => e.getAnimations({subtree:true}).every(a => a.playState !== 'running'))`,
  );
  const role = await page.evaluate(`(() => {
    const option = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]')]
      .find(e => (e.getAttribute('aria-label') ?? e.textContent.trim()) === ${JSON.stringify(name)});
    return option?.getAttribute('role');
  })()`);
  assert.ok(role, `Machine picker offers ${name}`);
  await page.click(role, name);
  await page.until(`!document.querySelector('[role="menu"], [role="listbox"]')`);
};
const catalog = async (page, own, other, restore) => {
  await page.ab("fill", composer, "/");
  await page.see(`/${own}-only`);
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
  for (const label of [
    "New session",
    "Add folder",
    "Settings",
    "Files",
    "Search files",
    "Changes",
    "Preview",
    "Open preview in new tab",
  ])
    assert.ok(!controls.includes(label), `remote does not offer unsupported ${label}`);
};

await run(
  "remote-session",
  (fixture) => {
    cwd = fixture.repository("repo");
    return seed("local", fixture);
  },
  async (page) => {
    await page.open("/");
    await page.see("Local collision session");
    await page.click("button", "Local collision session");
    await page.see("Local collision session saved history");
    await ready(page);
    await catalog(page, "local", "remote", "LOCAL-DRAFT");
    await page.capture("1-local-draft");

    const frames = [];
    const sockets = new Map();
    try {
      await page.cdp(async (call, onEvent) => {
        onEvent(({ method, params }) => {
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
            } catch {
              /* Ignore non-JSON transport frames. */
            }
          }
        });
        await call("Network.enable");
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

        await machine(page, "eng-1");
        await page.until(`location.pathname === '/m/eng-1/new'`);
        await page.see("Remote host-only session");
        assert.equal(
          await page.evaluate(`!!document.querySelector('[aria-label="First message"]')`),
          false,
          "remote starts at pick-existing, never a local creation form",
        );
        assert.equal(
          await page.evaluate(`document.body.innerText.includes('Local-only session')`),
          false,
        );
        await unsupported(page);
        await page.capture("2-remote-pick-existing");
        await page.click("button", "Remote collision session");
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
        await send(page, echo);
        await page.see(`echo: ${echo}`);
        assert.deepEqual(page.remote.prompts(), [echo], "peer receives one prompt");
        assert.deepEqual(page.prompts(), [], "local Pi receives no remote prompt");
        await catalog(page, "remote", "local", "REMOTE-DRAFT");
        await page.capture("3-remote-reply-draft");

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

        await machine(page, "eng-1");
        await page.see("Remote collision session");
        await page.click("button", "Remote collision session");
        await page.see(`echo: ${echo}`);
        await ready(page);
        assert.equal(await draft(page), "REMOTE-DRAFT", "remote draft survived local selection");
        await catalog(page, "remote", "local", "REMOTE-DRAFT");
        await page.click("button", "Context usage");
        await page.until(`!!document.querySelector('[aria-label="Context usage details"]')`);
        await page.capture("5-remote-context");
        await page.press("Escape");

        // The remote host also owns pending questions, not the newly selected local runtime.
        await send(page, "question");
        await page.see("Which checks?");
        await machine(page, "Local");
        await page.see("Local collision session");
        await page.click("button", "Local collision session");
        await page.see("Local collision session saved history");
        assert.equal(
          await page.evaluate(`document.body.innerText.includes('Which checks?')`),
          false,
        );
        await machine(page, "eng-1");
        await page.see("Remote collision session");
        await page.click("button", "Remote collision session");
        await page.see("Which checks?");
        await page.click("radio", "Quick checks");
        await page.click("button", "Send answer");
        await page.see("Answer: Quick checks");
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
        await waitFor("remote host has a generation", () => selected().length > 0);
        assert.equal(starts().length, 1, "switching machines reused the sole peer Pi process");
        const pid = starts()[0].pid;
        assert.ok(Number.isInteger(pid), "audit identifies the remote Pi PID");
        const generation = selected().at(-1).message.cursor.generation;
        const connection = received().at(-1).requestId;
        const beforeReconnect = selected().length;
        const tick = () =>
          page.remote
            .received()
            .filter((entry) => entry.command === "stream")
            .at(-1);
        const network = { latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
        let disconnectedLine;
        try {
          await call("Network.emulateNetworkConditions", { ...network, offline: true });
          await waitFor("browser socket actually closed", () => sockets.get(connection)?.closed);
          disconnectedLine = tick().line;
          await waitFor(
            "same remote Pi continues emitting with browser disconnected",
            () => tick().line > disconnectedLine + 2 && tick().pid === pid,
          );
          process.kill(pid, 0);
          assert.equal(starts().length, 1);
          await page.capture("6-disconnected-host-still-streaming");
        } finally {
          await call("Network.emulateNetworkConditions", { ...network, offline: false });
        }
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
        await page.click("button", "Stop");
        await page.until(`document.querySelector('[aria-label="Send"]') !== null`);
        await waitFor("Stop reaches only remote Pi", () =>
          page.remote
            .received()
            .some((entry) => entry.command === "abort" && entry.sessionId === sessionId),
        );
        assert.equal(page.remote.received().filter((entry) => entry.command === "abort").length, 1);
        assert.equal(page.received().filter((entry) => entry.command === "abort").length, 0);
        assert.deepEqual(
          page.remote.prompts(),
          [echo, "question", "stream"],
          "each input reaches the peer once, never resent",
        );
        assert.deepEqual(page.prompts(), [], "no local prompt from remote UI");
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
          "remote UI never creates a session",
        );
        await unsupported(page);
        await page.capture("9-remote-stopped");
        const result = {
          generation,
          pid,
          peerPrompts: page.remote.prompts(),
          localPrompts: page.prompts(),
          disconnectedLine,
          remoteStarts: starts().length,
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
  { remote: { id: "eng-1", setup: (fixture) => seed("remote", fixture) } },
);
