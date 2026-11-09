import assert from "node:assert/strict";
import { test } from "node:test";
import { gatewayFixture, identity } from "./fixtures/peer-gateway.ts";
import { readRegistry } from "./fixtures/registry.ts";

// Two separate network peers, intentionally identical workspace/session/generation identities.
// Their credentials, Origin, catalogs and prompts must remain owned by the requested machine.
test(
  "concurrent peers keep HTTP, WS, credentials and failures isolated despite identical session IDs",
  { timeout: 30_000 },
  async (t) => {
    const f = await gatewayFixture(t, {
      peers: [
        { id: "eng-1", vmToken: "exe1.first-dummy-token", commandName: "first-only" },
        { id: "eng-2", vmToken: "exe1.second-dummy-token", commandName: "second-only" },
      ],
    });
    const [first, second] = f.peers;
    const original = await readRegistry("unused", f.database);
    assert.deepEqual(await (await fetch(f.base + "/api/machines")).json(), {
      machines: [
        { id: "local", name: "Local" },
        { id: "eng-1", name: "eng-1" },
        { id: "eng-2", name: "eng-2" },
      ],
    });
    const [a, b] = await Promise.all([f.open({}, true, "eng-1"), f.open({}, true, "eng-2")]);
    const select = {
      _tag: "select",
      selectionId: "same-selection",
      cwd: identity.cwd,
      sessionId: identity.sessionId,
    };
    a.send(select);
    b.send(select);
    await f.until(() =>
      [a, b].every((connection) =>
        connection.messages.some((raw) => JSON.parse(raw)._tag === "selected"),
      ),
    );
    const prompt = (text: string) => ({
      _tag: "act",
      selectionId: "same-selection",
      action: { _tag: "prompt", text },
    });
    a.send(prompt("first input"));
    b.send(prompt("second input"));
    await f.until(() =>
      [a, b].every((connection) =>
        connection.messages.some((raw) => JSON.parse(raw)._tag === "action_result"),
      ),
    );
    const path = (id: string) =>
      `${f.base}/peer/${id}/api/session/commands?workspaceId=${identity.workspaceId}&sessionId=${identity.sessionId}`;
    const [one, two] = await Promise.all([fetch(path("eng-1")), fetch(path("eng-2"))]);
    assert.equal(one.status, 200);
    assert.equal(two.status, 200);
    assert.deepEqual(await one.json(), { commands: [{ name: "first-only", source: "extension" }] });
    assert.deepEqual(await two.json(), {
      commands: [{ name: "second-only", source: "extension" }],
    });
    const inputs = (peer: typeof first) =>
      peer.state.received
        .map((raw) => JSON.parse(raw))
        .filter((m) => m._tag === "act")
        .map((m) => m.action.text);
    assert.deepEqual(inputs(first), ["first input"]);
    assert.deepEqual(inputs(second), ["second input"]);
    for (const peer of f.peers) {
      assert.ok(peer.state.requests.some((req) => req.url === "/ws"));
      assert.ok(peer.state.requests.some((req) => req.url.startsWith("/api/")));
      for (const req of peer.state.requests) {
        assert.equal(req.headers["x-exedev-authorization"], `Bearer ${peer.state.requiredToken}`);
        assert.equal(req.headers.origin, peer.config.origin);
      }
    }

    // A pending read keeps its own response/credentials even while another peer is used.
    first.state.mode = "http-held";
    const pendingRead = fetch(path("eng-1"));
    await first.until(() => first.state.pendingHttp.length === 1);
    const healthyRead = await fetch(path("eng-2"));
    assert.equal(healthyRead.status, 200);
    assert.deepEqual(await healthyRead.json(), {
      commands: [{ name: "second-only", source: "extension" }],
    });
    first.state.pendingHttp.pop()!();
    const lateRead = await pendingRead;
    assert.equal(lateRead.status, 200);
    assert.deepEqual(await lateRead.json(), {
      commands: [{ name: "first-only", source: "extension" }],
    });
    first.state.requiredToken = "revoked";
    const firstRequests = first.state.requests.length;
    assert.equal(await f.handshake("/peer/eng-1/ws"), 502);
    assert.equal(
      first.state.requests.length,
      firstRequests + 1,
      "failed auth never tries another identity",
    );
    b.send({ _tag: "ping", nonce: "second-still-connected" });
    await f.until(() =>
      b.messages.some((raw) => JSON.parse(raw).nonce === "second-still-connected"),
    );
    assert.equal(
      a.messages.some((raw) => JSON.parse(raw).nonce === "second-still-connected"),
      false,
    );
    const requests = f.peers.map((peer) => peer.state.requests.length);
    assert.equal(await f.handshake("/peer/unknown/ws"), 404);
    assert.deepEqual(
      f.peers.map((peer) => peer.state.requests.length),
      requests,
    );
    assert.deepEqual(inputs(first), ["first input"]);
    assert.deepEqual(inputs(second), ["second input"], "no retry/fallback of first's input");
    assert.deepEqual(
      await readRegistry("unused", f.database),
      original,
      "no remote operation reaches Local",
    );
    a.ws.close();
    b.ws.close();
    await Promise.all([a.closed, b.closed]);
  },
);
