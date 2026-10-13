import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Layer } from "effect";
import {
  RadiusArtifacts,
  type RadiusArtifactsError,
  RadiusArtifactsLive,
  RadiusFetch,
} from "../server/RadiusArtifacts.ts";

const requests: { url: URL; init: RequestInit }[] = [];
let reply: (url: URL, init: RequestInit) => Response | Promise<Response> = () =>
  Response.json({ organization: { id: "org-a" } });
const Live = RadiusArtifactsLive.pipe(
  Layer.provide(
    Layer.succeed(RadiusFetch, async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url, init: init! });
      return reply(url, init!);
    }),
  ),
);
const radius = <A, E>(use: (radius: RadiusArtifacts["Service"]) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flatMap(RadiusArtifacts, use).pipe(Effect.provide(Live)));
const failed = <A>(
  use: (radius: RadiusArtifacts["Service"]) => Effect.Effect<A, RadiusArtifactsError>,
) => radius((r) => Effect.flip(use(r)));

const link = {
  organizationId: "org-a",
  artifactId: "artifact-1",
  url: "https://radius.earendil.com/artifacts/artifact-1",
};
const artifact = (fields: Record<string, unknown> = {}) =>
  Response.json({
    artifact: {
      id: link.artifactId,
      canonical_url: link.url,
      expires_at: "2027-01-01T00:00:00Z",
      visibility: "organization",
      ...fields,
    },
  });
/** A non-OK reply whose body would leak if delivered; records whether it was discarded. */
const secret = (status: number) => {
  const body = { cancelled: false };
  const response = new Response(
    new ReadableStream({
      start: (controller) => controller.enqueue(new TextEncoder().encode("secret-body")),
      cancel: () => {
        body.cancelled = true;
      },
    }),
    { status },
  );
  return { response, body };
};

test("INV-11: every call goes to Pi's Radius gateway with the bearer and without following redirects", async () => {
  requests.length = 0;
  reply = () => Response.json({ organization: { id: "org-a" } });
  assert.equal(await radius((r) => r.organization("token-1")), "org-a");
  reply = (url) =>
    url.pathname === "/v1/artifacts"
      ? artifact({ capabilities: { publish_revision: false } })
      : artifact();
  assert.deepEqual(await radius((r) => r.allocate("token-1", "Pi session one")), {
    id: link.artifactId,
    url: link.url,
    expiresAt: "2027-01-01T00:00:00Z",
    canPublishRevision: false,
  });
  assert.equal((await radius((r) => r.lookup("token-1", link)))?.canPublishRevision, true);
  await radius((r) => r.publishVersion("token-1", link, "Pi session one", '{"type":"session"}\n'));

  for (const { url, init } of requests) {
    assert.equal(url.origin, "https://radius.pi.dev");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer token-1");
  }
  const [organization, allocate, lookup, publish] = requests;
  assert.deepEqual(
    requests.map(({ url, init }) => `${init.method} ${url.pathname}`),
    [
      "GET /v1/organization/settings",
      "POST /v1/artifacts",
      "GET /v1/artifacts/artifact-1",
      "POST /v1/artifacts/artifact-1/versions",
    ],
  );
  assert.ok(organization && lookup);
  assert.equal(new Headers(allocate!.init.headers).get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(allocate!.init.body)), {
    title: "Pi session one",
    visibility: "organization",
  });
  assert.equal(new Headers(publish!.init.headers).get("content-type"), "application/x-ndjson");
  assert.equal(publish!.init.body, '{"type":"session"}\n');
  assert.equal(publish!.url.searchParams.get("visibility"), "organization");
  assert.equal(publish!.url.searchParams.get("fresh"), "1");
  assert.equal(publish!.url.searchParams.get("title"), "Pi session one");
});

test("only a 404 or 410 lookup reports a missing artifact; non-OK bodies are discarded unread", async () => {
  for (const status of [404, 410]) {
    reply = () => new Response(null, { status });
    assert.equal(await radius((r) => r.lookup("token", link)), undefined);
  }
  for (const status of [401, 403, 429, 500, 503]) {
    const { response, body } = secret(status);
    reply = () => response;
    const error = await failed((r) => r.lookup("token", link));
    assert.equal(error.reason, "request");
    assert.equal(error.status, status);
    assert.equal(body.cancelled, true);
    assert.doesNotMatch(JSON.stringify(error) + String(error), /secret-body/);
  }
  // A missing upload target is a failed publication, not a missing lookup.
  const { response, body } = secret(404);
  reply = () => response;
  const missing = await failed((r) => r.publishVersion("token", link, "title", "content"));
  assert.equal(missing.status, 404);
  assert.equal(body.cancelled, true);
  reply = () => {
    throw new Error("network failure secret-body");
  };
  const network = await failed((r) => r.organization("token"));
  assert.equal(network.reason, "request");
  assert.doesNotMatch(JSON.stringify(network) + String(network), /secret-body/);
  reply = () => new Response("not json");
  assert.equal((await failed((r) => r.allocate("token", "title"))).reason, "request");
});

test("only HTTPS Radius URLs without credentials or port, with a valid expiry, confirm an artifact", async () => {
  for (const host of ["radius.pi.dev", "radius.earendil.com"]) {
    reply = () => artifact({ canonical_url: `https://${host}/artifacts/a` });
    assert.equal(
      (await radius((r) => r.allocate("token", "title"))).url,
      `https://${host}/artifacts/a`,
    );
  }
  for (const fields of [
    { canonical_url: "javascript:alert(1)" },
    { canonical_url: "not a url" },
    { canonical_url: "http://radius.pi.dev/artifacts/a" },
    { canonical_url: "https://radius.pi.dev:8443/artifacts/a" },
    { canonical_url: "https://user:pass@radius.pi.dev/artifacts/a" },
    { canonical_url: "https://radius.pi.dev.example.com/artifacts/a" },
    { expires_at: "never" },
    { id: "" },
    { visibility: "everyone" },
  ]) {
    reply = () => artifact(fields);
    assert.equal(
      (await failed((r) => r.allocate("token", "title"))).reason,
      "response",
      JSON.stringify(fields),
    );
  }
  reply = () => Response.json({ artifact: {} });
  assert.equal((await failed((r) => r.allocate("token", "title"))).reason, "response");
  reply = () => Response.json({ organization: { id: "" } });
  assert.equal((await failed((r) => r.organization("token"))).reason, "response");
});

test("lookups and versions must confirm the linked artifact's identity and organization visibility", async () => {
  for (const fields of [
    { id: "different" },
    { canonical_url: "https://radius.earendil.com/artifacts/different" },
    { canonical_url: "https://radius.pi.dev/artifacts/artifact-1" },
  ]) {
    reply = () => artifact(fields);
    assert.equal((await failed((r) => r.lookup("token", link))).reason, "response");
    assert.equal(
      (await failed((r) => r.publishVersion("token", link, "title", "content"))).reason,
      "response",
    );
  }
  for (const visibility of ["public", "private"]) {
    reply = () => artifact({ visibility });
    assert.equal((await failed((r) => r.lookup("token", link))).reason, "visibility");
    assert.equal((await failed((r) => r.allocate("token", "title"))).reason, "visibility");
    assert.equal(
      (await failed((r) => r.publishVersion("token", link, "title", "content"))).reason,
      "visibility",
    );
  }
});

test("interrupting a call aborts its request", async () => {
  let aborted = false;
  reply = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal!.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
  await radius((r) =>
    r
      .publishVersion("token", link, "title", "content")
      .pipe(Effect.timeout("10 millis"), Effect.exit),
  );
  assert.equal(aborted, true);
});
