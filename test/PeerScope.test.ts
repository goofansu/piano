/**
 * ADR 0004: a Piano serving another machine's gateway at /ws/peer decides that connection's
 * scope itself and answers refusals with ordinary replies, without ending the connection.
 * Driven against a real backend (fake Pi) whose registry lists one session.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { WebSocket } from "@effect/platform-node/NodeWS";
import { gatewayFixture, identity } from "./fixtures/peer-gateway.ts";

type Frame = { _tag: string; [key: string]: unknown };

async function attach(base: string, path: "/ws" | "/ws/peer") {
  const ws = new WebSocket(`${base.replace("http", "ws")}${path}`, { headers: { Origin: base } });
  const frames: Frame[] = [];
  const events = new EventTarget();
  ws.on("message", (raw) => {
    const frame = JSON.parse(String(raw));
    frames.push(frame);
    ws.send(JSON.stringify({ _tag: "ack", deliveryId: frame.deliveryId }));
    events.dispatchEvent(new Event("frame"));
  });
  await once(ws, "open");
  let nonce = 0;
  const next = (test: (frame: Frame) => boolean, from = 0) =>
    new Promise<Frame>((resolve, reject) => {
      const found = () => frames.slice(from).find(test);
      const check = () => {
        const frame = found();
        if (!frame) return;
        clearTimeout(timer);
        events.removeEventListener("frame", check);
        resolve(frame);
      };
      const timer = setTimeout(() => {
        events.removeEventListener("frame", check);
        reject(new Error(`no matching frame; saw ${frames.map((f) => f._tag).join(",")}`));
      }, 10_000);
      events.addEventListener("frame", check);
      check();
    });
  /** Frames the server sent in answer to `message`, up to a ping that follows it. */
  const answers = async (message: object) => {
    const from = frames.length;
    const marker = `after-${++nonce}`;
    ws.send(JSON.stringify(message));
    ws.send(JSON.stringify({ _tag: "ping", nonce: marker }));
    await next((frame) => frame._tag === "pong" && frame.nonce === marker, from);
    return frames
      .slice(from)
      .filter(
        (frame) => !["pong", "hosts", "registry", "catalogs_invalidated"].includes(frame._tag),
      );
  };
  await next((frame) => frame._tag === "registry");
  return { ws, frames, next, answers };
}

test(
  "ADR 0004: /ws/peer admits only the remote slice and answers refusals in sequence",
  {
    timeout: 60_000,
  },
  async (t) => {
    const f = await gatewayFixture(t);
    const peer = await attach(f.base, "/ws/peer");
    const local = await attach(f.base, "/ws");
    t.after(() => {
      peer.ws.terminate();
      local.ws.terminate();
    });
    const notAvailable = /not available from another machine/i;

    await t.test("a session the registry does not list is rejected, not opened", async () => {
      for (const select of [
        { _tag: "select", selectionId: "unlisted", cwd: identity.cwd, sessionId: "terminal-only" },
        {
          _tag: "select",
          selectionId: "elsewhere",
          cwd: "/different",
          sessionId: identity.sessionId,
        },
      ]) {
        const [answer, ...rest] = await peer.answers(select);
        assert.equal(answer?._tag, "selection_rejected", JSON.stringify(select));
        assert.equal(answer?.selectionId, select.selectionId);
        assert.match(String(answer?.message), notAvailable);
        assert.deepEqual(rest, []);
      }
    });

    await t.test(
      "creation, settings and unselected actions are refused with their replies",
      async () => {
        const [created] = await peer.answers({
          _tag: "create_session",
          selectionId: "create",
          cwd: identity.cwd,
          options: {},
        });
        assert.equal(created?._tag, "selection_rejected");
        assert.match(String(created?.message), notAvailable);

        const [trust] = await peer.answers({
          _tag: "set_trust",
          path: identity.cwd,
          trusted: true,
        });
        assert.equal(trust?._tag, "trust_failed");
        assert.equal(trust?.cwd, identity.cwd);
        assert.match(String(trust?.message), notAvailable);

        const [act] = await peer.answers({
          _tag: "act",
          selectionId: "never-selected",
          action: { _tag: "prompt", text: "must not run", inputId: "input-1" },
        });
        assert.equal(act?._tag, "error");
        assert.equal(act?.inputId, "input-1", "the browser learns the input was never delivered");
        assert.match(String(act?.message), notAvailable);
      },
    );

    await t.test("the same requests reach their work on this machine's own /ws", async () => {
      let from = local.frames.length;
      local.ws.send(JSON.stringify({ _tag: "set_trust", path: identity.cwd, trusted: true }));
      const trust = await local.next(
        (frame) =>
          (frame._tag === "trust" || frame._tag === "trust_failed") && frame.cwd === identity.cwd,
        from,
      );
      assert.doesNotMatch(String(trust.message ?? ""), notAvailable);
      from = local.frames.length;
      local.ws.send(
        JSON.stringify({
          _tag: "select",
          selectionId: "local-unlisted",
          cwd: "/different",
          sessionId: identity.sessionId,
        }),
      );
      const selection = await local.next(
        (frame) =>
          String(frame._tag).startsWith("selection") && frame.selectionId === "local-unlisted",
        from,
      );
      assert.doesNotMatch(String(selection.message ?? ""), notAvailable);
    });

    await t.test("reads about a folder no longer registered are skipped quietly", async () => {
      const from = peer.frames.length;
      peer.ws.send(JSON.stringify({ _tag: "models", cwd: "/different" }));
      peer.ws.send(JSON.stringify({ _tag: "trust", cwd: "/different" }));
      peer.ws.send(JSON.stringify({ _tag: "trust", cwd: identity.cwd }));
      // Requests run in arrival order of admission; the registered read's answer shows the others had their turn.
      await peer.next((frame) => frame._tag === "trust" && frame.cwd === identity.cwd, from);
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.deepEqual(
        peer.frames
          .slice(from)
          .filter((frame) => frame.cwd === "/different" || frame._tag === "error"),
        [],
      );
    });

    await t.test("refusals never end the connection", () => {
      assert.equal(peer.ws.readyState, WebSocket.OPEN);
    });
  },
);
