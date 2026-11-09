import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadPeerConfigs } from "../server/PeerConfig.ts";
import { PEER_FRAME_BYTES } from "../shared/machine.ts";
import { gatewayFixture, identity, registry } from "./fixtures/peer-gateway.ts";
import { readRegistry } from "./fixtures/registry.ts";

// These new policy/transport boundaries have no protection in local ClientDispatch tests.
test("peer startup configuration is explicit, bounded and fail-closed", (t) => {
  const root = mkdtempSync(join(tmpdir(), "piano-peer-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "peer.json");
  const valid = {
    id: "eng-1",
    name: "Engineering",
    endpoint: "https://peer.example",
    origin: "https://origin.example:3000",
  };
  const write = (value: unknown) => writeFileSync(file, JSON.stringify(value));
  assert.deepEqual(loadPeerConfigs(undefined), []);
  write(valid);
  assert.deepEqual(loadPeerConfigs(file), [valid]);
  assert.throws(() => loadPeerConfigs("relative.json"), /PIANO_PEER_CONFIG/);
  for (const invalid of [
    { id: "local" },
    { id: "../other" },
    { id: "" },
    { id: "eng_1" },
    { id: "eng--1" },
    { name: " " },
    { endpoint: "https://user:secret@peer.example" },
    { endpoint: "http://peer.example" },
    { endpoint: "https://peer.example/" },
    { endpoint: "https://peer.example/path" },
    { endpoint: "https://peer.example?q=1" },
    { endpoint: "https://peer.example#fragment" },
    { origin: undefined },
    { origin: "https://origin.example/" },
    { origin: "https://user@origin.example" },
    { origin: "https://*.example" },
    { extra: "unknown" },
  ]) {
    write({ ...valid, ...invalid });
    assert.throws(() => loadPeerConfigs(file), /PIANO_PEER_CONFIG/);
  }
  write({ ...valid, endpoint: "http://127.0.0.1:1234" });
  assert.throws(() => loadPeerConfigs(file), /PIANO_PEER_CONFIG/);
  assert.equal(
    loadPeerConfigs(file, { allowHttpLoopbackForTests: true })[0]?.endpoint,
    "http://127.0.0.1:1234",
  );
  write({ ...valid, endpoint: "http://192.168.1.2:1234" });
  assert.throws(
    () => loadPeerConfigs(file, { allowHttpLoopbackForTests: true }),
    /PIANO_PEER_CONFIG/,
  );
  writeFileSync(file, "not json");
  assert.throws(() => loadPeerConfigs(file), /PIANO_PEER_CONFIG/);
  writeFileSync(file, " ".repeat(16 * 1024 + 1));
  assert.throws(() => loadPeerConfigs(file), /PIANO_PEER_CONFIG/);
});

test("peer lists retain configured order and reject ambiguous or partially invalid configurations", (t) => {
  const root = mkdtempSync(join(tmpdir(), "piano-peer-list-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "peers.json");
  const first = {
    id: "eng-1",
    name: "eng-1",
    endpoint: "https://one.example",
    origin: "https://one.example",
  };
  const second = {
    id: "eng-2",
    name: "eng-2",
    endpoint: "https://two.example",
    origin: "https://two.example",
  };
  const write = (value: unknown) => writeFileSync(file, JSON.stringify(value));
  write({ peers: [second, first] });
  assert.deepEqual(loadPeerConfigs(file), [second, first]);
  write({ peers: [] });
  assert.deepEqual(loadPeerConfigs(file), [], "an empty list is Local only");
  for (const value of [
    { peers: [first, first] },
    { peers: [first, { ...second, id: first.id }] },
    { peers: [first, { ...second, name: "ENG-1" }] },
    { peers: [{ ...first, name: "Local" }] },
    { peers: [first, { ...second, id: "local" }] },
    { peers: [first, { ...second, endpoint: "http://two.example" }] },
    { peers: [first, { ...second, vmTokenFile: "/missing/private-token" }] },
    { peers: [first], ...second },
    { peers: [first], extra: true },
    { peers: null },
    [first, second],
  ]) {
    write(value);
    assert.throws(() => loadPeerConfigs(file), /PIANO_PEER_CONFIG/);
  }
  const maximum = Array.from({ length: 32 }, (_, index) => ({
    ...first,
    id: `vm-${index}`,
    name: `VM ${index}`,
  }));
  write({ peers: maximum });
  assert.equal(loadPeerConfigs(file).length, 32);
  write({ peers: [...maximum, { ...second, id: "overflow", name: "Overflow" }] });
  assert.throws(() => loadPeerConfigs(file), /PIANO_PEER_CONFIG/);
});

test(
  "INV-01/02/04/05/07/11/12: same-origin peer gateway over real HTTP and WS",
  { timeout: 90_000 },
  async (t) => {
    const f = await gatewayFixture(t);
    const headers = {
      Cookie: "browser-cookie=secret",
      Authorization: "Bearer browser-secret",
      "X-Exedev-Authorization": "Bearer browser-exe-secret",
      Forwarded: "host=browser.example",
      "X-Forwarded-Host": "browser.example",
      "X-Forwarded-Proto": "https",
    };
    const commandPath = `/peer/eng-1/api/session/commands?workspaceId=${identity.workspaceId}&sessionId=${identity.sessionId}`;
    const original = await readRegistry("unused", f.database);

    await t.test(
      "machines never disclose endpoints; unsupported paths and Host/Origin fail before dialing",
      async () => {
        assert.deepEqual(await (await fetch(`${f.base}/api/machines`)).json(), {
          machines: [
            { id: "local", name: "Local" },
            { id: "eng-1", name: "Engineering" },
          ],
        });
        const count = f.state.requests.length;
        for (const path of [
          "/peer",
          "/peer/local/ws",
          "/peer/missing/ws",
          "/peer/eng-1/api/folders",
          "/peer/eng-1/api/workspace/file",
          "/peer/eng-1/ws/extra",
        ]) {
          const response = await fetch(`${f.base}${path}`);
          assert.equal(response.status, 404, path);
          assert.match((await response.json()).error, /remote/i);
        }
        assert.equal(
          (await fetch(`${f.base}${commandPath}`, { method: "POST", headers: { Origin: f.base } }))
            .status,
          405,
        );
        assert.equal((await fetch(`${f.base}${commandPath}&cwd=/arbitrary`)).status, 400);
        // Another site's <img>/<script> or CORS read must not spend the peer credential.
        for (const crossSite of [
          { "Sec-Fetch-Site": "cross-site" },
          { "Sec-Fetch-Site": "same-site" },
          { Origin: "https://evil.example" },
        ] as Record<string, string>[]) {
          const response = await fetch(`${f.base}${commandPath}`, { headers: crossSite });
          assert.equal(response.status, 403, JSON.stringify(crossSite));
          assert.match((await response.json()).error, /remote/i);
        }
        assert.equal(
          await new Promise<number>((resolve, reject) => {
            const req = request(
              `${f.base}/api/machines`,
              {
                headers: { Host: "evil.example", "X-Forwarded-Host": "127.0.0.1" },
              },
              (res) => {
                res.resume();
                resolve(res.statusCode!);
              },
            );
            req.on("error", reject);
            req.end();
          }),
          403,
        );
        assert.equal(await f.handshake(undefined, { Origin: "https://evil.example" }), 403);
        assert.equal(await f.handshake(undefined, { Origin: "" }), 403);
        assert.equal(
          await f.handshake(undefined, { Host: "evil.example", "X-Forwarded-Host": "127.0.0.1" }),
          403,
        );
        assert.equal(await f.handshake("/peer/missing/ws"), 404);
        assert.equal(f.state.requests.length, count);
      },
    );

    await t.test(
      "raw frames, cursors and acknowledgements stay remote; no replay and detach is not stop",
      async () => {
        const from = f.state.sent.length;
        const connection = await f.open(headers);
        connection.send({
          _tag: "select",
          selectionId: "remote-selection",
          cwd: identity.cwd,
          sessionId: identity.sessionId,
        });
        await f.until(() => connection.messages.some((raw) => JSON.parse(raw)._tag === "selected"));
        const selected = JSON.parse(
          connection.messages.find((raw) => JSON.parse(raw)._tag === "selected")!,
        );
        assert.deepEqual(selected.cursor, {
          cwd: identity.cwd,
          sessionId: identity.sessionId,
          generation: "remote-generation",
          sequence: 71,
        });
        const prompt = {
          _tag: "act",
          selectionId: "remote-selection",
          start: {},
          action: { _tag: "prompt", text: "remote prompt", inputId: "remote-input" },
        };
        connection.send(prompt);
        await f.until(() =>
          connection.messages.some((raw) => JSON.parse(raw)._tag === "action_result"),
        );
        const receivedFrames = f.state.sent.slice(from);
        assert.equal(
          f.state.requests.findLast((r) => !r.url.startsWith("/api/"))?.url,
          "/ws/peer",
          "the remote decides this connection's scope at its peer endpoint",
        );
        assert.deepEqual(
          connection.messages,
          receivedFrames,
          "raw JSON fields, whitespace, delivery IDs and cursors must survive unchanged",
        );
        const lastId = JSON.parse(connection.messages.at(-1)!).deliveryId;
        await f.until(() =>
          f.state.received.some(
            (raw) => raw === JSON.stringify({ _tag: "ack", deliveryId: lastId }),
          ),
        );
        const disconnects = f.state.disconnected;
        connection.ws.close();
        await connection.closed;
        await f.until(() => f.state.disconnected > disconnects);
        assert.equal(f.state.running, true, "browser detachment cannot stop remote work");
        const connectionCount = f.state.connections;
        const reopened = await f.open();
        reopened.send({ _tag: "ping", nonce: "after-reconnect" });
        await f.until(() =>
          reopened.messages.some((raw) => JSON.parse(raw).nonce === "after-reconnect"),
        );
        assert.equal(
          f.state.connections,
          connectionCount + 1,
          "one new browser attachment, no gateway retry owner",
        );
        assert.equal(
          f.state.received.filter((raw) => JSON.parse(raw)._tag === "act").length,
          1,
          "prompt is never replayed",
        );
        assert.equal(f.state.received.filter((raw) => raw === JSON.stringify(prompt)).length, 1);
        reopened.ws.close();
        await reopened.closed;
      },
    );

    await t.test("commands reach the remote even when Local has the same IDs", async () => {
      const response = await fetch(`${f.base}${commandPath}`, { headers });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        commands: [{ name: "remote-only", source: "extension" }],
      });
      const connections = f.state.connections;
      assert.equal((await fetch(`${f.base}${commandPath}`, { headers })).status, 200);
      assert.equal(
        f.state.connections,
        connections,
        "a commands read is one HTTP request; the remote resolves the IDs itself",
      );
      for (const request of f.state.requests) {
        assert.equal(request.headers.origin, f.config.origin);
        assert.equal(request.headers.host, new URL(f.config.endpoint).host);
        for (const name of [
          "cookie",
          "authorization",
          "x-exedev-authorization",
          "forwarded",
          "x-forwarded-host",
          "x-forwarded-proto",
        ])
          assert.equal(request.headers[name], undefined, name);
      }
      assert.deepEqual(
        await readRegistry("unused", f.database),
        original,
        "peer requests must not mutate Local's registry",
      );
    });

    await t.test(
      "a folder's commands go to the remote's peer read as a POST body, never a URL",
      async () => {
        const folderPath = "/peer/eng-1/api/commands";
        const post = (body: string, extra: Record<string, string> = {}) =>
          fetch(`${f.base}${folderPath}`, {
            method: "POST",
            headers: { Origin: f.base, "content-type": "application/json", ...headers, ...extra },
            body,
          });
        const before = f.state.requests.length;
        const response = await post(JSON.stringify({ cwd: identity.cwd }));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          commands: [{ name: "remote-only", source: "extension" }],
        });
        const sent = f.state.requests.slice(before);
        assert.deepEqual(
          sent.map(({ url, method, body }) => ({ url, method, body })),
          [
            {
              url: "/api/peer/commands",
              method: "POST",
              body: JSON.stringify({ cwd: identity.cwd }),
            },
          ],
          "one POST to the remote's peer read; the path is only in the body",
        );
        assert.equal(sent[0]!.headers.origin, f.config.origin);
        assert.equal(sent[0]!.headers.cookie, undefined);

        const refused = f.state.requests.length;
        for (const [body, extra, status] of [
          [JSON.stringify({ cwd: "" }), {}, 400],
          [JSON.stringify({ cwd: identity.cwd, path: "/elsewhere" }), {}, 400],
          ["x".repeat(17 * 1024), {}, 400],
          [JSON.stringify({ cwd: identity.cwd }), { "Sec-Fetch-Site": "cross-site" }, 403],
        ] as const) {
          assert.equal((await post(body, extra)).status, status, body.slice(0, 60));
        }
        assert.equal((await fetch(`${f.base}${folderPath}`, { headers })).status, 405);
        assert.equal(f.state.requests.length, refused, "refused requests never reach the remote");
      },
    );

    await t.test(
      "a defaults save reaches the remote's own settings, and its refusal comes back",
      async () => {
        const defaultsPath = "/peer/eng-1/api/settings/defaults";
        const put = (body: string, extra: Record<string, string> = {}) =>
          fetch(`${f.base}${defaultsPath}`, {
            method: "PUT",
            headers: { Origin: f.base, "content-type": "application/json", ...headers, ...extra },
            body,
          });
        const before = f.state.requests.length;
        const saved = { model: "remote/beta", thinkingLevel: "high" };
        const response = await put(JSON.stringify(saved));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true });
        const sent = f.state.requests.slice(before);
        assert.deepEqual(
          sent.map(({ url, method, body }) => ({ url, method, body: JSON.parse(body!) })),
          [{ url: "/api/settings/defaults", method: "PUT", body: saved }],
        );
        assert.equal(sent[0]!.headers.origin, f.config.origin);
        assert.equal(sent[0]!.headers.cookie, undefined);
        assert.equal(sent[0]!.headers.authorization, undefined);

        const unknown = await put(
          JSON.stringify({ model: "remote/unknown", thinkingLevel: "low" }),
        );
        assert.equal(unknown.status, 400);
        assert.deepEqual(await unknown.json(), { error: "Choose an available model." });

        const refused = f.state.requests.length;
        for (const [body, extra, status] of [
          [JSON.stringify({ thinkingLevel: "extreme" }), {}, 400],
          [JSON.stringify({ ...saved, cwd: "/elsewhere" }), {}, 400],
          ["x".repeat(17 * 1024), {}, 400],
          [JSON.stringify(saved), { "Sec-Fetch-Site": "cross-site" }, 403],
        ] as const) {
          assert.equal((await put(body, extra)).status, status, body.slice(0, 60));
        }
        assert.equal((await fetch(`${f.base}${defaultsPath}`, { headers })).status, 405);
        assert.equal(f.state.requests.length, refused, "refused requests never reach the remote");
        assert.deepEqual(
          await readRegistry("unused", f.database),
          original,
          "a remote save must not touch Local",
        );
      },
    );

    await t.test("well-formed messages pass unchanged; the remote decides", async () => {
      const connection = await f.open();
      const messages = [
        { _tag: "select", selectionId: "s", cwd: identity.cwd, sessionId: "terminal-only" },
        { _tag: "set_trust", path: identity.cwd, trusted: true },
        { _tag: "act", selectionId: "s", action: { _tag: "set_name", name: "rename" } },
        { _tag: "ping", nonce: "forwarded" },
      ];
      for (const message of messages) connection.send(message);
      await f.until(() => connection.messages.some((raw) => JSON.parse(raw).nonce === "forwarded"));
      for (const message of messages)
        assert.ok(
          f.state.received.includes(JSON.stringify(message)),
          `${JSON.stringify(message)} reaches the remote byte for byte`,
        );
      connection.ws.close();
      await connection.closed;

      const invalid = await f.open();
      const before = f.state.received.length;
      invalid.send({ _tag: "not-a-message" });
      assert.equal((await invalid.closed).code, 1008);
      assert.equal(
        f.state.received.slice(before).some((raw) => raw.includes("not-a-message")),
        false,
      );
    });

    await t.test("the remote's close meaning reaches the browser", async () => {
      for (const code of [1009, 1013]) {
        const connection = await f.open();
        for (const ws of f.wss.clients) ws.close(code, "remote closed");
        assert.equal((await connection.closed).code, code);
      }
    });

    await t.test(
      "bounded WS input and output fail closed rather than retaining an unbounded relay",
      async () => {
        const large = await f.open();
        const before = f.state.received.length;
        large.send({ _tag: "ping", nonce: "x".repeat(PEER_FRAME_BYTES) });
        assert.equal((await large.closed).code, 1008);
        assert.equal(
          f.state.received.slice(before).some((raw) => raw.includes("xxx")),
          false,
        );

        const slow = await f.open({}, false);
        for (const ws of f.wss.clients) {
          for (let deliveryId = 3; deliveryId <= 70; deliveryId++) {
            ws.send(JSON.stringify({ _tag: "pong", nonce: "bounded", deliveryId }));
          }
        }
        assert.equal(
          (await slow.closed).code,
          1013,
          "unacknowledged relay frames have a finite window",
        );
        assert.ok(slow.messages.length <= 64);

        const dead = await f.open();
        const connections = f.state.connections;
        for (const ws of f.wss.clients) ws.terminate();
        assert.equal((await dead.closed).code, 1011);
        assert.equal(
          f.state.connections,
          connections,
          "upstream loss never reconnects inside the gateway",
        );
      },
    );

    await t.test("malformed or incompatible peers never admit traffic", async () => {
      for (const initial of [
        { _tag: "registry", folders: "invalid" },
        { _tag: "registry", folders: [] },
        { ...registry, sessionReferences: [{ cwd: "/incomplete" }] },
      ]) {
        f.state.initial = initial;
        assert.equal(
          await f.handshake().catch((error) => {
            throw new Error(`initial ${JSON.stringify(initial)}`, { cause: error });
          }),
          502,
        );
      }
      f.state.initial = registry;
      for (const mode of ["malformed", "redirect", "dead", "silent"]) {
        f.state.mode = mode;
        const before = f.state.requests.length;
        assert.equal(
          await f.handshake().catch((error) => {
            throw new Error(`mode ${mode}`, { cause: error });
          }),
          502,
          mode,
        );
        assert.equal(f.state.requests.length, before + 1, "no redirect or retry");
      }
      f.state.mode = "ready";
    });

    await t.test(
      "HTTP redirects, failure, bytes and response deadlines are bounded without retry",
      async () => {
        for (const mode of ["http-redirect", "http-dead", "http-large", "http-hang"]) {
          f.state.mode = mode;
          const before = f.state.requests.length;
          const response = await fetch(`${f.base}${commandPath}`);
          assert.equal(response.status, 502, mode);
          assert.equal(f.state.requests.length, before + 1, "one commands read, no redirect/retry");
        }
        f.state.mode = "ready";
      },
    );
  },
);
