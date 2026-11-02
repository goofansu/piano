import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import pianoLibrary from "../extensions/piano-library/index.ts";
import { Endpoints } from "../shared/http.ts";

function environment(t: TestContext, configured: boolean) {
  const previous = { ...process.env };
  t.after(() => {
    process.env = previous;
  });
  if (configured) {
    process.env.PIANO_SESSION_WS_URL = "ws://127.0.0.1:45678/ws";
    process.env.PIANO_SESSION_ORIGIN = "http://127.0.0.1:45678";
  } else {
    delete process.env.PIANO_SESSION_WS_URL;
  }
}

for (const kind of ["skill", "prompt"] as const) {
  test(`registered ${kind} read returns complete Piano content, distinguishes absence and refuses paths`, async (t) => {
    environment(t, true);
    const tools = new Map<string, ToolDefinition>();
    pianoLibrary({
      registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    } as unknown as ExtensionAPI);
    const tool = tools.get(`piano_read_${kind}`);
    assert.ok(tool);
    const file = `---\ndescription: Keep all details\n---\n\nEcho $@ exactly.\n\nPreserve this second paragraph.\n`;
    const entry = {
      name: "echo",
      description: "Keep all details",
      file,
      ...(kind === "skill" ? { disableModelInvocation: true } : {}),
    };
    const requests: string[] = [];
    t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
      requests.push(url.href);
      assert.equal(
        url.pathname,
        kind === "skill" ? Endpoints.userSkills.path : Endpoints.prompts.path,
      );
      assert.equal(init.method, "GET", "reads never mutate the library");
      return Response.json([entry, { ...entry, name: "echo-other", file: "not this entry" }]);
    });
    const call = (name: string, signal?: AbortSignal) =>
      tool.execute("read", { name }, signal, undefined, {} as ExtensionToolContext);
    const result = await call("echo");
    assert.deepEqual(result.structuredContent, { status: "found", kind, ...entry });
    assert.deepEqual(
      JSON.parse((result.content[0] as { text: string }).text),
      result.structuredContent,
    );
    assert.deepEqual((await call("project-only")).structuredContent, {
      status: "not_found",
      kind,
      name: "project-only",
    });
    const count = requests.length;
    for (const name of ["../echo", "/tmp/echo", "echo/SKILL.md", "", "a".repeat(65)]) {
      assert.equal(((await call(name)).structuredContent as { status: string }).status, "refused");
    }
    assert.equal(requests.length, count, "invalid names do not initiate any lookup");
    t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
    await assert.rejects(call("echo"), /Could not load/);
    t.mock.method(globalThis, "fetch", async (_url: URL, init: RequestInit) => {
      init.signal?.throwIfAborted();
      throw new Error("unexpected unaborted request");
    });
    await assert.rejects(call("echo", AbortSignal.abort()), { name: "AbortError" });
  });
}

test("library tools are not registered outside Piano launch configuration", (t) => {
  environment(t, false);
  const tools: string[] = [];
  pianoLibrary({
    registerTool: (tool: ToolDefinition) => tools.push(tool.name),
  } as unknown as ExtensionAPI);
  assert.deepEqual(tools, []);
});
