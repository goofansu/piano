import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChangeFile, WorkspaceChanges } from "../shared/wire.ts";
import {
  allCollapsed, askText, changedFile, checkWorkspaceResponse, fileMessage, initialDisclosure, isOpen,
  refreshKey, seedFiles, setOpen, summary, toggleAll,
} from "../web/src/lib/changesView.ts";

const workspace = { id: "w1", path: "/repo" };
const patch = (path: string, added: number) => [
  `diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, `@@ -0,0 +1,${added} @@`,
  ...Array.from({ length: added }, (_, i) => `+line ${i}`),
].join("\n") + "\n";
const meta = (path: string, additions: number): ChangeFile => ({ path, additions, deletions: 0, binary: false });
const changes = (files: [string, number][], { truncated = false, diff = files.map(([p, n]) => patch(p, n)).join(""), at = workspace } = {}): WorkspaceChanges => ({
  workspace: { ...at, folder: "/repo" }, observedAt: "2026-10-11T10:00:00.000Z",
  result: { status: "ready", head: "abc", branch: "main", files: files.map(([p, n]) => meta(p, n)), diff, truncated },
});
const ready = (value: WorkspaceChanges) => checkWorkspaceResponse(workspace, value).result;

test("only a new checkout-changing tool result or a streaming change asks for a re-read", () => {
  const msg = (id: string, role: "assistant" | "tool_result", toolName?: string) => ({ id, role, toolName });
  const session = (messages: ReturnType<typeof msg>[], isStreaming = false) => ({ messages, state: { isStreaming } });
  const base = refreshKey(session([msg("1", "tool_result", "edit")]));
  assert.equal(refreshKey(session([msg("1", "tool_result", "edit"), msg("2", "tool_result", "read"), msg("3", "assistant")])), base);
  assert.notEqual(refreshKey(session([msg("1", "tool_result", "edit"), msg("2", "tool_result", "bash")])), base);
  assert.notEqual(refreshKey(session([msg("1", "tool_result", "edit")], true)), base);
});

test("a response for another workspace, or a failed read, is rejected", () => {
  assert.throws(() => checkWorkspaceResponse(workspace, changes([["a.ts", 1]], { at: { id: "w2", path: "/repo" } })), /different workspace/);
  assert.throws(() => checkWorkspaceResponse(workspace, changes([["a.ts", 1]], { at: { id: "w1", path: "/elsewhere" } })), /different workspace/);
  assert.throws(() => changedFile(workspace, changes([["a.ts", 1]], { at: { id: "w2", path: "/repo" } }), "a.ts"), /another workspace/);
  const failed: WorkspaceChanges = { ...changes([]), result: { status: "error", detail: "not a git repository" } };
  assert.throws(() => checkWorkspaceResponse(workspace, failed), /not a git repository/);
});

test("a file read yields the requested file, or says why it cannot", () => {
  const loaded = changedFile(workspace, changes([["a.ts", 2], ["b.ts", 1]]), "b.ts");
  assert.equal(loaded.file.path, "b.ts");
  assert.equal(loaded.file.additions, 1);
  assert.throws(() => changedFile(workspace, changes([["a.ts", 2]]), "gone.ts"), /metadata is unavailable/);
  assert.throws(() => changedFile(workspace, changes([["a.ts", 2]], { diff: "" }), "a.ts"), /no longer has a diff/);
  assert.throws(() => changedFile(workspace, changes([["a.ts", 2]], { diff: "", truncated: true }), "a.ts"), /too large/);
});

test("a truncated initial read never seeds a partial last file", () => {
  const value = changes([["a.ts", 1], ["b.ts", 3]], { truncated: true, diff: patch("a.ts", 1) + patch("b.ts", 3).split("\n").slice(0, 5).join("\n") });
  const seed = seedFiles(ready(value));
  assert.deepEqual([...seed.keys()], ["a.ts"]);
  assert.deepEqual([...seedFiles(ready(changes([["a.ts", 1], ["b.ts", 3]]))).keys()], ["a.ts", "b.ts"]);
  assert.equal(isOpen(initialDisclosure, "b.ts", seed), false, "an unseeded file starts closed");
});

test("small seeded files start open; large ones start folded until expanded", () => {
  const value = changes([["small.ts", 3], ["large.ts", 801]]);
  const seed = seedFiles(ready(value)), files = value.result.status === "ready" ? value.result.files : [];
  assert.equal(isOpen(initialDisclosure, "small.ts", seed), true);
  assert.equal(isOpen(initialDisclosure, "large.ts", seed), false);
  assert.equal(isOpen(setOpen(initialDisclosure, "large.ts", true), "large.ts", seed), true);
  assert.equal(allCollapsed(initialDisclosure, files, seed), false);
});

test("Collapse all then Expand all opens every file, large ones included", () => {
  const value = changes([["small.ts", 3], ["large.ts", 801]]);
  const seed = seedFiles(ready(value)), files = value.result.status === "ready" ? value.result.files : [];
  const folded = toggleAll(initialDisclosure, files, seed);
  assert.equal(allCollapsed(folded, files, seed), true);
  const expanded = toggleAll(folded, files, seed);
  assert.deepEqual(files.map(f => isOpen(expanded, f.path, seed)), [true, true]);
});

test("a refresh keeps a collapsed file collapsed and an opened large file open", () => {
  const before = seedFiles(ready(changes([["a.ts", 3], ["large.ts", 900]])));
  const state = setOpen(setOpen(initialDisclosure, "a.ts", false), "large.ts", true);
  assert.deepEqual([isOpen(state, "a.ts", before), isOpen(state, "large.ts", before)], [false, true]);
  const after = seedFiles(ready(changes([["a.ts", 4], ["large.ts", 950], ["new.ts", 1]])));
  assert.deepEqual([isOpen(state, "a.ts", after), isOpen(state, "large.ts", after), isOpen(state, "new.ts", after)], [false, true, true]);
});

test("summary and file messages", () => {
  assert.equal(summary(undefined, false), "Loading…");
  assert.equal(summary(undefined, true), "Changes unavailable");
  assert.equal(summary({ status: "error", detail: "x" }, false), "Changes unavailable");
  assert.equal(summary(ready(changes([])), false), "no changes");
  assert.equal(summary(ready(changes([["a.ts", 2], ["b.ts", 1]])), false), "2 files · +3 −0");
  assert.equal(fileMessage({ error: "boom", busy: false, loaded: { truncated: false } }), "boom");
  assert.equal(fileMessage({ busy: true }), "Loading fresh patch…");
  assert.equal(fileMessage({ busy: false }), "Expand to load patch");
  assert.match(fileMessage({ busy: false, loaded: { truncated: true } }) ?? "", /Partial patch.*1 MiB/);
  assert.equal(fileMessage({ busy: true, loaded: { truncated: false } }), undefined);
});

test("asking about a file quotes its diff and says whether the patch is partial", () => {
  const loaded = changedFile(workspace, changes([["a.ts", 1]]), "a.ts");
  const text = askText(loaded);
  assert.match(text, /^About `a\.ts` \(live working-tree diff inspected at .+; not an immutable revision\):/);
  assert.ok(text.includes(`\`\`\`diff\n${patch("a.ts", 1)}\`\`\`\n`));
  assert.match(askText({ ...loaded, truncated: true }), /partial patch, not the complete file/);
});
