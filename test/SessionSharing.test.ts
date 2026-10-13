import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import { Effect, Layer } from "effect";
import { ProviderLoginRuntime } from "../server/ProviderLogin.ts";
import {
  type RadiusArtifact,
  RadiusArtifacts,
  RadiusArtifactsError,
} from "../server/RadiusArtifacts.ts";
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
/** How the saved artifact's lookup answers instead of confirming it. */
let lookupReply: "missing" | RadiusArtifactsError | undefined;
let canPublish = true;
let allocationHook: () => Effect.Effect<void, RadiusArtifactsError> = () => Effect.void;
type Artifact = { id: string; url: string; expiresAt: string; versions: string[] };
/** Radius's state, as an in-memory adapter keeps it. */
const artifacts: Artifact[] = [];
const allocations: string[] = [];
const uploads: { artifactId: string; title: string; content: string }[] = [];
const calls: string[] = [];
const confirmed = (artifact: Artifact): RadiusArtifact => ({
  id: artifact.id,
  url: artifact.url,
  expiresAt: artifact.expiresAt,
  canPublishRevision: canPublish,
});
const normalPublish = (artifact: Artifact, content: string) =>
  Effect.sync(() => {
    artifact.versions.push(content);
    return confirmed(artifact);
  });
let respond: (
  artifact: Artifact,
  content: string,
) => Effect.Effect<RadiusArtifact, RadiusArtifactsError> = normalPublish;
const radiusFailure = (reason: RadiusArtifactsError["reason"], status?: number) =>
  new RadiusArtifactsError({ reason, ...(status ? { status } : {}) });
const id = "11111111-1111-4111-8111-111111111111";
const allocated = (artifactId: string) => {
  const artifact = artifacts.find((a) => a.id === artifactId);
  assert.ok(artifact, "every request targets an allocated artifact");
  return artifact;
};
const call = (name: string, token: string) => {
  calls.push(name);
  assert.equal(token, "test-credential");
};
const FakeRadius = Layer.succeed(
  RadiusArtifacts,
  RadiusArtifacts.of({
    organization: (token) =>
      Effect.sync(() => {
        call("organization", token);
        return organization;
      }),
    lookup: (token, link) =>
      Effect.suspend(() => {
        call("lookup", token);
        const artifact = allocated(link.artifactId);
        if (lookupReply === "missing") return Effect.succeed(undefined);
        return lookupReply ? Effect.fail(lookupReply) : Effect.succeed(confirmed(artifact));
      }),
    allocate: (token, title) =>
      Effect.suspend(() => {
        call("allocate", token);
        allocations.push(title);
        const artifactId = `artifact-${artifacts.length + 1}`;
        const artifact = {
          id: artifactId,
          url: `https://radius.earendil.com/artifacts/${artifactId}`,
          expiresAt: "2027-01-01T00:00:00Z",
          versions: [],
        };
        artifacts.push(artifact);
        return allocationHook().pipe(Effect.as(confirmed(artifact)));
      }),
    publishVersion: (token, link, title, content) =>
      Effect.suspend(() => {
        call("publishVersion", token);
        const artifact = allocated(link.artifactId);
        assert.deepEqual(link, {
          organizationId: organization,
          artifactId: artifact.id,
          url: artifact.url,
        });
        // Radius observes that the destination is durable BEFORE content arrives.
        const header = JSON.parse(content.split("\n")[0]!);
        assert.equal(title, `Pi session ${header.id}`);
        const db = new DatabaseSync(join(server.root, "registry.db"), { readOnly: true });
        try {
          const row = db
            .prepare("SELECT radius_share FROM sessions WHERE session_id = ?")
            .get(header.id)!;
          assert.deepEqual(JSON.parse(row.radius_share as string), link);
        } finally {
          db.close();
        }
        uploads.push({ artifactId: artifact.id, title, content });
        return respond(artifact, content);
      }),
  }),
);
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
/** The reference the router resolves; a restarted service must find it still current. */
const reference = (sessionId = id) =>
  server.run(
    Effect.flatMap(Registry, (registry) =>
      Effect.map(registry.get, (data) => data.sessions.find((s) => s.sessionId === sessionId)!),
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
      FakeRadius,
      Layer.succeed(SharingEnvironment, { timeoutMs: 500 }),
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
  assert.deepEqual(allocations, ["Pi session 11111111-1111-4111-8111-111111111111"]);
  assert.deepEqual(calls, ["organization", "allocate", "publishVersion"]);
  assert.equal(uploads.length, 1);
  const upload = uploads[0]!;
  assert.equal(upload.artifactId, "artifact-1");
  assert.doesNotMatch(upload.content, /abandoned|sk-secret-example|test-credential/);
  const lines = upload.content
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

/** A sharing service recreated, with its registry, from disk rather than in-memory state. */
const restartedShare = async (sessionId = id) => {
  const session = await reference(sessionId);
  return server.run(
    Effect.flatMap(SessionSharing, (sharing) => sharing.share(session)).pipe(
      Effect.provide(SessionSharingLive.pipe(Layer.provide(Layer.merge(RegistryLive, FakeRadius)))),
    ),
  );
};

test("later shares and fresh registry/sharing services publish revisions at the same URL; another session has its own destination", async () => {
  const first = await destination();
  const count = allocations.length;
  const firstVersion = artifacts[0]!.versions.length;
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
  assert.equal((await restartedShare()).url, first?.url);
  assert.equal(allocations.length, count);
  assert.equal(artifacts[0]!.versions.length, firstVersion + 2);
  assert.match(uploads.at(-1)!.content, /New saved turn after the first share/);
  assert.doesNotMatch(uploads[0]!.content, /New saved turn/);
  writeFileSync(file, original);
  await register("another-session");
  const other = await share("another-session");
  assert.equal(other.status, 200);
  assert.notEqual((await other.json()).url, first?.url);
  assert.equal(allocations.length, count + 1);
  assert.equal(allocations.at(-1), "Pi session another-session");
});

test("lookup failures other than missing, changed audiences, denied permission and different organizations never allocate replacements", async () => {
  const allocated = allocations.length,
    uploaded = uploads.length;
  // Denied or failing statuses, transport failures, and malformed or mismatched replies.
  for (const failure of [
    radiusFailure("request", 401),
    radiusFailure("request", 503),
    radiusFailure("request"),
    radiusFailure("response"),
  ]) {
    lookupReply = failure;
    const response = await share();
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /saved Radius share is unavailable/);
  }
  lookupReply = radiusFailure("visibility");
  const changed = await share();
  assert.equal(changed.status, 409);
  assert.match((await changed.json()).error, /visibility changed/);
  lookupReply = undefined;
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

test("a missing lookup replaces and persists the artifact, then reuses the new link", async () => {
  const sessionId = "missing-artifact";
  await register(sessionId);
  assert.equal((await share(sessionId)).status, 200);
  const previous = await destination(sessionId);
  const allocated = allocations.length;
  lookupReply = "missing";
  const response = await share(sessionId);
  lookupReply = undefined;
  assert.equal(response.status, 200);
  const next = await destination(sessionId);
  assert.ok(next);
  assert.notEqual(next.artifactId, previous?.artifactId);
  assert.notEqual(next.url, previous?.url);
  assert.equal((await response.json()).url, next.url);
  assert.equal(allocations.length, allocated + 1);
  assert.equal((await restartedShare(sessionId)).url, next.url);
  assert.equal(allocations.length, allocated + 1);
});

test("failed replacement allocation/save preserves the old link; an uncertain new revision preserves the replacement", async () => {
  const sessionId = "replacement-failure";
  await register(sessionId);
  assert.equal((await share(sessionId)).status, 200);
  const previous = await destination(sessionId);
  const uploaded = uploads.length;
  lookupReply = "missing";
  allocationHook = () => Effect.fail(radiusFailure("request", 500));
  assert.equal((await share(sessionId)).status, 409);
  allocationHook = () => Effect.void;
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
  respond = () => Effect.fail(radiusFailure("request", 503));
  assert.equal((await share(sessionId)).status, 409);
  const replacement = await destination(sessionId);
  assert.ok(replacement);
  assert.notEqual(replacement.url, previous?.url);
  const allocated = allocations.length;
  lookupReply = undefined;
  respond = normalPublish;
  assert.equal((await (await share(sessionId)).json()).url, replacement.url);
  assert.equal(allocations.length, allocated);
});

test("legacy history is migrated for export without rewriting Pi's file", async () => {
  const legacy = original.replace('"version":3', '"version":2');
  writeFileSync(file, legacy);
  assert.equal((await share()).status, 200);
  assert.equal(readFileSync(file, "utf8"), legacy);
  assert.match(uploads.at(-1)!.content, /"version":3/);
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
  let finish!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const completed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  respond = (artifact) =>
    Effect.promise(() => {
      started();
      return completed;
    }).pipe(Effect.as(confirmed(artifact)));
  const count = uploads.length;
  const first = share();
  await began;
  const second = share();
  await new Promise((resolve) => setImmediate(resolve));
  finish();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  assert.equal(uploads.length, count + 1);
  respond = normalPublish;
});

test("failed, mismatched and timed-out revisions retain the destination and are not automatically retried", async () => {
  const saved = await destination();
  const allocated = allocations.length;
  for (const failure of [
    radiusFailure("request", 503),
    // A missing POST response is not a missing lookup: the next explicit share can recheck it.
    radiusFailure("request", 404),
    // An unsafe URL or another artifact's identity.
    radiusFailure("response"),
    radiusFailure("visibility"),
  ]) {
    respond = () => Effect.fail(failure);
    const count = uploads.length;
    const failed = await share();
    assert.equal(failed.status, 409);
    assert.match((await failed.json()).error, /Check Radius artifacts/);
    assert.equal(uploads.length, count + 1);
  }
  let interrupted = false;
  respond = () =>
    Effect.never.pipe(
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          interrupted = true;
        }),
      ),
    );
  assert.equal((await share()).status, 409);
  assert.equal(interrupted, true);
  respond = normalPublish;
  assert.equal((await share()).status, 200);
  assert.deepEqual(await destination(), saved);
  assert.equal(allocations.length, allocated);
});

test("an uncertain first revision still retries at its already saved URL", async () => {
  await register("first-revision-fails");
  respond = () => Effect.fail(radiusFailure("request", 503));
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
  allocationHook = () =>
    Effect.promise(() =>
      server.run(
        Effect.flatMap(Registry, (r) => r.removeSession(server.repo, "removed-during-allocation")),
      ),
    );
  const response = await share("removed-during-allocation");
  allocationHook = () => Effect.void;
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /No transcript was uploaded/);
  assert.equal(uploads.length, count);
  assert.deepEqual(artifacts.at(-1)!.versions, [], "the orphan has no transcript revision");

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
    assert.deepEqual(artifacts.at(-1)!.versions, []);
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
