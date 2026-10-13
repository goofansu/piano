import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Effect, Layer } from "effect";
import { Registry } from "../server/Registry.ts";
import { SessionHosts } from "../server/SessionHosts.ts";
import { SharingEnvironment } from "../server/SessionSharing.ts";
import { type RouterFixture, startRouter } from "./fixtures/router.ts";

let server: RouterFixture;
let signedIn = false;
let authFails = false;
const uploads: { url: string; init: RequestInit }[] = [];
let respond = async (_signal: AbortSignal): Promise<Response> => success();
const success = () =>
  Response.json({
    artifact: {
      canonical_url: "https://radius.earendil.com/artifacts/shared-session",
      expires_at: "2027-01-01T00:00:00Z",
      visibility: "organization",
    },
  });
const id = "11111111-1111-4111-8111-111111111111";
let file: string;
let original: string;

before(async () => {
  server = await startRouter(
    "piano-sharing-",
    Layer.succeed(SharingEnvironment, {
      runtime: async () => ({
        listCredentials: async () => (signedIn ? [{ providerId: "radius", type: "oauth" }] : []),
        getAuth: async () => {
          if (authFails) throw new Error("secret-token-response");
          return { auth: { headers: { Authorization: "Bearer test-credential" } } };
        },
      }),
      fetch: async (url, init) => {
        uploads.push({ url: String(url), init: init! });
        return respond(init!.signal!);
      },
      timeoutMs: 500,
    }),
  );
  await server.run(Effect.flatMap(Registry, (registry) => registry.addSession(server.repo, id)));
  file = join(server.root, "sessions", `${id}.jsonl`);
  const entry = (entryId: string, parentId: string | null, text: string) => ({
    type: "message",
    id: entryId,
    parentId,
    timestamp: "2026-10-13T00:00:00Z",
    message: { role: "user", content: text, timestamp: 1 },
  });
  original =
    [
      { type: "session", version: 3, id, cwd: server.repo, timestamp: "2026-10-13T00:00:00Z" },
      entry("root", null, "Shared start"),
      entry("abandoned", "root", "Do not publish this other branch"),
      entry("leaf", "root", "Selected branch with sk-secret-example"),
    ]
      .map((value) => JSON.stringify(value))
      .join("\n") + "\n";
  writeFileSync(file, original);
});
after(() => server.dispose());
const share = (sessionId = id) =>
  server.handle(`/api/session/share?workspaceId=${server.workspaceId}&sessionId=${sessionId}`, {
    method: "POST",
  });

test("INV-11: sharing rechecks sign-in and fails closed without disclosing credential errors", async () => {
  const missing = await share();
  assert.equal(missing.status, 409);
  assert.match((await missing.json()).error, /Sign in to Radius/);
  assert.equal(uploads.length, 0);
  signedIn = true;
  authFails = true;
  const denied = await share();
  assert.equal(denied.status, 409);
  assert.doesNotMatch(await denied.text(), /secret-token-response/);
  assert.equal(uploads.length, 0);
  authFails = false;
});

test("INV-01/02/11: native branch snapshot shares without MCP, an agent, or history mutations", async () => {
  const response = await share();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    url: "https://radius.earendil.com/artifacts/shared-session",
    expiresAt: "2027-01-01T00:00:00Z",
    visibility: "organization",
  });
  assert.equal(uploads.length, 1);
  const upload = uploads[0]!;
  const url = new URL(upload.url);
  assert.equal(url.origin, "https://radius.pi.dev");
  assert.equal(url.pathname, "/v1/artifacts");
  assert.equal(url.searchParams.get("visibility"), "organization");
  assert.equal(upload.init.method, "POST");
  assert.equal(upload.init.redirect, "error");
  assert.equal(new Headers(upload.init.headers).get("authorization"), "Bearer test-credential");
  assert.equal(new Headers(upload.init.headers).get("content-type"), "application/x-ndjson");
  const content = String(upload.init.body);
  assert.doesNotMatch(content, /abandoned|sk-secret-example|test-credential/);
  const lines = content
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    lines.map((line) => line.id),
    [id, "root", "leaf"],
  );
  assert.equal(lines[2].message.content, "Selected branch with [REDACTED]");
  assert.equal(readFileSync(file, "utf8"), original);
  assert.deepEqual(await server.run(Effect.flatMap(SessionHosts, (hosts) => hosts.list)), []);
});

test("legacy history is migrated for export without rewriting Pi's file", async () => {
  const legacy = original.replace('"version":3', '"version":2');
  writeFileSync(file, legacy);
  assert.equal((await share()).status, 200);
  assert.equal(readFileSync(file, "utf8"), legacy);
  assert.match(String(uploads.at(-1)!.init.body), /"version":3/);
  writeFileSync(file, original);
});

test("in-flight Pi work cannot publish a partial session", async () => {
  const live = await server.run(
    Effect.flatMap(SessionHosts, (hosts) => hosts.create({ cwd: server.repo, options: {} })),
  );
  await server.run(live.act({ _tag: "prompt", text: "/compact" }));
  const count = uploads.length;
  const refused = await share(live.spec.sessionId);
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /Wait for this session to finish/);
  assert.equal(uploads.length, count);
  await server.run(
    Effect.flatMap(SessionHosts, (hosts) => hosts.release(server.repo, live.spec.sessionId)),
  );
});

test("concurrent publications for the same session join one upload", async () => {
  let started!: () => void;
  let finish!: (response: Response) => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const completed = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  respond = async () => {
    started();
    return completed;
  };
  const count = uploads.length;
  const first = share();
  await began;
  const second = share();
  // Both HTTP requests are admitted before resolving the external boundary.
  await new Promise((resolve) => setImmediate(resolve));
  finish(success());
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  assert.equal(uploads.length, count + 1);
  respond = async () => success();
});

test("failed, malformed, unsafe-link and timed-out uploads are not success or automatically retried", async () => {
  for (const response of [
    () => new Response("secret-transcript-response", { status: 503 }),
    () =>
      Response.json({
        artifact: {
          canonical_url: "javascript:alert(1)",
          expires_at: "2027-01-01",
          visibility: "organization",
        },
      }),
    () =>
      Response.json({
        artifact: {
          canonical_url: "https://radius.earendil.com/a/x",
          expires_at: "2027-01-01",
          visibility: "public",
        },
      }),
  ]) {
    respond = async () => response();
    const count = uploads.length;
    const failed = await share();
    assert.equal(failed.status, 409);
    const text = await failed.text();
    assert.match(text, /Check Radius artifacts/);
    assert.doesNotMatch(text, /secret-transcript|javascript:/);
    assert.equal(uploads.length, count + 1);
  }
  let aborted = false;
  respond = (signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
  const timedOut = await share();
  assert.equal(timedOut.status, 409);
  assert.equal(aborted, true);
  respond = async () => success();
});

test("unknown and missing histories never cause uploads; signed-out stale clients are rejected", async () => {
  const count = uploads.length;
  assert.equal((await share("unknown")).status, 404);
  writeFileSync(file, original.split("\n")[0] + "\n");
  assert.equal((await share()).status, 409);
  writeFileSync(file, original);
  signedIn = false;
  assert.equal((await share()).status, 409);
  assert.equal(uploads.length, count);
});
