import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inspect } from "node:util";
import { Redacted } from "effect";
import { loadPeerConfig } from "../server/PeerConfig.ts";
import { gatewayFixture, identity } from "./fixtures/peer-gateway.ts";

// Dummy credentials only: no account, token provisioning or real exe.dev request in routine tests.
const token = "exe1.test-only-private-vm-token";

test("VM token configuration stays startup-owned and redacted, with a private bounded file and an explicit VM destination", (t) => {
  const root = mkdtempSync(join(tmpdir(), "piano-vm-token-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "peer.json"),
    vmTokenFile = join(root, "vm-token");
  const config = {
    id: "eng-1",
    name: "Engineering",
    endpoint: "https://eng-1.exe.xyz:3000",
    origin: "https://eng-1.exe.xyz:3000",
    vmTokenFile,
  };
  const configure = (patch: object = {}) =>
    writeFileSync(file, JSON.stringify({ ...config, ...patch }));
  const writeToken = (text: string) => writeFileSync(vmTokenFile, text, { mode: 0o600 });
  configure();
  writeToken(`${token}\n`);
  const peer = loadPeerConfig(file)!;
  assert.equal(Redacted.value(peer.vmToken!), token);
  assert.equal("vmTokenFile" in peer, false);
  assert.ok(!JSON.stringify(peer).includes(token));
  assert.ok(!inspect(peer).includes(token));
  rmSync(vmTokenFile);
  assert.equal(Redacted.value(peer.vmToken!), token, "loaded once, not reread on reconnect");
  const denied = () =>
    assert.throws(
      () => loadPeerConfig(file),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /vmTokenFile/);
        assert.ok(!error.message.includes(root));
        assert.ok(!error.message.includes(token));
        return true;
      },
    );
  denied();
  for (const value of [
    "",
    "Bearer " + token,
    token + "\r\nX-Injected: value",
    token + "\nsecond-token",
    "x".repeat(16 * 1024 + 1),
  ]) {
    writeToken(value);
    denied();
  }
  writeToken(token);
  if (process.getuid) {
    chmodSync(vmTokenFile, 0o644);
    denied();
    chmodSync(vmTokenFile, 0o600);
  }
  const link = join(root, "link");
  symlinkSync(vmTokenFile, link);
  configure({ vmTokenFile: link });
  denied();
  const directory = join(root, "directory");
  mkdirSync(directory);
  configure({ vmTokenFile: directory });
  denied();
  configure({ vmTokenFile: "relative-token" });
  denied();
  for (const endpoint of [
    "https://piano-scratch-test.int.exe.xyz",
    "https://eng-1.exe.xyz.evil.example",
    "https://example.com",
    "https://127.0.0.1:1234",
  ]) {
    configure({ endpoint });
    denied();
  }
  configure({ endpoint: "http://eng-1.exe.xyz" });
  assert.throws(() => loadPeerConfig(file), /PIANO_PEER_CONFIG/);
  configure({ vmToken: token });
  assert.throws(
    () => loadPeerConfig(file),
    /PIANO_PEER_CONFIG/,
    "raw inline tokens are not accepted",
  );
});

test(
  "the gateway authenticates HTTP and WS only with its configured VM token; auth failures and redirects never replay or expose it",
  { timeout: 45_000 },
  async (t) => {
    const f = await gatewayFixture(t, { vmToken: token });
    const path = `/peer/eng-1/api/session/commands?workspaceId=${identity.workspaceId}&sessionId=${identity.sessionId}`;
    const headers = {
      Authorization: "Bearer browser-secret",
      Cookie: "browser=secret",
      "X-Exedev-Authorization": "Bearer browser-override",
    };
    assert.deepEqual(await (await fetch(f.base + "/api/machines")).json(), {
      machines: [
        { id: "local", name: "Local" },
        { id: "eng-1", name: "Engineering" },
      ],
    });
    const connection = await f.open(headers);
    connection.send({
      _tag: "select",
      selectionId: "token-test",
      cwd: identity.cwd,
      sessionId: identity.sessionId,
    });
    await f.until(() => connection.messages.some((raw) => JSON.parse(raw)._tag === "selected"));
    connection.send({
      _tag: "act",
      selectionId: "token-test",
      action: { _tag: "prompt", text: "authenticated exactly once" },
    });
    await f.until(() =>
      connection.messages.some((raw) => JSON.parse(raw)._tag === "action_result"),
    );
    const response = await fetch(f.base + path, { headers });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      commands: [{ name: "remote-only", source: "extension" }],
    });
    for (const req of f.state.requests) {
      assert.equal(req.headers["x-exedev-authorization"], `Bearer ${token}`);
      assert.equal(req.headers.origin, f.config.origin);
      assert.equal(req.headers.authorization, undefined);
      assert.equal(req.headers.cookie, undefined);
    }
    assert.ok(f.state.requests.some((req) => req.url === "/ws"));
    assert.ok(f.state.requests.some((req) => req.url.startsWith("/api/session/commands")));
    assert.ok(connection.messages.every((raw) => !raw.includes(token)));
    connection.ws.close();
    await connection.closed;
    assert.equal(
      f.state.running,
      true,
      "closing the observer does not stop authenticated remote work",
    );

    // Revocation/expiry: the next connection is refused rather than reconnecting without auth.
    f.state.requiredToken = "rotated-or-revoked";
    let before = f.state.requests.length;
    assert.equal(await f.handshake(), 502);
    assert.equal(f.state.requests.length, before + 1);
    f.state.requiredToken = token;
    for (const mode of ["ws-forbidden", "redirect"]) {
      f.state.mode = mode;
      before = f.state.requests.length;
      assert.equal(await f.handshake(), 502);
      assert.equal(f.state.requests.length, before + 1, "no redirect or unauthenticated retry");
    }
    for (const mode of ["http-unauthorized", "http-forbidden", "http-redirect"]) {
      f.state.mode = mode;
      before = f.state.requests.length;
      const failed = await fetch(f.base + path, { headers });
      assert.equal(failed.status, 502);
      assert.ok(
        !(await failed.text()).includes(token),
        "even an auth body echoing a credential is discarded",
      );
      assert.equal(
        f.state.requests.length,
        before + 2,
        "one registry plus one HTTP read, no retry/redirect",
      );
    }
    assert.equal(f.state.received.filter((raw) => JSON.parse(raw)._tag === "act").length, 1);
    assert.ok(!f.logs().includes(token), "startup and transport logs contain no credential");
  },
);
