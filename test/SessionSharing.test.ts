import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import { Effect, Layer } from "effect";
import { ProviderLoginRuntime } from "../server/ProviderLogin.ts";
import { Registry, RegistryLive } from "../server/Registry.ts";
import { SessionHosts } from "../server/SessionHosts.ts";
import {
  SessionSharing,
  SessionSharingLive,
  SharingEnvironment,
} from "../server/SessionSharing.ts";
import { type RouterFixture, startRouter } from "./fixtures/router.ts";

let server: RouterFixture;
let signedIn = false;
let authFails = false;
let organization = "org-a";
let metadataStatus = 200;
let metadataReply: (() => Response) | undefined;
let visibility = "organization";
let canPublish = true;
let allocationHook = async () => {};
type Artifact = {
  id: string;
  canonical_url: string;
  expires_at: string;
  visibility: string;
  latest_version: number;
};
const artifacts: Artifact[] = [];
const allocations: RequestInit[] = [];
const uploads: { url: string; init: RequestInit }[] = [];
const calls: string[] = [];
const success = (artifact: Artifact) =>
  Response.json({ artifact: { ...artifact, capabilities: { publish_revision: canPublish } } });
const normalPublish = async (_signal: AbortSignal, artifact: Artifact) => {
  artifact.latest_version++;
  return success(artifact);
};
let respond = normalPublish;
const id = "11111111-1111-4111-8111-111111111111";
let file: string;
let original: string;
const destination = (sessionId = id) =>
  server.run(
    Effect.flatMap(Registry, (registry) =>
      Effect.map(
        registry.get,
        (data) => data.sessions.find((s) => s.sessionId === sessionId)?.radiusShare,
      ),
    ),
  );
const register = async (sessionId: string) => {
  await server.run(
    Effect.flatMap(Registry, (registry) => registry.addSession(server.repo, sessionId)),
  );
  writeFileSync(
    join(server.root, "sessions", `${sessionId}.jsonl`),
    original.replaceAll(id, sessionId),
  );
};

before(async () => {
  server = await startRouter(
    "piano-sharing-",
    Layer.mergeAll(
      // Pi's credentials, read only through ProviderLogin. An API key never authorizes sharing.
      Layer.succeed(ProviderLoginRuntime, {
        create: async () => ({
          getProviders: () => [],
          listCredentials: async () => [
            { providerId: "radius", type: "api_key" },
            ...(signedIn ? [{ providerId: "radius", type: "oauth" } as const] : []),
          ],
          getAuth: async () => {
            if (authFails) throw new Error("secret-token-response");
            return { auth: { headers: { Authorization: "Bearer test-credential" } } };
          },
          login: async () => {
            throw new Error("unused");
          },
          logout: async () => {
            throw new Error("unused");
          },
        }),
        deviceId: () => "unused",
      }),
      Layer.succeed(SharingEnvironment, {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push(`${init!.method} ${url.pathname}`);
          assert.equal(url.origin, "https://radius.pi.dev");
          assert.equal(init!.redirect, "error");
          assert.equal(new Headers(init!.headers).get("authorization"), "Bearer test-credential");
          if (url.pathname === "/v1/organization/settings")
            return Response.json({ organization: { id: organization } });
          if (url.pathname === "/v1/artifacts") {
            assert.equal(init!.method, "POST");
            assert.equal(new Headers(init!.headers).get("content-type"), "application/json");
            const body = JSON.parse(String(init!.body));
            assert.match(body.title, /^Pi session .+/);
            assert.equal(body.visibility, "organization");
            allocations.push(init!);
            const artifact = {
              id: `artifact-${artifacts.length + 1}`,
              canonical_url: `https://radius.earendil.com/artifacts/artifact-${artifacts.length + 1}`,
              expires_at: "2027-01-01T00:00:00Z",
              visibility: "organization",
              latest_version: 0,
            };
            artifacts.push(artifact);
            await allocationHook();
            return success(artifact);
          }
          const match = url.pathname.match(/^\/v1\/artifacts\/([^/]+)(\/versions)?$/)!;
          assert.ok(match, url.pathname);
          const artifact = artifacts.find((a) => a.id === match[1])!;
          assert.ok(artifact, "every request targets an allocated artifact");
          if (!match[2]) {
            assert.equal(init!.method, "GET");
            if (metadataReply) return metadataReply();
            return metadataStatus === 200
              ? success({ ...artifact, visibility })
              : new Response("private response", { status: metadataStatus });
          }
          // The external boundary observes that the destination is durable BEFORE content arrives.
          const header = JSON.parse(String(init!.body).split("\n")[0]!);
          assert.equal(url.searchParams.get("title"), `Pi session ${header.id}`);
          const db = new DatabaseSync(join(server.root, "registry.db"), { readOnly: true });
          try {
            const row = db
              .prepare("SELECT radius_share FROM sessions WHERE session_id = ?")
              .get(header.id)!;
            assert.deepEqual(JSON.parse(row.radius_share as string), {
              organizationId: organization,
              artifactId: artifact.id,
              url: artifact.canonical_url,
            });
          } finally {
            db.close();
          }
          uploads.push({ url: String(input), init: init! });
          return respond(init!.signal!, artifact);
        },
        timeoutMs: 500,
      }),
    ),
  );
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
  await register(id);
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
  signedIn = true;
  authFails = true;
  const denied = await share();
  assert.equal(denied.status, 409);
  assert.doesNotMatch(await denied.text(), /secret-token-response/);
  assert.equal(calls.length, 0);
  authFails = false;
});

test("INV-01/02/11: allocate and save a destination before publishing the redacted native branch without MCP or an agent", async () => {
  const response = await share();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    url: "https://radius.earendil.com/artifacts/artifact-1",
    expiresAt: "2027-01-01T00:00:00Z",
    visibility: "organization",
  });
  assert.equal(allocations.length, 1);
  assert.deepEqual(JSON.parse(String(allocations[0]!.body)), {
    title: "Pi session 11111111-1111-4111-8111-111111111111",
    visibility: "organization",
  });
  assert.equal(uploads.length, 1);
  const upload = uploads[0]!;
  const url = new URL(upload.url);
  assert.equal(url.pathname, "/v1/artifacts/artifact-1/versions");
  assert.equal(url.searchParams.get("visibility"), "organization");
  assert.equal(url.searchParams.get("fresh"), "1");
  assert.equal(upload.init.method, "POST");
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

test("later shares and fresh registry/sharing services publish revisions at the same URL; another session has its own destination", async () => {
  const first = await destination();
  const count = allocations.length;
  const firstVersion = artifacts[0]!.latest_version;
  writeFileSync(
    file,
    original +
      JSON.stringify({
        type: "message",
        id: "new-turn",
        parentId: "leaf",
        timestamp: "2026-10-13T01:00:00Z",
        message: { role: "user", content: "New saved turn after the first share", timestamp: 2 },
      }) +
      "\n",
  );
  const later = await share();
  assert.equal(later.status, 200);
  assert.equal((await later.json()).url, first?.url);
  // Recreate both persistence and sharing services from disk, not their in-memory state.
  const restarted = await server.run(
    Effect.flatMap(SessionSharing, (s) => s.share(server.repo, id)).pipe(
      Effect.provide(SessionSharingLive.pipe(Layer.provide(RegistryLive))),
    ),
  );
  assert.equal(restarted.url, first?.url);
  assert.equal(allocations.length, count);
  assert.equal(artifacts[0]!.latest_version, firstVersion + 2);
  assert.match(String(uploads.at(-1)!.init.body), /New saved turn after the first share/);
  assert.doesNotMatch(String(uploads[0]!.init.body), /New saved turn/);
  writeFileSync(file, original);
  await register("another-session");
  const other = await share("another-session");
  assert.equal(other.status, 200);
  assert.notEqual((await other.json()).url, first?.url);
  assert.equal(allocations.length, count + 1);
  assert.equal(JSON.parse(String(allocations.at(-1)!.body)).title, "Pi session another-session");
});

test("lookup failures other than missing, changed audiences, denied permission and different organizations never allocate replacements", async () => {
  const allocated = allocations.length,
    uploaded = uploads.length;
  for (const status of [401, 403, 429, 500, 503]) {
    metadataStatus = status;
    const response = await share();
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /saved Radius share is unavailable/);
  }
  metadataStatus = 200;
  for (const reply of [
    () => {
      throw new Error("network failure");
    },
    () => Response.json({ artifact: {} }),
    () => success({ ...artifacts[0]!, id: "mismatched" }),
  ]) {
    metadataReply = reply;
    assert.equal((await share()).status, 409);
  }
  metadataReply = undefined;
  for (const next of ["public", "private"]) {
    visibility = next;
    const response = await share();
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /visibility changed/);
  }
  visibility = "organization";
  canPublish = false;
  assert.match((await (await share()).json()).error, /cannot update/);
  canPublish = true;
  organization = "org-b";
  assert.match((await (await share()).json()).error, /different Radius organization/);
  organization = "org-a";
  assert.equal(allocations.length, allocated);
  assert.equal(uploads.length, uploaded);
  assert.equal((await share()).status, 200, "restoring access reuses the saved destination");
});

test("404 and 410 lookups replace and persist the missing artifact, then reuse the new link", async () => {
  for (const status of [404, 410]) {
    const sessionId = `missing-${status}`;
    await register(sessionId);
    assert.equal((await share(sessionId)).status, 200);
    const previous = await destination(sessionId);
    const allocated = allocations.length;
    metadataStatus = status;
    const response = await share(sessionId);
    metadataStatus = 200;
    assert.equal(response.status, 200);
    const next = await destination(sessionId);
    assert.ok(next);
    assert.notEqual(next.artifactId, previous?.artifactId);
    assert.notEqual(next.url, previous?.url);
    assert.equal((await response.json()).url, next.url);
    assert.equal(allocations.length, allocated + 1);
    const restarted = await server.run(
      Effect.flatMap(SessionSharing, (sharing) => sharing.share(server.repo, sessionId)).pipe(
        Effect.provide(SessionSharingLive.pipe(Layer.provide(RegistryLive))),
      ),
    );
    assert.equal(restarted.url, next.url);
    assert.equal(allocations.length, allocated + 1);
  }
});

test("failed replacement allocation/save preserves the old link; an uncertain new revision preserves the replacement", async () => {
  const sessionId = "replacement-failure";
  await register(sessionId);
  assert.equal((await share(sessionId)).status, 200);
  const previous = await destination(sessionId);
  const uploaded = uploads.length;
  metadataStatus = 404;
  allocationHook = async () => {
    throw new Error("allocation failed");
  };
  assert.equal((await share(sessionId)).status, 409);
  allocationHook = async () => {};
  assert.deepEqual(await destination(sessionId), previous);
  assert.equal(uploads.length, uploaded);
  const db = new DatabaseSync(join(server.root, "registry.db"));
  try {
    db.exec(
      "CREATE TRIGGER reject_replacement BEFORE UPDATE OF radius_share ON sessions WHEN NEW.session_id = 'replacement-failure' BEGIN SELECT RAISE(ABORT, 'disk failure'); END;",
    );
    assert.equal((await share(sessionId)).status, 409);
    assert.deepEqual(await destination(sessionId), previous);
    assert.equal(uploads.length, uploaded);
  } finally {
    db.exec("DROP TRIGGER reject_replacement;");
    db.close();
  }
  respond = async () => new Response("failed", { status: 503 });
  assert.equal((await share(sessionId)).status, 409);
  const replacement = await destination(sessionId);
  assert.ok(replacement);
  assert.notEqual(replacement.url, previous?.url);
  const allocated = allocations.length;
  metadataStatus = 200;
  respond = normalPublish;
  assert.equal((await (await share(sessionId)).json()).url, replacement.url);
  assert.equal(allocations.length, allocated);
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

test("concurrent publications for the same session join one revision", async () => {
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
  await new Promise((resolve) => setImmediate(resolve));
  finish(success(artifacts[0]!));
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  assert.equal(uploads.length, count + 1);
  respond = normalPublish;
});

test("failed, mismatched and timed-out revisions retain the destination and are not automatically retried", async () => {
  const saved = await destination();
  const allocated = allocations.length;
  for (const response of [
    () => new Response("secret-transcript-response", { status: 503 }),
    // A missing POST response is not a missing lookup: the next explicit share can recheck it.
    () => new Response("removed during upload", { status: 404 }),
    () => success({ ...artifacts[0]!, canonical_url: "javascript:alert(1)" }),
    () =>
      success({
        ...artifacts[0]!,
        canonical_url: "https://radius.earendil.com/artifacts/different",
        id: "different",
      }),
    () => success({ ...artifacts[0]!, visibility: "public" }),
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
  assert.equal((await share()).status, 409);
  assert.equal(aborted, true);
  respond = normalPublish;
  assert.equal((await share()).status, 200);
  assert.deepEqual(await destination(), saved);
  assert.equal(allocations.length, allocated);
});

test("an uncertain first revision still retries at its already saved URL", async () => {
  await register("first-revision-fails");
  respond = async () => new Response("failed", { status: 503 });
  assert.equal((await share("first-revision-fails")).status, 409);
  const saved = await destination("first-revision-fails");
  assert.ok(saved);
  const count = allocations.length;
  respond = normalPublish;
  const retry = await share("first-revision-fails");
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).url, saved.url);
  assert.equal(allocations.length, count);
});

test("allocation cannot upload a transcript if the destination could not be saved", async () => {
  await register("removed-during-allocation");
  const count = uploads.length;
  allocationHook = async () =>
    server.run(
      Effect.flatMap(Registry, (r) => r.removeSession(server.repo, "removed-during-allocation")),
    );
  const response = await share("removed-during-allocation");
  allocationHook = async () => {};
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /No transcript was uploaded/);
  assert.equal(uploads.length, count);
  assert.equal(artifacts.at(-1)!.latest_version, 0, "the orphan has no transcript revision");

  await register("save-error");
  const db = new DatabaseSync(join(server.root, "registry.db"));
  try {
    db.exec(
      "CREATE TRIGGER reject_share BEFORE UPDATE OF radius_share ON sessions WHEN NEW.session_id = 'save-error' BEGIN SELECT RAISE(ABORT, 'private database error'); END;",
    );
    const rejected = await share("save-error");
    assert.equal(rejected.status, 409);
    const text = await rejected.text();
    assert.match(text, /Could not save the share link/);
    assert.doesNotMatch(text, /private database error/);
    assert.equal(uploads.length, count);
    assert.equal(await destination("save-error"), undefined);
    assert.equal(artifacts.at(-1)!.latest_version, 0);
  } finally {
    db.exec("DROP TRIGGER reject_share;");
    db.close();
  }
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
