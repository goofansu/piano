import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { socketLimits } from "../server/BoundedDelivery.ts";
import { loadPeerConfigs } from "../server/PeerConfig.ts";
import { PEER_FRAME_BYTES } from "../shared/machine.ts";
import {
  IMAGE_CANCEL_PATH,
  IMAGE_UPLOAD_PATH,
  IMAGE_PREVIEW_PATH,
  IMAGE_UPLOAD_TYPE,
  remoteImageLimits,
} from "../shared/remoteImages.ts";
import { CloseCode } from "../shared/wire.ts";
import { imageUploadBody } from "../web/src/lib/remoteImages.ts";
import { gatewayFixture, identity, registry } from "./fixtures/peer-gateway.ts";
import { readRegistry } from "./fixtures/registry.ts";

test(
  "image gateway streams only fixed routes with per-peer bounds, no credentials or retry leakage",
  { timeout: 30_000 },
  async (t) => {
    const f = await gatewayFixture(t, {
      peers: [
        { id: "eng-1", vmToken: "exe1.dummy-one" },
        { id: "eng-2", vmToken: "exe1.dummy-two" },
      ],
    });
    const [one, two] = f.peers;
    const image = {
      kind: "image" as const,
      name: "x.png",
      mimeType: "image/png" as const,
      data: "iVBORw0KGgo=",
    };
    const blob = imageUploadBody({ cwd: identity.cwd, sessionId: identity.sessionId }, [image]);
    const headers = {
      Origin: f.base,
      Cookie: "browser=secret",
      Authorization: "Bearer browser-secret",
      "X-Exedev-Authorization": "Bearer browser-injected",
    };
    const upload = (id = "eng-1", body: BodyInit = blob) =>
      fetch(`${f.base}/peer/${id}${IMAGE_UPLOAD_PATH}`, {
        method: "POST",
        headers: { ...headers, "content-type": IMAGE_UPLOAD_TYPE },
        body,
      });
    const response = await upload();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: "prepared-eng-1" });
    assert.deepEqual(one.state.requests.at(-1)!.bytes, Buffer.from(await blob.arrayBuffer()));
    const preview = `${f.base}/peer/eng-1${IMAGE_PREVIEW_PATH}?${new URLSearchParams({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, hash: "a".repeat(64) })}`;
    const shown = await fetch(preview, { headers });
    assert.equal(shown.status, 200);
    assert.equal(shown.headers.get("set-cookie"), null);
    assert.equal(shown.headers.get("cache-control"), "private, no-store");
    assert.equal(shown.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await shown.arrayBuffer()), Buffer.from(image.data, "base64"));
    for (const recorded of one.state.requests) {
      assert.equal(recorded.headers.cookie, undefined);
      assert.equal(recorded.headers.authorization, undefined);
      assert.equal(recorded.headers["x-exedev-authorization"], "Bearer exe1.dummy-one");
      assert.equal(recorded.headers.origin, one.config.origin);
    }
    const before = one.state.requests.length;
    for (const url of [
      preview + "&extra=1",
      preview.replace("hash=", "bogus="),
      preview.replace("a".repeat(64), "..%2Fsecret"),
    ])
      assert.equal((await fetch(url)).status, 400);
    assert.equal(
      (await fetch(preview, { headers: { "Sec-Fetch-Site": "cross-site" } })).status,
      403,
    );
    assert.equal(
      (await fetch(preview, { method: "POST", headers: { Origin: f.base } })).status,
      405,
    );
    assert.equal((await upload("missing")).status, 404);
    assert.equal(one.state.requests.length, before, "refuse before dialing");
    for (const mode of ["http-redirect", "http-dead", "http-large", "http-unauthorized"]) {
      one.state.mode = mode;
      const count = one.state.requests.length;
      assert.equal((await upload()).status, 502, mode);
      assert.equal(one.state.requests.length, count + 1, "never retry uploads");
    }
    // The peer's refusal reaches the browser as its status and its own sentence.
    one.state.mode = "image-refused";
    const refused = await upload();
    assert.equal(refused.status, 404);
    assert.deepEqual(await refused.json(), {
      error: "Image target is not listed on this machine.",
    });
    one.state.mode = "image-refused-unreadable";
    const unreadable = await upload();
    assert.equal(unreadable.status, 404);
    assert.match((await unreadable.json()).error, /^Could not transfer images/);
    for (const mode of ["image-mime", "image-large"]) {
      one.state.mode = mode;
      assert.ok((await fetch(preview)).status >= 400, mode);
    }
    for (const mode of ["image-interrupted", "image-chunked-large"]) {
      one.state.mode = mode;
      const response = await fetch(preview);
      if (response.ok) await assert.rejects(response.arrayBuffer(), mode);
    }
    // Held HTTP responses cannot occupy WS input/control lanes or another peer's HTTP slots.
    one.state.mode = "http-held";
    const a = upload(),
      b = upload();
    await one.until(() => one.state.pendingHttp.length === 2);
    assert.equal((await upload()).status, 429);
    const healthy = await upload("eng-2");
    assert.equal(healthy.status, 200);
    await healthy.body?.cancel();
    assert.equal(
      two.state.requests.at(-1)!.headers["x-exedev-authorization"],
      "Bearer exe1.dummy-two",
    );
    const socket = await f.open({}, true, "eng-1");
    socket.send({ _tag: "ping", nonce: "upload-ping" });
    socket.send({ _tag: "act", selectionId: "selected", action: { _tag: "stop" } });
    await one.until(() =>
      one.state.received.some((raw) => JSON.parse(raw).nonce === "upload-ping"),
    );
    await one.until(() =>
      one.state.received.some((raw) => JSON.parse(raw).action?._tag === "stop"),
    );
    for (const release of one.state.pendingHttp.splice(0)) release();
    for (const reply of await Promise.all([a, b])) {
      assert.equal(reply.status, 200);
      await reply.body?.cancel();
    }
    socket.ws.close();
    await socket.closed;
    // Backpressure on the second hop of a maximum accepted batch must not hold controls.
    one.state.mode = "image-body-held";
    const pixels = Buffer.alloc(10 * 1024 * 1024);
    pixels.set(Buffer.from(image.data, "base64"));
    const maximum = imageUploadBody(
      { cwd: identity.cwd, sessionId: identity.sessionId },
      Array.from({ length: 5 }, () => ({ ...image, data: pixels.toString("base64") })),
    );
    const maximumResponse = upload("eng-1", maximum);
    await one.until(() => one.state.pendingBodies.length === 1);
    const live = await f.open({}, true, "eng-1");
    live.send({ _tag: "ping", nonce: "large-upload-ping" });
    live.send({
      _tag: "act",
      selectionId: "selected",
      action: {
        _tag: "answer",
        id: "dialog",
        generation: "remote",
        value: "answer while uploading",
      },
    });
    await one.until(() =>
      one.state.received.some((raw) => JSON.parse(raw).action?.value === "answer while uploading"),
    );
    await one.until(() =>
      one.state.received.some((raw) => JSON.parse(raw).nonce === "large-upload-ping"),
    );
    one.state.pendingBodies.pop()!();
    const accepted = await maximumResponse;
    assert.equal(accepted.status, 200);
    await accepted.body?.cancel();
    assert.equal(
      one.state.requests.findLast((req) => req.url === IMAGE_UPLOAD_PATH)!.bytes!.length,
      maximum.size,
    );
    live.ws.close();
    await live.closed;
    one.state.mode = "ready";
    // No Content-Length: count the actual streamed bytes, not an absent or lying header.
    let chunks = 0;
    const overflowing = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (++chunks <= 52) controller.enqueue(new Uint8Array(1024 * 1024));
        else controller.close();
      },
    });
    const over = await fetch(`${f.base}/peer/eng-1${IMAGE_UPLOAD_PATH}`, {
      method: "POST",
      headers: { Origin: f.base, "content-type": IMAGE_UPLOAD_TYPE },
      body: overflowing,
      duplex: "half",
    } as RequestInit);
    assert.ok(over.status >= 400);
    assert.ok(remoteImageLimits.bodyBytes < 52 * 1024 * 1024);
  },
);

test("both image hops refuse a malformed image request with the same status and error", async (t) => {
  const f = await gatewayFixture(t);
  const preview = `${IMAGE_PREVIEW_PATH}?${new URLSearchParams({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, hash: "a".repeat(64) })}`;
  const json = { "content-type": "application/json" };
  const binary = { "content-type": IMAGE_UPLOAD_TYPE };
  const cases: [string, string, string, Record<string, string>, number][] = [
    ["upload by GET", "GET", IMAGE_UPLOAD_PATH, {}, 405],
    ["cancel by GET", "GET", IMAGE_CANCEL_PATH, {}, 405],
    ["preview by POST", "POST", preview, json, 405],
    ["query on upload", "POST", `${IMAGE_UPLOAD_PATH}?x=1`, binary, 400],
    ["query on cancel", "POST", `${IMAGE_CANCEL_PATH}?x=1`, json, 400],
    ["bad preview hash", "GET", preview.replace("a".repeat(64), "..%2Fsecret"), {}, 400],
    ["extra preview key", "GET", `${preview}&extra=1`, {}, 400],
    ["upload as JSON", "POST", IMAGE_UPLOAD_PATH, json, 415],
    ["cancel as binary", "POST", IMAGE_CANCEL_PATH, binary, 415],
    [
      "compressed upload",
      "POST",
      IMAGE_UPLOAD_PATH,
      { ...binary, "content-encoding": "gzip" },
      400,
    ],
    ["upgrade on preview", "GET", preview, { upgrade: "h2c" }, 400],
    [
      "oversized upload",
      "POST",
      IMAGE_UPLOAD_PATH,
      { ...binary, "content-length": String(remoteImageLimits.bodyBytes + 1) },
      413,
    ],
    [
      "oversized cancel",
      "POST",
      IMAGE_CANCEL_PATH,
      { ...json, "content-length": String(remoteImageLimits.responseBytes + 1) },
      413,
    ],
  ];
  // node:http, since fetch cannot send Upgrade or a Content-Length its body does not match.
  const send = (path: string, method: string, headers: Record<string, string>) =>
    new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const req = request(`${f.base}${path}`, {
        method,
        agent: false,
        headers: { Origin: f.base, ...headers },
      });
      req.on("response", async (res) => {
        let text = "";
        for await (const chunk of res) text += chunk;
        resolve({ status: res.statusCode!, body: JSON.parse(text) });
      });
      req.on("error", reject);
      req.end();
    });
  for (const [name, method, path, headers, status] of cases) {
    const peer = await send(path, method, headers);
    const relayed = await send(`/peer/eng-1${path}`, method, headers);
    assert.equal(peer.status, status, name);
    assert.deepEqual(relayed, peer, name);
  }
  assert.equal(f.state.requests.length, 0, "the relay refuses before dialing the peer");
});

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
          // Browsing the remote's directories stays on its own Piano.
          "/peer/eng-1/api/ls",
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

    await t.test(
      "a session's Changes are read and saved on the remote, each by its own method",
      async () => {
        const changesPath = `/peer/eng-1/api/session/changes?workspaceId=${identity.workspaceId}&sessionId=${identity.sessionId}`;
        const ask = (method: string, body: string, extra: Record<string, string> = {}) =>
          fetch(`${f.base}${changesPath}`, {
            method,
            headers: { Origin: f.base, "content-type": "application/json", ...headers, ...extra },
            body,
          });
        const before = f.state.requests.length;
        const scope = "uncommitted";
        for (const [method, body] of [
          ["POST", "{}"],
          ["PUT", JSON.stringify({ scope: null })],
        ] as const) {
          const response = await ask(method, body);
          assert.equal(response.status, 200, method);
          assert.equal(response.headers.get("cache-control"), "no-store");
          const answer = (await response.json()) as { result: { detail: string } };
          assert.equal(answer.result.detail, `${method} /api/session/changes`);
        }
        const one = await fetch(`${f.base}${changesPath.replace("/changes?", "/changes/file?")}`, {
          method: "POST",
          headers: { Origin: f.base, "content-type": "application/json", ...headers },
          body: JSON.stringify({ path: "src/a.ts", scope }),
        });
        assert.equal(one.status, 200);
        const sent = f.state.requests.slice(before);
        assert.deepEqual(
          sent.map(({ url, method }) => `${method} ${url}`),
          ["POST", "PUT"]
            .map(
              (method) =>
                `${method} /api/session/changes?workspaceId=${identity.workspaceId}&sessionId=${identity.sessionId}`,
            )
            .concat(
              `POST /api/session/changes/file?workspaceId=${identity.workspaceId}&sessionId=${identity.sessionId}`,
            ),
        );
        assert.deepEqual(JSON.parse(sent[2]!.body!), { path: "src/a.ts", scope });
        for (const request of sent) {
          assert.equal(request.headers.origin, f.config.origin);
          assert.equal(request.headers.cookie, undefined);
          assert.equal(request.headers.authorization, undefined);
        }

        const refused = f.state.requests.length;
        assert.equal((await ask("POST", JSON.stringify({ scope: "everything" }))).status, 400);
        assert.equal((await ask("POST", "{}", { "Sec-Fetch-Site": "cross-site" })).status, 403);
        assert.equal((await ask("DELETE", "{}")).status, 405);
        assert.equal(f.state.requests.length, refused, "refused requests never reach the remote");
      },
    );

    await t.test(
      "a session is shared by the remote, and its sign-in refusal comes back",
      async () => {
        const sharePath = `/peer/eng-1/api/session/share?workspaceId=${identity.workspaceId}&sessionId=${identity.sessionId}`;
        const share = (extra: Record<string, string> = {}, path = sharePath) =>
          fetch(`${f.base}${path}`, {
            method: "POST",
            headers: { Origin: f.base, ...headers, ...extra },
          });
        const before = f.state.requests.length;
        const response = await share();
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.deepEqual(await response.json(), {
          url: "https://radius.pi.dev/a/eng-1",
          expiresAt: "2027-01-01T00:00:00.000Z",
          visibility: "organization",
        });
        const sent = f.state.requests.slice(before);
        assert.deepEqual(
          sent.map(({ url, method }) => `${method} ${url}`),
          [
            `POST /api/session/share?workspaceId=${identity.workspaceId}&sessionId=${identity.sessionId}`,
          ],
        );
        // Main's own sign-ins never travel: the remote publishes with its own.
        assert.equal(sent[0]!.headers.origin, f.config.origin);
        assert.equal(sent[0]!.headers.cookie, undefined);
        assert.equal(sent[0]!.headers.authorization, undefined);

        f.state.mode = "share-signed-out";
        const signedOut = await share();
        f.state.mode = "ready";
        assert.equal(signedOut.status, 409);
        assert.deepEqual(await signedOut.json(), {
          error: "Sign in to Radius in Providers before sharing.",
        });

        const refused = f.state.requests.length;
        assert.equal((await share({}, "/peer/eng-1/api/session/share")).status, 400);
        assert.equal((await share({ "Sec-Fetch-Site": "cross-site" })).status, 403);
        assert.equal((await fetch(`${f.base}${sharePath}`, { headers })).status, 405);
        assert.equal(f.state.requests.length, refused, "refused requests never reach the remote");
      },
    );

    await t.test(
      "a file is read from the remote as it sent it, bounded, with only its type and name",
      async () => {
        const read = (
          path: string,
          {
            download = false,
            extra = {} as Record<string, string>,
            body = undefined as string | undefined,
          } = {},
        ) =>
          fetch(
            `${f.base}/peer/eng-1/api/workspace/file${download ? "/download" : ""}?workspaceId=${identity.workspaceId}`,
            {
              method: "POST",
              headers: { Origin: f.base, "content-type": "application/json", ...headers, ...extra },
              body: body ?? JSON.stringify({ path }),
            },
          );
        const before = f.state.requests.length;
        const preview = await read("docs/notes.md");
        assert.equal(preview.status, 200);
        assert.equal(preview.headers.get("cache-control"), "no-store");
        assert.equal(preview.headers.get("x-content-type-options"), "nosniff");
        assert.equal(preview.headers.get("set-cookie"), null, "the remote's cookie stays there");
        assert.deepEqual(await preview.json(), {
          workspaceId: identity.workspaceId,
          path: "docs/notes.md",
          kind: "markdown",
          language: "markdown",
          content: "# remote",
        });
        const saved = await read("docs/notes.md", { download: true });
        assert.equal(saved.status, 200);
        assert.equal(saved.headers.get("content-type"), "text/markdown; charset=utf-8");
        assert.equal(
          saved.headers.get("content-disposition"),
          "attachment; filename*=UTF-8''notes.md",
        );
        assert.equal(saved.headers.get("set-cookie"), null);
        assert.equal(await saved.text(), "# exact bytes\n");
        const sent = f.state.requests.slice(before);
        assert.deepEqual(
          sent.map(({ url, method, body }) => ({ url, method, body })),
          ["/api/workspace/file", "/api/workspace/file/download"].map((path) => ({
            url: `${path}?workspaceId=${identity.workspaceId}`,
            method: "POST",
            body: JSON.stringify({ path: "docs/notes.md" }),
          })),
          "the file's path travels only in the body",
        );

        // What only the remote knows comes back in its words.
        const missing = await read("missing.md");
        assert.equal(missing.status, 400);
        assert.deepEqual(await missing.json(), { error: "File not found." });

        // A larger or compressed answer is the remote unavailable, never a partial file.
        for (const mode of ["file-large", "file-compressed"]) {
          f.state.mode = mode;
          assert.equal((await read("docs/notes.md")).status, 502, mode);
        }

        // Two files at once for one remote; a third is refused rather than queued.
        f.state.mode = "http-held";
        const held = [read("a.md"), read("b.md")];
        await f.until(() => f.state.pendingHttp.length === 2);
        const busy = await read("c.md");
        assert.equal(busy.status, 429);
        assert.deepEqual(await busy.json(), { error: "Remote files are busy. Try again." });
        f.state.mode = "ready";
        for (const release of f.state.pendingHttp.splice(0)) release();
        for (const response of await Promise.all(held)) {
          assert.equal(response.status, 200);
          await response.body?.cancel();
        }
        assert.equal((await read("d.md")).status, 200, "a finished file frees its place");

        const refused = f.state.requests.length;
        for (const [body, extra, status] of [
          [JSON.stringify({ path: "" }), {}, 400],
          [JSON.stringify({ path: "a.md", cwd: "/elsewhere" }), {}, 400],
          [JSON.stringify({ path: "x".repeat(17 * 1024) }), {}, 400],
          [JSON.stringify({ path: "a.md" }), { "Sec-Fetch-Site": "cross-site" }, 403],
        ] as const)
          assert.equal((await read("", { body, extra })).status, status, body.slice(0, 60));
        assert.equal(f.state.requests.length, refused, "refused requests never reach the remote");
      },
    );

    await t.test(
      "a session's written paths reach the remote in a body larger than a path",
      async () => {
        const paths = Array.from(
          { length: 1000 },
          (_, n) => `src/${"deep/".repeat(8)}file-${n}.ts`,
        );
        const body = JSON.stringify({ paths });
        assert.ok(Buffer.byteLength(body) > 16 * 1024);
        const before = f.state.requests.length;
        const response = await fetch(
          `${f.base}/peer/eng-1/api/workspace/files/written?workspaceId=${identity.workspaceId}`,
          {
            method: "POST",
            headers: { Origin: f.base, "content-type": "application/json", ...headers },
            body,
          },
        );
        assert.equal(response.status, 200);
        assert.deepEqual(((await response.json()) as { result: unknown }).result, {
          status: "ready",
          files: [],
        });
        assert.deepEqual(JSON.parse(f.state.requests.at(-1)!.body!), { paths });
        assert.equal(f.state.requests.length, before + 1);
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
      for (const code of [CloseCode.tooLarge, CloseCode.tryAgainLater]) {
        const connection = await f.open();
        for (const ws of f.wss.clients) ws.close(code, "remote closed");
        assert.equal((await connection.closed).code, code);
      }
    });

    await t.test("a frame the remote's own socket admits reaches the browser", async () => {
      const connection = await f.open();
      const empty = JSON.stringify({ _tag: "pong", nonce: "", deliveryId: 3 });
      const frame = JSON.stringify({
        _tag: "pong",
        nonce: "x".repeat(socketLimits.frameBytes - empty.length),
        deliveryId: 3,
      });
      assert.equal(Buffer.byteLength(frame), socketLimits.frameBytes);
      for (const ws of f.wss.clients) ws.send(frame);
      await f.until(() => connection.messages.some((raw) => raw.length === frame.length));
      connection.ws.close();
      await connection.closed;
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
          for (let deliveryId = 3; deliveryId <= socketLimits.window.frames + 6; deliveryId++) {
            ws.send(JSON.stringify({ _tag: "pong", nonce: "bounded", deliveryId }));
          }
        }
        assert.equal(
          (await slow.closed).code,
          1013,
          "unacknowledged relay frames have a finite window",
        );
        assert.ok(slow.messages.length <= socketLimits.window.frames);

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
