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
    const f = await gatewayFixture(t, { checkout: true });
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
      "creation that would add more than a text session in a registered directory is refused",
      async () => {
        const base = { _tag: "create_session", cwd: f.checkout, options: {}, text: "hi" };
        const image = { kind: "image", name: "a.png", mimeType: "image/png", data: "iVBORw0KGgo=" };
        for (const [selectionId, create] of Object.entries({
          unregistered: { ...base, cwd: "/different" },
          worktree: { ...base, worktree: { branch: "feature" } },
          project: { ...base, projectId: "some-project" },
          inherited: { ...base, inheritProject: true },
          named: { ...base, options: { name: "Named" } },
          dispatched: { ...base, options: { dispatchedFrom: identity.sessionId } },
          attached: { ...base, attachments: [image] },
        })) {
          const [answer, ...rest] = await peer.answers({ ...create, selectionId });
          assert.equal(answer?._tag, "selection_rejected", selectionId);
          assert.equal(answer?.selectionId, selectionId);
          assert.match(String(answer?.message), notAvailable, selectionId);
          assert.deepEqual(rest, [], selectionId);
        }
      },
    );

    await t.test("settings and unselected actions are refused with their replies", async () => {
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
    });

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

    await t.test("a requested read about an unregistered folder is answered", async () => {
      const from = peer.frames.length;
      peer.ws.send(
        JSON.stringify({ _tag: "models", cwd: "/different", refresh: true, requestId: "r1" }),
      );
      const failed = await peer.next(
        (frame) => frame._tag === "models_failed" && frame.requestId === "r1",
        from,
      );
      assert.equal(failed.cwd, "/different");
      assert.match(String(failed.message), notAvailable);
    });

    await t.test("the peer folder-commands read answers only for registered folders", async () => {
      const read = (path: string, cwd: string) =>
        fetch(`${f.base}${path}`, {
          method: "POST",
          headers: { Origin: f.base, "content-type": "application/json" },
          body: JSON.stringify({ cwd }),
        });
      const notRegistered = /not a registered folder/i;
      // The fixture's registered folder is not on disk: reaching discovery shows as its own error.
      const listed = await read("/api/peer/commands", identity.cwd);
      assert.doesNotMatch((await listed.json()).error ?? "", notRegistered);
      const unlisted = await read("/api/peer/commands", "/different");
      assert.equal(unlisted.status, 409);
      assert.match((await unlisted.json()).error, notRegistered);
      // This machine's own browser read is not limited to registered folders.
      const own = await read("/api/commands", "/different");
      assert.doesNotMatch((await own.json()).error ?? "", notRegistered);
    });

    // Last but one: the started session keeps streaming frames the subtests above would read.
    await t.test(
      "a text session starts in a registered folder, and its selection takes actions",
      async () => {
        const from = peer.frames.length;
        peer.ws.send(
          JSON.stringify({
            _tag: "create_session",
            selectionId: "created",
            cwd: f.checkout,
            options: {},
            text: "Reply with exactly: X",
          }),
        );
        const selected = await peer.next(
          (frame) =>
            (frame._tag === "selected" || frame._tag === "selection_rejected") &&
            frame.selectionId === "created",
          from,
        );
        assert.equal(selected._tag, "selected", JSON.stringify(selected));
        assert.equal(selected.cwd, f.checkout);
        const sessionId = String(selected.sessionId);
        // The remote registers the session it started, so the main Piano lists it.
        await peer.next(
          (frame) =>
            frame._tag === "registry" &&
            (frame.sessionReferences as { sessionId: string }[]).some(
              (entry) => entry.sessionId === sessionId,
            ),
          from,
        );
        const answers = await peer.answers({
          _tag: "act",
          selectionId: "created",
          action: { _tag: "stop" },
        });
        assert.deepEqual(
          answers.filter((frame) => notAvailable.test(String(frame.message ?? ""))),
          [],
          "the created selection is not refused",
        );
      },
    );

    // After the creation above: closing its folder here is what this subtest needs.
    await t.test("a folder closed here cannot be reopened by a peer's new session", async () => {
      const folderPaths = (frame: Frame) =>
        (frame.folders as { path: string }[]).map((folder) => folder.path);
      const closing = local.frames.length;
      local.ws.send(JSON.stringify({ _tag: "remove_folder", path: f.checkout }));
      await local.next(
        (frame) => frame._tag === "registry" && !folderPaths(frame).includes(f.checkout),
        closing,
      );

      const from = peer.frames.length;
      peer.ws.send(
        JSON.stringify({
          _tag: "create_session",
          selectionId: "closed",
          cwd: f.checkout,
          options: {},
          text: "Reply with exactly: X",
        }),
      );
      const answer = await peer.next(
        (frame) =>
          (frame._tag === "selected" || frame._tag === "selection_rejected") &&
          frame.selectionId === "closed",
        from,
      );
      assert.equal(answer._tag, "selection_rejected", JSON.stringify(answer));
      assert.match(String(answer.message), notAvailable);
      // The models read for an existing session in the closed folder is still answered.
      const [models] = await peer.answers({
        _tag: "models",
        cwd: f.checkout,
        requestId: "closed-models",
      });
      assert.notEqual(models?._tag, "models_failed", JSON.stringify(models));
      const latest = local.frames.findLast((frame) => frame._tag === "registry");
      assert.ok(latest && !folderPaths(latest).includes(f.checkout), "the folder stays closed");
    });

    await t.test("refusals never end the connection", () => {
      assert.equal(peer.ws.readyState, WebSocket.OPEN);
    });
  },
);
