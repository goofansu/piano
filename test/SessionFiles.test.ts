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
  const shown = (path: string, cwd: string | undefined) => displayPath({ path }, cwd, abbrev);
  assert.equal(shown("/work/api/src/a.ts", "/work/api"), "src/a.ts");
  assert.equal(shown("/work/api/src/a.ts", "/work/api/"), "src/a.ts");
  assert.equal(shown("src/a.ts", "/work/api"), "src/a.ts");
  assert.equal(shown("/work/apix/a.ts", "/work/api"), "/work/apix/a.ts");
  assert.equal(shown("/Users/someone/notes.md", "/work/api"), "~/notes.md");
  assert.equal(shown("/work/api/a.ts", undefined), "/work/api/a.ts");
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
      inside: ["src/a.ts", "scratch/notes.md"],
      placed: ["src/a.ts", "scratch/notes.md"],
    },
  };
  const a = { path: "src/a.ts", messageId: "a1", placed: "src/a.ts" };
  assert.deepEqual(visibleFiles(files, ready, workspace), [a]);
  assert.deepEqual(visibleFiles(files, undefined, workspace), files);
  assert.deepEqual(
    visibleFiles(
      files,
      { workspace, observedAt: "now", result: { status: "error", detail: "x" } },
      workspace,
    ),
    files,
  );
  // A cached answer may span path-set refreshes, but never workspace identity (INV-07).
  for (const current of [
    undefined,
    { ...workspace, id: "other" },
    { ...workspace, path: "/work/other" },
  ]) {
    assert.deepEqual(visibleFiles(files, ready, current), files);
  }
  const added = { path: "src/new.ts", messageId: "a3" };
  assert.deepEqual(visibleFiles([...files, added], ready, workspace), [a, added]);
});

test("one file under several spellings is one entry at its latest touch once Git's answer places them", () => {
  const spellings = ["src/a.ts", "/tmp/repo/src/a.ts", "./src/a.ts", "/private/tmp/repo/src/a.ts"];
  const files = sessionFiles([
    ...spellings.flatMap((path, i) => [
      assistant(`a${i}`, [call(`c${i}`, "edit", { path, oldText: "x", newText: "y" })]),
      result(`c${i}`),
    ]),
    assistant("a9", [call("c9", "write", { path: "src/b.ts", content: "" })]),
    result("c9"),
  ]);
  const workspace = { id: "w", folder: "/tmp/repo", path: "/tmp/repo" };
  const abbrev = (p: string) => p;
  const shown = (list: ReturnType<typeof visibleFiles>) =>
    list.map((file) => [file.path, displayPath(file, "/tmp/repo", abbrev)]);
  // Before an answer, the text rule: each spelling once, inside the directory relative to it.
  assert.deepEqual(shown(visibleFiles(files, undefined, workspace)), [
    ["src/a.ts", "src/a.ts"],
    ["/tmp/repo/src/a.ts", "src/a.ts"],
    ["./src/a.ts", "./src/a.ts"],
    ["/private/tmp/repo/src/a.ts", "/private/tmp/repo/src/a.ts"],
    ["src/b.ts", "src/b.ts"],
  ]);
  const ready = {
    workspace,
    observedAt: "now",
    result: {
      status: "ready" as const,
      ignored: [],
      outside: [],
      inside: [...spellings, "src/b.ts"],
      placed: ["src/a.ts", "src/a.ts", "src/a.ts", "src/a.ts", "src/b.ts"],
    },
  };
  // The latest touch's spelling is kept, so opening sends a path the call named.
  assert.deepEqual(shown(visibleFiles(files, ready, workspace)), [
    ["/private/tmp/repo/src/a.ts", "src/a.ts"],
    ["src/b.ts", "src/b.ts"],
  ]);
  // A spelling the answer does not cover yet keeps the text rule until a fresh answer.
  const stale = {
    ...ready,
    result: { ...ready.result, inside: spellings.slice(0, 2), placed: ["src/a.ts", "src/a.ts"] },
  };
  assert.deepEqual(shown(visibleFiles(files, stale, workspace)), [
    ["/tmp/repo/src/a.ts", "src/a.ts"],
    ["./src/a.ts", "./src/a.ts"],
    ["/private/tmp/repo/src/a.ts", "/private/tmp/repo/src/a.ts"],
    ["src/b.ts", "src/b.ts"],
  ]);
});
