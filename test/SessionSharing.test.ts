import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Effect, Layer } from "effect";
import { Registry } from "../server/Registry.ts";
import { SessionShareAuth } from "../server/SessionSharing.ts";
import { SESSION_SHARE_MAX_BYTES, SHARE_NOT_SENT, SHARE_UNCONFIRMED } from "../shared/share.ts";
import { RadiusHttp, radiusCanary } from "./fixtures/RadiusHttp.ts";
import { startRouter } from "./fixtures/router.ts";

test("Share uploads the registered saved file once, with owner auth and private visibility", async (t) => {
  let credential: string | undefined = radiusCanary;
  let authReads = 0;
  const server = await startRouter(
    "piano-share-",
    Layer.succeed(SessionShareAuth, async () => {
      authReads++;
      return credential;
    }),
  );
  t.after(() => server.dispose());
  const http = new RadiusHttp();
  const original = globalThis.fetch;
  globalThis.fetch = http.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const id = "saved-session";
  await server.run(
    Effect.flatMap(Registry, (registry) => registry.addSession(server.repo, id, "Saved session")),
  );
  const file = join(server.root, "sessions", "saved.jsonl");
  const content =
    [
      { type: "session", version: 3, id, cwd: server.repo },
      {
        type: "message",
        id: "branch-a",
        parentId: null,
        message: { role: "user", content: "token=synthetic-sensitive-value" },
      },
      {
        type: "message",
        id: "branch-b",
        parentId: null,
        message: { role: "toolResult", content: "other branch output" },
      },
    ]
      .map((value) => JSON.stringify(value))
      .join("\n") + "\n";
  await writeFile(file, content);
  const path = `/api/session/share?workspaceId=${server.workspaceId}&sessionId=${id}`;
  const share = (url = path, body: unknown = { confirmed: true }) =>
    server.handle(url, { method: "POST", body: JSON.stringify(body) });

  await t.test(
    "confirmation and registered identity are required before reading credentials or uploading",
    async () => {
      assert.equal((await share(path, {})).status, 400);
      assert.equal((await share(path.replace(id, "missing"))).status, 404);
      assert.equal((await server.handle(path)).status, 404);
      assert.equal(authReads, 0);
      assert.equal(http.writes.length, 0);
    },
  );
  await t.test(
    "exact full JSONL, private visibility requested, fresh artifact for each explicit share",
    async () => {
      for (const n of [1, 2]) {
        const response = await share();
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.deepEqual(await response.json(), {
          status: "shared",
          share: {
            url: `https://radius.pi.dev/artifacts/artifact-${n}`,
            visibility: "private",
            expiresAt: "2027-01-01T00:00:00Z",
          },
        });
        assert.equal(http.writes.length, n);
        assert.deepEqual(http.writes[n - 1], {
          operation: "artifacts.create",
          args: {
            title: "Saved session",
            content,
            content_type: "application/x-ndjson",
            visibility: "private",
            fresh: 1,
          },
        });
      }
    },
  );
  await t.test("missing and rejected auth guide sign-in without a mutation", async () => {
    const before = http.writes.length;
    credential = undefined;
    assert.deepEqual(await (await share()).json(), { status: "sign-in-required" });
    credential = radiusCanary;
    http.denied = true;
    assert.deepEqual(await (await share()).json(), { status: "sign-in-required" });
    http.denied = false;
    assert.equal(http.writes.length, before);
  });
  await t.test("incomplete, wrong-session, oversized and missing files never upload", async () => {
    const reads = authReads;
    const before = http.writes.length;
    for (const invalid of [
      content + '{"type":',
      content.replace(`"id":"${id}"`, '"id":"another"'),
      content + " ".repeat(SESSION_SHARE_MAX_BYTES),
      Buffer.concat([Buffer.from(content), Buffer.from([0xff])]),
    ]) {
      await writeFile(file, invalid);
      const response = await share();
      assert.equal(response.status, 409);
      const text = await response.text();
      assert.ok(!text.includes(server.root));
    }
    await rm(file);
    assert.equal((await share()).status, 409);
    assert.equal(authReads, reads);
    assert.equal(http.writes.length, before);
    await writeFile(file, content);
  });
  await t.test(
    "lost and malformed replies are unconfirmed, with no replay or leaked provider details",
    async () => {
      for (const failure of ["lost-create", "malformed-create"] as const) {
        http.fail = failure;
        const before = http.writes.length;
        const response = await share();
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), { error: SHARE_UNCONFIRMED });
        assert.equal(http.writes.length, before + 1);
      }
      http.fail = "none";
    },
  );
  await t.test(
    "failures before the create request is sent are a definite refusal, not uncertainty",
    async () => {
      const before = http.writes.length;
      const methods: string[] = [];
      globalThis.fetch = async (input, init) => {
        const request = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        if (request.method) methods.push(request.method);
        if (request.method === "initialize") return new Response(null, { status: 503 });
        return http.fetch(input, init);
      };
      const unreachable = await share();
      globalThis.fetch = http.fetch;
      assert.equal(unreachable.status, 409);
      assert.deepEqual(await unreachable.json(), { error: SHARE_NOT_SENT });
      assert.ok(!methods.includes("tools/call"));

      http.unadvertised.add("artifacts.create");
      const unadvertised = await share();
      http.unadvertised.delete("artifacts.create");
      assert.equal(unadvertised.status, 409);
      assert.deepEqual(await unadvertised.json(), { error: SHARE_NOT_SENT });
      assert.equal(http.writes.length, before);
    },
  );
  await t.test(
    "untrusted viewing URLs, redirects and oversized replies are not confirmation",
    async () => {
      const untrusted: Record<string, string> = {
        url: `https://attacker.example/${radiusCanary}`,
        root: "https://radius.pi.dev/",
        lookalike: "https://radius.pi.dev.evil.example/x",
      };
      for (const mode of [
        ...Object.keys(untrusted),
        "redirect",
        "oversize",
        "scratch",
        "timeout",
      ]) {
        let creates = 0;
        globalThis.fetch = async (input, init) => {
          const reply = await http.fetch(input, init);
          const request = typeof init?.body === "string" ? JSON.parse(init.body) : {};
          if (request.params?.name !== "artifacts.create") return reply;
          creates++;
          if (mode === "timeout")
            throw new DOMException("Synthetic provider timeout", "TimeoutError");
          if (mode === "redirect")
            return new Response(null, {
              status: 302,
              headers: { location: "https://attacker.example" },
            });
          const json = await reply.json();
          if (mode === "oversize") json.result.padding = "x".repeat(4 * 1024 * 1024);
          else if (mode === "scratch") json.result.structuredContent.artifact.latest_version = 0;
          else json.result.structuredContent.artifact.canonical_url = untrusted[mode];
          return Response.json(json);
        };
        const response = await share();
        assert.equal(response.status, 409, mode);
        assert.deepEqual(await response.json(), { error: SHARE_UNCONFIRMED });
        assert.equal(creates, 1);
      }
      globalThis.fetch = http.fetch;
    },
  );
  await t.test(
    "overlapping confirmed clicks are refused rather than queued for another upload",
    async () => {
      let release!: () => void;
      let arrived!: () => void;
      const waiting = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      globalThis.fetch = async (input, init) => {
        const request = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        if (request.params?.name === "artifacts.create") {
          arrived();
          await hold;
        }
        return http.fetch(input, init);
      };
      const first = share();
      let timer: ReturnType<typeof setTimeout>;
      try {
        await Promise.race([
          waiting,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("Upload never reached Radius")), 2000);
          }),
        ]);
        const other = await share();
        assert.equal(other.status, 409);
        assert.match((await other.json()).error, /in progress/);
      } finally {
        clearTimeout(timer!);
        release();
      }
      assert.equal((await first).status, 200);
    },
  );
});
