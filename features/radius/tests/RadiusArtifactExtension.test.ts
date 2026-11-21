import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  constants,
  mkdtempSync,
  openSync,
  readFileSync,
  statSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validateToolArguments } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionToolContext,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { RadiusArtifactResult } from "../../../shared/radius/radiusArtifacts.ts";
import { RadiusHttp, radiusCanary } from "../../../test/shared/RadiusHttp.ts";
import radiusArtifacts from "../extension/index.ts";

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
    cwd: root,
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
    assert.match(
      event.systemPromptOptions.sections.radius_artifacts,
      /long document[^.]*by path[^.]*rather than passing it as content/,
    );
  }
  await load();
  const http = new RadiusHttp();
  const original = globalThis.fetch;
  globalThis.fetch = http.fetch;
  return {
    root,
    http,
    runtime,
    load,
    names: () => [...tools.keys()],
    sessionManager,
    async call(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
      const definition = tools.get(`radius_artifact_${name}`);
      assert.ok(definition);
      const result = await definition.execute(
        "call",
        validateToolArguments(definition, {
          type: "toolCall",
          id: "call",
          name: definition.name,
          arguments: JSON.parse(JSON.stringify(args)),
        }),
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
      const modelText = result.content[0];
      assert.equal(modelText.type, "text");
      assert.deepEqual(JSON.parse(modelText.text), result.structuredContent);
      return result.structuredContent as RadiusArtifactResult;
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
    await h.load();
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
    assert.equal(viewed.path, "index.md");
    assert.equal(viewed.offset, 0);
    assert.equal(viewed.nextOffset, null);
    assert.equal(viewed.totalBytes, 9);
    assert.equal(viewed.url, created.url);
    assert.equal(
      (await h.call("view", { artifactId: "artifact-1", revision: 1 })).content,
      "# Original",
    );
    assert.equal(h.http.writes.length, 2, "view never mutates");
    const receipts = h.sessionManager
      .getBranch()
      .filter(
        (entry) => entry.type === "custom" && entry.customType === "radius-artifact-publication-v1",
      );
    assert.deepEqual(
      receipts.map((entry) => entry.type === "custom" && entry.data),
      [
        {
          artifactId: "artifact-1",
          title: "Report",
          url: created.url,
          revision: 1,
          operationKey: "report",
        },
        {
          artifactId: "artifact-1",
          title: "Report",
          url: created.url,
          revision: 2,
          operationKey: "report-revision-2",
        },
      ],
      "only verified publications leave small receipts; retries and views do not",
    );
  } finally {
    h.cleanup();
  }
});

test("view reconstructs a large single line in bounded UTF-8 pages pinned across newer revisions", async () => {
  const h = await harness();
  try {
    const created = await h.call("create", document);
    const artifact = h.http.artifacts.get(created.artifactId!)!;
    const original = "a".repeat(16383) + "🌍é中".repeat(20000);
    artifact.versions[0].content = original;
    const first = await h.call("view", { artifactId: created.artifactId });
    assert.equal(first.status, "confirmed", first.message);
    assert.equal(first.content, "a".repeat(16383), "the default page stops before a split emoji");
    assert.equal(first.path, "index.md");
    assert.equal(first.offset, 0);
    assert.equal(first.nextOffset, 16383);
    assert.equal(first.totalBytes, Buffer.byteLength(original));
    artifact.versions.push({
      note: "newer",
      content: "New revision",
      content_type: "text/markdown",
    });
    artifact.latest_version = 2;
    const pieces = [first.content];
    let offset: number | null = first.nextOffset;
    while (offset !== null) {
      assert.equal(typeof offset, "number");
      const page = await h.call("view", {
        artifactId: first.artifactId,
        revision: first.revision,
        path: first.path,
        offset,
        maxBytes: 32768,
      });
      assert.equal(page.status, "confirmed", page.message);
      assert.equal(page.revision, 1);
      assert.equal(page.latestRevision, 2);
      assert.equal(page.path, first.path);
      assert.equal(page.offset, offset);
      assert.equal(page.totalBytes, first.totalBytes);
      assert.equal(typeof page.content, "string");
      const bytes = Buffer.byteLength(page.content!);
      assert.ok(bytes > 0 && bytes <= 32768);
      assert.ok(!page.content!.includes("�"));
      if (page.nextOffset !== null) assert.equal(page.nextOffset, offset! + bytes);
      else assert.equal(offset! + bytes, page.totalBytes);
      pieces.push(page.content!);
      offset = page.nextOffset;
    }
    assert.equal(pieces.join(""), original);
    assert.equal((await h.call("view", { artifactId: first.artifactId })).content, "New revision");
    assert.equal(h.http.writes.length, 1, "pages never publish or mutate the artifact");
  } finally {
    h.cleanup();
  }
});

test("view defines UTF-8 byte boundaries, EOF and invalid page arguments", async () => {
  const h = await harness();
  try {
    await h.call("create", document);
    const version = h.http.artifacts.get("artifact-1")!.versions[0];
    version.content = "é中🌍";
    const args = { artifactId: "artifact-1", revision: 1, maxBytes: 4 };
    for (const [offset, content, nextOffset] of [
      [0, "é", 2],
      [2, "中", 5],
      [5, "🌍", null],
      [9, "", null],
    ] as const) {
      const page = await h.call("view", { ...args, offset });
      assert.equal(page.status, "confirmed", page.message);
      assert.equal(page.content, content);
      assert.equal(page.offset, offset);
      assert.equal(page.nextOffset, nextOffset);
      assert.equal(page.totalBytes, 9);
    }
    for (const [offset, message] of [
      [1, /inside a UTF-8 codepoint/],
      [10, /beyond the end/],
    ] as const) {
      const page = await h.call("view", { ...args, offset });
      assert.equal(page.status, "error");
      assert.match(page.message, message);
      assert.equal(page.content, undefined);
    }
    const unpinned = await h.call("view", { artifactId: "artifact-1", offset: 2 });
    assert.equal(unpinned.status, "error");
    assert.match(unpinned.message, /requires revision/);
    for (const invalid of [{ offset: -1 }, { maxBytes: 0 }, { maxBytes: 3 }, { maxBytes: 32769 }])
      await assert.rejects(
        h.call("view", { ...args, ...invalid }),
        /Validation failed/,
        JSON.stringify(invalid),
      );
    version.content = "";
    const empty = await h.call("view", args);
    assert.equal(empty.status, "confirmed");
    assert.equal(empty.content, "");
    assert.equal(empty.offset, 0);
    assert.equal(empty.totalBytes, 0);
    assert.equal(empty.nextOffset, null);
  } finally {
    h.cleanup();
  }
});

test("view pages a 25 MiB file, the largest one shared or published, and bounds content even when JSON escaping expands it", async () => {
  const h = await harness();
  try {
    await h.call("create", document);
    const version = h.http.artifacts.get("artifact-1")!.versions[0];
    version.content_type = "application/x-ndjson";
    version.content = '{"message":"' + "s".repeat(25 * 1024 * 1024 - 15) + '"}\n';
    assert.equal(Buffer.byteLength(version.content), 25 * 1024 * 1024);
    for (const offset of [0, 5 * 1024 * 1024, 25 * 1024 * 1024 - 20]) {
      const page = await h.call("view", { artifactId: "artifact-1", revision: 1, offset });
      assert.equal(page.status, "confirmed", page.message);
      assert.equal(page.content, version.content.slice(offset, offset + 16384));
      assert.equal(page.totalBytes, 25 * 1024 * 1024);
      assert.equal(page.nextOffset, offset + 16384 < page.totalBytes! ? offset + 16384 : null);
      assert.ok(
        Buffer.byteLength(JSON.stringify(page)) < 18000,
        "the downloaded file is not returned wholesale",
      );
    }
    version.content = "\u0000".repeat(65536);
    const escaped = await h.call("view", { artifactId: "artifact-1", maxBytes: 32768 });
    assert.equal(escaped.content, "\u0000".repeat(5461));
    assert.equal(escaped.nextOffset, 5461);
    assert.ok(
      Buffer.byteLength(JSON.stringify(escaped)) < 32768 + 1024,
      "JSON-escaped page text stays within 32 KiB, plus metadata",
    );
    version.content = "\n".repeat(16383) + "🌍tail";
    const unicode = await h.call("view", { artifactId: "artifact-1", maxBytes: 32768 });
    assert.equal(unicode.content, "\n".repeat(16383));
    assert.equal(unicode.nextOffset, 16383, "the JSON budget also stops before a split codepoint");
    const tail = await h.call("view", {
      artifactId: "artifact-1",
      revision: 1,
      offset: unicode.nextOffset,
    });
    assert.equal(tail.content, "🌍tail");
    assert.equal(tail.nextOffset, null);
    assert.equal(h.http.writes.length, 1);
  } finally {
    h.cleanup();
  }
});

test(
  "view caps streamed downloads at 25 MiB, cancels oversized bodies and rejects invalid UTF-8",
  { timeout: 10000 },
  async () => {
    const h = await harness();
    try {
      await h.call("create", document);
      let bytes = 25 * 1024 * 1024;
      let cancelled = false;
      let invalidUtf8 = false;
      globalThis.fetch = async (input, init) => {
        if (new URL(String(input)).pathname !== "/transfer") return h.http.fetch(input, init);
        let sent = 0;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (invalidUtf8) {
                controller.enqueue(new Uint8Array([0xff]));
                controller.close();
              } else if (sent < bytes) {
                const size = Math.min(64 * 1024, bytes - sent);
                controller.enqueue(Buffer.alloc(size, "x"));
                sent += size;
              } else if (bytes === 25 * 1024 * 1024) controller.close();
            },
            cancel() {
              cancelled = true;
            },
          }),
        );
      };
      const args = { artifactId: "artifact-1", revision: 1, offset: bytes - 4, maxBytes: 4 };
      const boundary = await h.call("view", args);
      assert.equal(boundary.status, "confirmed", boundary.message);
      assert.equal(boundary.content, "xxxx");
      assert.equal(boundary.nextOffset, null);
      assert.equal(boundary.totalBytes, bytes, "actual streamed bytes, not manifest size");
      bytes++;
      const tooLarge = await h.call("view", args);
      assert.equal(tooLarge.status, "error");
      assert.match(tooLarge.message, /25 MiB download limit/);
      assert.equal(tooLarge.content, undefined);
      assert.equal(cancelled, true, "over-limit bodies stop downloading without waiting for EOF");
      invalidUtf8 = true;
      const invalid = await h.call("view", { artifactId: "artifact-1" });
      assert.equal(invalid.status, "error");
      assert.match(invalid.message, /not valid UTF-8/);
    } finally {
      h.cleanup();
    }
  },
);

test(
  "view aborts an in-progress content download without returning partial text or credentials",
  { timeout: 10000 },
  async () => {
    const h = await harness();
    try {
      await h.call("create", document);
      const abort = new AbortController();
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      let downloadSignal: AbortSignal | null | undefined;
      globalThis.fetch = async (input, init) => {
        if (new URL(String(input)).pathname !== "/transfer") return h.http.fetch(input, init);
        downloadSignal = init?.signal;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(Buffer.from("Partial content"));
              downloadSignal!.addEventListener(
                "abort",
                () => controller.error(new Error(radiusCanary)),
                { once: true },
              );
              started();
            },
          }),
        );
      };
      const pending = h.call("view", { artifactId: "artifact-1" }, abort.signal);
      await ready;
      abort.abort();
      const interrupted = await pending;
      assert.equal(downloadSignal?.aborted, true);
      assert.equal(interrupted.status, "error");
      assert.equal(interrupted.content, undefined);
      assert.match(interrupted.message, /interrupted/);
    } finally {
      h.cleanup();
    }
  },
);

test("view keeps manifest-only results and path selection; publication accepts a document up to 25 MiB", async () => {
  const h = await harness();
  try {
    await h.call("create", document);
    h.http.artifacts.get("artifact-1")!.versions[0].content_type = "image/png";
    const view = await h.call("view", { artifactId: "artifact-1" });
    assert.equal(view.status, "confirmed");
    assert.equal(view.files?.length, 1);
    assert.equal(view.content, undefined);
    assert.equal(view.nextOffset, undefined, "manifest-only is not text EOF");
    h.http.files = [];
    const noFiles = await h.call("view", { artifactId: "artifact-1" });
    assert.deepEqual(noFiles.files, []);
    assert.equal(noFiles.content, undefined);
    h.http.files = [
      { path: "image.png", content_type: "image/png", stored_bytes: 10 },
      { path: "report.md", content_type: "text/markdown", stored_bytes: 10 },
    ];
    const manifest = await h.call("view", { artifactId: "artifact-1" });
    assert.deepEqual(manifest.files, h.http.files);
    assert.equal(manifest.content, undefined);
    const missing = await h.call("view", { artifactId: "artifact-1", path: "missing.md" });
    assert.equal(missing.status, "error");
    const selected = await h.call("view", {
      artifactId: "artifact-1",
      path: "report.md",
      maxBytes: 4,
    });
    assert.equal(selected.content, "# Or");
    assert.equal(selected.path, "report.md");
    assert.equal(selected.nextOffset, 4);
    const large = await h.call("create", {
      ...document,
      operationKey: "large",
      content: "é".repeat((25 * 1024 * 1024) / 2),
    });
    assert.equal(large.status, "confirmed", large.message);
    assert.equal(h.http.writes.length, 2);
    const tooLarge = await h.call("create", {
      ...document,
      operationKey: "too-large",
      content: "é".repeat((25 * 1024 * 1024) / 2 + 1),
    });
    assert.equal(tooLarge.status, "error");
    assert.match(tooLarge.message, /25 MiB publication limit/);
    assert.equal(h.http.writes.length, 2);
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
    assert.equal(
      h.sessionManager
        .getBranch()
        .some(
          (entry) =>
            entry.type === "custom" && entry.customType === "radius-artifact-publication-v1",
        ),
      false,
      "an intent with an external commit is still not confirmation",
    );
  } finally {
    h.cleanup();
  }
});

test("a known identity is not a receipt until confirmation reads succeed; reconciliation records it once", async () => {
  const h = await harness();
  const large = { ...document, content: "x".repeat(121000) };
  const receipts = () =>
    h.sessionManager
      .getBranch()
      .filter(
        (entry) => entry.type === "custom" && entry.customType === "radius-artifact-publication-v1",
      );
  try {
    h.http.wrongIdentity = true;
    assert.equal((await h.call("create", large)).status, "unknown");
    assert.equal(receipts().length, 0);
    assert.ok(
      h.sessionManager
        .getBranch()
        .some(
          (entry) =>
            entry.type === "custom" &&
            entry.customType === "radius-artifact-intent-v1" &&
            (entry.data as { id?: string }).id === "artifact-1",
        ),
    );
    h.http.wrongIdentity = false;
    await h.load();
    assert.equal((await h.call("create", large)).status, "confirmed");
    assert.equal((await h.call("create", large)).status, "confirmed");
    assert.equal(h.http.writes.length, 1);
    assert.equal(receipts().length, 1);
    assert.ok(
      JSON.stringify(receipts()).length < 1000,
      "document content never enters the receipt",
    );
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
    h.http.unsafeUrl = `https://attacker.example/${radiusCanary}`;
    assert.equal((await h.call("view", { artifactId: created.artifactId })).status, "error");
    h.http.unsafeUrl = undefined;
    h.http.denied = true;
    const denied = await h.call("view", { artifactId: created.artifactId });
    assert.equal(denied.status, "error");
    assert.match(String(denied.message), /authentication|permission/);
  } finally {
    h.cleanup();
  }
});

test("view keeps strict viewing links but accepts root paths and fragments in trusted download URLs", async () => {
  const h = await harness();
  try {
    const created = await h.call("create", document);
    const transfers: string[] = [];
    globalThis.fetch = async (input, init) => {
      if (new URL(String(input)).pathname !== "/mcp") transfers.push(String(input));
      return h.http.fetch(input, init);
    };
    for (const url of [
      "https://radius.pi.dev/",
      "https://radius.pi.dev.evil.example/x",
      "https://radius.pi.dev/x?next=1",
      "https://radius.pi.dev/x#fragment",
    ]) {
      h.http.unsafeUrl = url;
      assert.equal((await h.call("view", { artifactId: created.artifactId })).status, "error", url);
    }
    h.http.unsafeUrl = undefined;
    assert.equal(transfers.length, 0, "an untrusted viewing link stops before any download");
    const signed = `https://radius.pi.dev/transfer?id=${created.artifactId}&revision=1&secret=${radiusCanary}`;
    for (const url of [
      `https://radius.pi.dev.evil.example/transfer?id=${created.artifactId}&revision=1`,
      signed.replace("https:", "http:"),
      signed.replace("https://", "https://user@"),
      signed.replace("https://", "https://:password@"),
      signed.replace("radius.pi.dev", "radius.pi.dev:8443"),
    ]) {
      h.http.downloadUrl = url;
      assert.equal((await h.call("view", { artifactId: created.artifactId })).status, "error", url);
    }
    assert.deepEqual(transfers, [], "an untrusted download URL is never fetched");
    const accepted = [signed, signed.replace("/transfer?", "/?"), `${signed}#fragment`];
    for (const url of accepted) {
      h.http.downloadUrl = url;
      const viewed = await h.call("view", { artifactId: created.artifactId });
      assert.equal(viewed.status, "confirmed", url);
      assert.equal(viewed.content, document.content);
      assert.equal(viewed.url, created.url, "the viewing link is not the transfer URL");
    }
    assert.deepEqual(transfers, accepted, "accepted transfer URLs reach the download unchanged");
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

test("create and update publish a local file by path, absolute or relative to the working directory", async () => {
  const h = await harness();
  try {
    const page = `<!doctype html><p>${"é".repeat(200 * 1024)}</p>`;
    writeFileSync(join(h.root, "report.html"), page);
    const { content: _content, ...byPath } = { ...document, contentType: "text/html" };
    const created = await h.call("create", { ...byPath, path: "report.html" });
    assert.equal(created.status, "confirmed", created.message);
    assert.equal(h.http.writes.at(-1)?.args.content, page, "the file's exact text is published");
    assert.equal(h.http.writes.at(-1)?.args.content_type, "text/html");

    const revised = `${page}<p>revised</p>`;
    writeFileSync(join(h.root, "report.html"), revised);
    const updated = await h.call("update", {
      ...byPath,
      operationKey: "report-2",
      path: join(h.root, "report.html"),
      artifactId: created.artifactId,
      expectedRevision: 1,
    });
    assert.equal(updated.status, "confirmed", updated.message);
    assert.equal(updated.revision, 2);
    assert.equal(h.http.writes.at(-1)?.args.content, revised);

    const stale = await h.call("create", { ...byPath, path: "report.html" });
    assert.equal(stale.status, "error");
    assert.match(stale.message, /operationKey belongs to different content/);
    assert.equal(h.http.writes.length, 2, "a changed file is not republished under a used key");
  } finally {
    h.cleanup();
  }
});

test("a path that is ambiguous, unreadable, empty, not UTF-8 or over 25 MiB publishes nothing", async () => {
  const h = await harness();
  try {
    const { content: _content, ...byPath } = document;
    writeFileSync(join(h.root, "empty.md"), "");
    writeFileSync(join(h.root, "binary.md"), Buffer.from([0x23, 0xff]));
    const fullText = "é".repeat((25 * 1024 * 1024) / 2);
    writeFileSync(join(h.root, "full.md"), fullText);
    writeFileSync(join(h.root, "large.md"), "");
    truncateSync(join(h.root, "large.md"), 25 * 1024 * 1024 + 1);
    for (const [args, refusal] of [
      [{ ...document, path: "empty.md" }, /exactly one of content or path/],
      [byPath, /exactly one of content or path/],
      [{ ...byPath, path: "missing.md" }, /could not be read/],
      [{ ...byPath, path: "." }, /not a regular file/],
      [{ ...byPath, path: "empty.md" }, /file is empty/],
      [{ ...byPath, path: "binary.md" }, /not valid UTF-8/],
      [{ ...byPath, path: "large.md" }, /25 MiB publication limit/],
    ] as const) {
      const refused = await h.call("create", args);
      assert.equal(refused.status, "error");
      assert.match(refused.message, refusal);
      assert.equal(JSON.stringify(refused).includes(h.root), false, "no local path in the result");
    }
    assert.equal(h.http.writes.length, 0);
    const full = await h.call("create", { ...byPath, path: "full.md" });
    assert.equal(full.status, "confirmed", full.message);
    assert.equal(h.http.writes.length, 1, "a file of exactly 25 MiB is published");
    assert.equal(h.http.writes[0].args.content, fullText, "the file's exact text is published");
  } finally {
    h.cleanup();
  }
});

const intents = (h: Awaited<ReturnType<typeof harness>>) =>
  h.sessionManager
    .getBranch()
    .filter((entry) => entry.type === "custom" && entry.customType === "radius-artifact-intent-v1");

test(
  "a FIFO or directory path is refused at once without waiting for a writer",
  { timeout: 10000 },
  async () => {
    const h = await harness();
    const fifo = join(h.root, "pipe.md");
    execFileSync("mkfifo", [fifo]);
    try {
      const { content: _content, ...byPath } = document;
      for (const path of ["pipe.md", "."]) {
        const refused = await h.call("create", { ...byPath, path });
        assert.equal(refused.status, "error");
        assert.match(refused.message, /not a regular file; nothing was published/);
        assert.equal(
          JSON.stringify(refused).includes(h.root),
          false,
          "no local path in the result",
        );
      }
      assert.equal(h.http.writes.length, 0);
      assert.equal(intents(h).length, 0);
    } finally {
      // Releases a reader blocked in open(2) on the FIFO if the refusal regresses.
      try {
        closeSync(openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK));
      } catch {}
      h.cleanup();
    }
  },
);

async function growsOnceSized(path: string, bytes: Buffer) {
  const target = statSync(path);
  const probe = await open(path);
  const proto: { stat: typeof probe.stat } = Object.getPrototypeOf(probe);
  await probe.close();
  const stat = proto.stat;
  let grown = false;
  proto.stat = async function (this: typeof probe, ...args: Parameters<typeof probe.stat>) {
    const stats = await stat.apply(this, args);
    if (!grown && stats.dev === target.dev && stats.ino === target.ino) {
      grown = true;
      appendFileSync(path, bytes);
    }
    return stats;
  } as typeof probe.stat;
  return { grown: () => grown, restore: () => void (proto.stat = stat) };
}

test("a file that grows while it is read, below or past 25 MiB, publishes nothing; the same file at rest publishes", async () => {
  const h = await harness();
  const path = join(h.root, "growing.md");
  const { content: _content, ...byPath } = document;
  try {
    for (const [start, added, refusal] of [
      [20 * 1024 * 1024, 4 * 1024, /changed while reading; nothing was published/],
      [25 * 1024 * 1024, 1, /25 MiB publication limit/],
    ] as const) {
      writeFileSync(path, Buffer.alloc(start, "x"));
      const growth = await growsOnceSized(path, Buffer.alloc(added, "y"));
      let refused: RadiusArtifactResult;
      try {
        refused = await h.call("create", { ...byPath, path: "growing.md" });
      } finally {
        growth.restore();
      }
      assert.equal(growth.grown(), true, "the file grew after the reader took its size");
      assert.equal(refused.status, "error");
      assert.match(refused.message, refusal);
      assert.equal(JSON.stringify(refused).includes(h.root), false, "no local path");
    }
    assert.equal(h.http.writes.length, 0);
    assert.equal(intents(h).length, 0);

    for (const size of [20 * 1024 * 1024, 20 * 1024 * 1024 + 4 * 1024]) {
      const text = "x".repeat(size);
      writeFileSync(path, text);
      const published = await h.call("create", {
        ...byPath,
        operationKey: `stable-${size}`,
        path: "growing.md",
      });
      assert.equal(published.status, "confirmed", published.message);
      assert.equal(h.http.writes.at(-1)?.args.content, text, "a file at rest publishes exactly");
    }
    assert.equal(h.http.writes.length, 2);
  } finally {
    h.cleanup();
  }
});

test("cancelling while a file is read publishes and records nothing", async () => {
  const h = await harness();
  try {
    writeFileSync(join(h.root, "full.md"), Buffer.alloc(25 * 1024 * 1024, "x"));
    const controller = new AbortController();
    globalThis.fetch = async (input, init) => {
      const response = await h.http.fetch(input, init);
      // The tools/list reply settles in microtasks, so this timer fires once connect has
      // finished and the file open is in flight.
      if (String(init?.body).includes('"tools/list"')) setTimeout(() => controller.abort(), 0);
      return response;
    };
    const { content: _content, ...byPath } = document;
    const cancelled = await h.call("create", { ...byPath, path: "full.md" }, controller.signal);
    assert.equal(cancelled.status, "error");
    assert.match(cancelled.message, /cancelled; nothing was published/);
    assert.equal(JSON.stringify(cancelled).includes(h.root), false, "no local path in the result");
    assert.equal(h.http.writes.length, 0);
    assert.equal(intents(h).length, 0, "a cancelled read records no publication intent");
  } finally {
    h.cleanup();
  }
});

test("a symlink before `..` in a path publishes the file the OS reads there, or nothing", async () => {
  const h = await harness();
  try {
    mkdirSync(join(h.root, "archive/build-2"), { recursive: true });
    symlinkSync(join(h.root, "archive/build-2"), join(h.root, "current"));
    const target = join(h.root, "archive/report.md");
    writeFileSync(join(h.root, "report.md"), "draft in working directory\n");
    const { content: _content, ...byPath } = document;
    const spellings = ["current/../report.md", `${h.root}/current/../report.md`];
    const native = (path: string) =>
      readFileSync(path.startsWith("/") ? path : `${h.root}/${path}`, "utf8");
    let artifactId: string | undefined;
    let revision = 0;
    for (const [index, path] of spellings.entries()) {
      writeFileSync(target, `report from build archive ${index}\n`);
      assert.equal(native(path), `report from build archive ${index}\n`, path);
      const created = await h.call("create", { ...byPath, operationKey: `create-${index}`, path });
      assert.equal(created.status, "confirmed", created.message);
      assert.equal(h.http.writes.at(-1)?.args.content, native(path), path);

      writeFileSync(target, `revised build archive ${index}\n`);
      const updated = await h.call("update", {
        ...byPath,
        operationKey: `update-${index}`,
        path,
        artifactId: created.artifactId,
        expectedRevision: created.revision,
      });
      assert.equal(updated.status, "confirmed", updated.message);
      assert.equal(h.http.writes.at(-1)?.args.content, native(path), path);
      artifactId = updated.artifactId;
      revision = updated.revision!;
    }

    rmSync(target);
    for (const [index, path] of spellings.entries()) {
      const writes = h.http.writes.length;
      const created = await h.call("create", { ...byPath, operationKey: `gone-${index}`, path });
      assert.equal(created.status, "error");
      assert.match(created.message, /could not be read/);
      const updated = await h.call("update", {
        ...byPath,
        operationKey: `gone-update-${index}`,
        path,
        artifactId,
        expectedRevision: revision,
      });
      assert.equal(updated.status, "error");
      assert.match(updated.message, /could not be read/);
      assert.equal(h.http.writes.length, writes, "no artifact mutation for this attempt");
    }
  } finally {
    h.cleanup();
  }
});
