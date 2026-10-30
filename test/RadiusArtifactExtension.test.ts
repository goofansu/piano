import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionToolContext,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import radiusArtifacts from "../extensions/radius-artifacts/index.ts";
import { RadiusHttp, radiusCanary } from "./fixtures/RadiusHttp.ts";

const document = {
  operationKey: "report",
  title: "Report",
  content: "# Original",
  contentType: "text/markdown",
};
async function harness(signedIn = true) {
  const root = mkdtempSync(join(tmpdir(), "radius-extension-"));
  const runtime = await ModelRuntime.create({
    authPath: join(root, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(root, "models-store.json"),
    refreshOnCreate: false,
  });
  if (signedIn) await runtime.setRuntimeApiKey("radius", radiusCanary);
  const sessionManager = SessionManager.inMemory(root);
  const ctx = {
    sessionManager,
    modelRegistry: new ModelRegistry(runtime),
  } as unknown as ExtensionContext;
  let tools = new Map<string, ToolDefinition>();
  async function load() {
    tools = new Map();
    type Handler = (event: unknown, ctx: ExtensionContext) => Promise<void>;
    let start: Handler | undefined;
    let before: Handler | undefined;
    radiusArtifacts({
      on: (name: string, handler: Handler) => {
        if (name === "session_start") start = handler;
        if (name === "before_agent_start") before = handler;
      },
      registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
      appendEntry: (type: string, data: unknown) => sessionManager.appendCustomEntry(type, data),
    } as unknown as ExtensionAPI);
    assert.equal(tools.size, 0, "factory must not register before auth is available");
    await start!({}, ctx);
    const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
    await before!(event, ctx);
    assert.match(event.systemPromptOptions.sections.radius_artifacts, /never silently fall back/);
  }
  await load();
  const http = new RadiusHttp();
  const original = globalThis.fetch;
  globalThis.fetch = http.fetch;
  return {
    http,
    runtime,
    load,
    names: () => [...tools.keys()],
    sessionManager,
    async call(name: string, args: unknown, signal?: AbortSignal) {
      const definition = tools.get(`radius_artifact_${name}`);
      assert.ok(definition);
      const result = await definition.execute(
        "call",
        args,
        signal,
        undefined,
        ctx as ExtensionToolContext,
      );
      assert.equal(
        JSON.stringify(result).includes(radiusCanary),
        false,
        "credentials and raw errors never reach Pi history",
      );
      assert.equal(JSON.stringify(result).includes("/tmp/"), false, "no local-file delivery");
      return result.structuredContent as Record<string, unknown>;
    },
    cleanup() {
      globalThis.fetch = original;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("signed-out sessions register no artifact tools; signed-in sessions register create/update/view", async () => {
  const h = await harness(false);
  try {
    assert.deepEqual(h.names(), []);
    await h.runtime.setRuntimeApiKey("radius", radiusCanary);
    await h.load();
    assert.deepEqual(h.names(), [
      "radius_artifact_create",
      "radius_artifact_update",
      "radius_artifact_view",
    ]);
    await h.runtime.removeRuntimeApiKey("radius");
    const result = await h.call("create", document);
    assert.equal(result.status, "error");
    assert.match(String(result.message), /signed out/);
    assert.equal(h.http.writes.length, 0);
    await h.load();
    assert.deepEqual(h.names(), []);
  } finally {
    h.cleanup();
  }
});

test("create confirms a private Radius publication; update retains identity and visibility; view reads pinned content", async () => {
  const h = await harness();
  try {
    const created = await h.call("create", document);
    assert.deepEqual(created, {
      status: "confirmed",
      message: "Radius publication confirmed.",
      artifactId: "artifact-1",
      url: "https://radius.pi.dev/artifacts/artifact-1",
      revision: 1,
      latestRevision: 1,
      visibility: "private",
      expiresAt: "2027-01-01T00:00:00Z",
    });
    assert.equal(
      h.http.writes[0].args.visibility,
      "private",
      "override a public organization default",
    );
    await h.load(); // Pi-owned intent survives extension reload, not an extension singleton.
    assert.deepEqual(await h.call("create", document), created);
    assert.equal(h.http.writes.length, 1);
    h.http.artifacts.get("artifact-1")!.visibility = "organization";
    const updated = await h.call("update", {
      ...document,
      operationKey: "report-revision-2",
      content: "# Revised",
      artifactId: "artifact-1",
      expectedRevision: 1,
    });
    assert.equal(updated.status, "confirmed");
    assert.equal(updated.artifactId, created.artifactId);
    assert.equal(updated.url, created.url);
    assert.equal(updated.revision, 2);
    assert.equal(updated.visibility, "organization");
    assert.equal(h.http.writes[1].args.visibility, undefined, "updates do not set visibility");
    const viewed = await h.call("view", { artifactId: "artifact-1" });
    assert.equal(viewed.content, "# Revised");
    assert.equal(viewed.url, created.url);
    assert.equal(
      (await h.call("view", { artifactId: "artifact-1", revision: 1 })).content,
      "# Original",
    );
    assert.equal(h.http.writes.length, 2, "view never mutates");
  } finally {
    h.cleanup();
  }
});

test("a lost create reply remains unknown across reload and never causes a duplicate", async () => {
  const h = await harness();
  try {
    h.http.fail = "lost-create";
    assert.equal((await h.call("create", document)).status, "unknown");
    assert.equal(h.http.artifacts.size, 1, "the server committed despite the lost reply");
    h.http.fail = "none";
    await h.load();
    assert.equal((await h.call("create", document)).status, "unknown");
    assert.equal(h.http.writes.length, 1);
    assert.equal((await h.call("create", { ...document, content: "Other" })).status, "error");
    assert.equal(h.http.writes.length, 1);
  } finally {
    h.cleanup();
  }
});

test("a lost update reply is reconciled by its pinned revision, never by replay", async () => {
  const h = await harness();
  try {
    await h.call("create", document);
    h.http.fail = "lost-update";
    const params = {
      ...document,
      operationKey: "revision",
      content: "Revised",
      artifactId: "artifact-1",
      expectedRevision: 1,
    };
    const result = await h.call("update", params);
    assert.equal(result.status, "confirmed");
    assert.equal(result.revision, 2);
    await h.load();
    assert.deepEqual(await h.call("update", params), result);
    assert.equal(h.http.writes.length, 2);
    assert.equal(
      (await h.call("update", { ...params, operationKey: "another", content: "Stale" })).status,
      "error",
    );
    assert.equal(h.http.writes.length, 2, "stale expectedRevision cannot overwrite a new revision");
    h.http.artifacts.get("artifact-1")!.versions[1].note = "another-writer";
    assert.equal((await h.call("update", params)).status, "unknown");
    assert.equal(
      h.http.writes.length,
      2,
      "another writer's revision is not ours or a reason to replay",
    );
  } finally {
    h.cleanup();
  }
});

test("a publication Radius does not advertise is never sent, so the same key publishes later", async () => {
  const h = await harness();
  try {
    h.http.unadvertised.add("artifacts.create");
    const refused = await h.call("create", document);
    assert.equal(refused.status, "error");
    assert.match(String(refused.message), /does not advertise/);
    h.http.unadvertised.clear();
    const created = await h.call("create", document);
    assert.equal(created.status, "confirmed");
    const params = {
      ...document,
      operationKey: "revision",
      content: "Revised",
      artifactId: created.artifactId,
      expectedRevision: 1,
    };
    h.http.unadvertised.add("artifacts.versions.publish");
    assert.equal((await h.call("update", params)).status, "error");
    h.http.unadvertised.clear();
    assert.equal((await h.call("update", params)).status, "confirmed");
    assert.equal(h.http.writes.length, 2);
  } finally {
    h.cleanup();
  }
});

test("rejected writes, malformed replies, wrong identity and unsafe URLs never masquerade as publication", async () => {
  const h = await harness();
  try {
    h.http.fail = "malformed-create";
    assert.equal((await h.call("create", document)).status, "unknown");
    h.http.fail = "none";
    const created = await h.call("create", { ...document, operationKey: "second" });
    const params = {
      ...document,
      operationKey: "update",
      artifactId: created.artifactId,
      expectedRevision: 1,
    };
    h.http.fail = "rejected-update";
    assert.equal((await h.call("update", params)).status, "unknown");
    h.http.fail = "none";
    assert.equal((await h.call("update", params)).status, "unknown");
    assert.equal(h.http.writes.length, 3, "even a rejected write is not blindly retried");
    h.http.wrongIdentity = true;
    assert.equal((await h.call("view", { artifactId: created.artifactId })).status, "error");
    h.http.wrongIdentity = false;
    h.http.unsafeUrl = true;
    assert.equal((await h.call("view", { artifactId: created.artifactId })).status, "error");
    h.http.unsafeUrl = false;
    h.http.denied = true;
    const denied = await h.call("view", { artifactId: created.artifactId });
    assert.equal(denied.status, "error");
    assert.match(String(denied.message), /authentication|permission/);
  } finally {
    h.cleanup();
  }
});

test("pre-aborted work cannot publish or expose a transfer credential", async () => {
  const h = await harness();
  try {
    const result = await h.call("create", document, AbortSignal.abort());
    assert.notEqual(result.status, "confirmed");
    assert.equal(h.http.writes.length, 0);
  } finally {
    h.cleanup();
  }
});
