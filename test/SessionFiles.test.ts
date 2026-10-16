import assert from "node:assert/strict";
import { test } from "node:test";
import type { RenderMsg } from "../shared/wire.ts";
import { displayPath, sessionFiles, splitPath, visibleFiles } from "../web/src/lib/sessionFiles.ts";

const call = (id: string, name: string, args: Record<string, unknown>) => ({
  id,
  name,
  args: JSON.stringify(args),
});
const assistant = (id: string, toolCalls: ReturnType<typeof call>[]): RenderMsg => ({
  id,
  role: "assistant",
  text: "",
  toolCalls,
});
const result = (toolCallId: string, isError = false): RenderMsg => ({
  id: `r-${toolCallId}`,
  role: "tool_result",
  text: "",
  toolCallId,
  isError,
});

test("files are the successful writes and edits, in conversation order, each path once at its latest touch", () => {
  const files = sessionFiles([
    assistant("a1", [
      call("c1", "write", { path: "src/a.ts", content: "" }),
      call("c2", "read", { path: "src/skip.ts" }),
      call("c3", "edit", { path: "/abs/b.ts", oldText: "x", newText: "y" }),
    ]),
    result("c1"),
    result("c2"),
    result("c3"),
    assistant("a2", [
      call("c4", "edit", { path: "src/a.ts", oldText: "x", newText: "y" }),
      call("c5", "bash", { command: "echo hi > src/c.ts" }),
    ]),
    result("c4"),
    result("c5"),
  ]);
  assert.deepEqual(files, [
    { path: "/abs/b.ts", messageId: "a1" },
    { path: "src/a.ts", messageId: "a2" },
  ]);
});

test("a failed or unfinished call touched nothing", () => {
  const files = sessionFiles([
    assistant("a1", [
      call("c1", "edit", { path: "src/missing.ts", oldText: "x", newText: "y" }),
      call("c2", "write", { path: "src/pending.ts", content: "" }),
      call("c3", "write", { path: "", content: "" }),
    ]),
    result("c1", true),
    assistant("a2", [call("c4", "write", { path: "src/ok.ts", content: "" })]),
    result("c4"),
  ]);
  assert.deepEqual(files, [{ path: "src/ok.ts", messageId: "a2" }]);
});

test("a path splits into its name and directory", () => {
  assert.deepEqual(splitPath("src/lib/a.ts"), { name: "a.ts", dir: "src/lib" });
  assert.deepEqual(splitPath("README.md"), { name: "README.md", dir: "" });
});

test("a path inside the session's directory shows relative to it; one outside keeps its own form", () => {
  const abbrev = (p: string) => p.replace("/Users/someone", "~");
  assert.equal(displayPath("/work/api/src/a.ts", "/work/api", abbrev), "src/a.ts");
  assert.equal(displayPath("/work/api/src/a.ts", "/work/api/", abbrev), "src/a.ts");
  assert.equal(displayPath("src/a.ts", "/work/api", abbrev), "src/a.ts");
  assert.equal(displayPath("/work/apix/a.ts", "/work/api", abbrev), "/work/apix/a.ts");
  assert.equal(displayPath("/Users/someone/notes.md", "/work/api", abbrev), "~/notes.md");
  assert.equal(displayPath("/work/api/a.ts", undefined, abbrev), "/work/api/a.ts");
});

test("Git's answer hides ignored and outside paths; without one, or after a failed read, every file shows", () => {
  const files = [
    { path: "src/a.ts", messageId: "a1" },
    { path: "scratch/notes.md", messageId: "a1" },
    { path: "/elsewhere/x.ts", messageId: "a2" },
  ];
  const workspace = { id: "w", folder: "/work/api", path: "/work/api" };
  const ready = {
    workspace,
    observedAt: "now",
    result: {
      status: "ready" as const,
      ignored: ["scratch/notes.md"],
      outside: ["/elsewhere/x.ts"],
    },
  };
  assert.deepEqual(visibleFiles(files, ready), [{ path: "src/a.ts", messageId: "a1" }]);
  assert.deepEqual(visibleFiles(files, undefined), files);
  assert.deepEqual(
    visibleFiles(files, { workspace, observedAt: "now", result: { status: "error", detail: "x" } }),
    files,
  );
});
