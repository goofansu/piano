import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChangeFile, WorkspaceChanges } from "../shared/wire.ts";
import {
  askText,
  CHANGES_MOVED,
  type ChangesSheetView,
  changedFile,
  changesSheet,
  checkWorkspaceResponse,
  type Disclosure,
  fileMessage,
  initialDisclosure,
  pullRequestTrigger,
  refreshKey,
  toggleEvery,
  toggleFile,
} from "../web/src/lib/changesView.ts";

const workspace = { id: "w1", path: "/repo" };
const patch = (path: string, added: number) =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -0,0 +1,${added} @@`,
    ...Array.from({ length: added }, (_, i) => `+line ${i}`),
  ].join("\n") + "\n";
const meta = (path: string, additions: number): ChangeFile => ({
  path,
  additions,
  deletions: 0,
  binary: false,
});
const changes = (
  files: [string, number][],
  { truncated = false, diff = files.map(([p, n]) => patch(p, n)).join(""), at = workspace } = {},
): WorkspaceChanges => ({
  workspace: { ...at, folder: "/repo" },
  observedAt: "2026-10-11T10:00:00.000Z",
  result: {
    status: "ready",
    head: "abc",
    branch: "main",
    pullRequestFromBranch: false,
    comparison: { scope: "uncommitted", base: "abc" },
    scopes: [
      { scope: "branch", available: false, reason: "main is the base branch." },
      { scope: "uncommitted", available: true },
    ],
    local: { commitsNotPushed: null, uncommitted: files.length > 0 },
    files: files.map(([p, n]) => meta(p, n)),
    diff,
    truncated,
  },
});
const sheet = (
  observation: WorkspaceChanges | null,
  {
    error,
    busy = false,
    disclosure = initialDisclosure,
  }: { error?: string; busy?: boolean; disclosure?: Disclosure } = {},
) => changesSheet({ observation, error, busy, disclosure });
/** Each listed file's path and whether it is open, in order. */
const opens = (view: ChangesSheetView) =>
  view.body.kind === "files" ? view.body.files.map((f) => [f.metadata.path, f.open]) : [];

test("only a new checkout-changing tool result or a streaming change asks for a re-read", () => {
  const msg = (id: string, role: "assistant" | "tool_result", toolName?: string) => ({
    id,
    role,
    toolName,
  });
  const session = (messages: ReturnType<typeof msg>[], isStreaming = false) => ({
    messages,
    state: { isStreaming },
  });
  const base = refreshKey(session([msg("1", "tool_result", "edit")]));
  assert.equal(
    refreshKey(
      session([
        msg("1", "tool_result", "edit"),
        msg("2", "tool_result", "read"),
        msg("3", "assistant"),
      ]),
    ),
    base,
  );
  assert.notEqual(
    refreshKey(session([msg("1", "tool_result", "edit"), msg("2", "tool_result", "bash")])),
    base,
  );
  assert.notEqual(refreshKey(session([msg("1", "tool_result", "edit")], true)), base);
});

// The server compares by the link's recorded branches (SessionChanges hints); a read rewrites them
// without changing the URL, after a retarget or once GitHub answers for a link saved without them.
test("Changes reads again when the pull request's recorded branches move, not only its URL", () => {
  const url = "https://github.com/o/r/pull/7";
  const saved = { url, source: "manual" as const };
  const recorded = {
    ...saved,
    head: "feat",
    headRepo: "o/r",
    base: "main",
    baseRepo: "o/r",
  };
  const unlinked = pullRequestTrigger(undefined);
  assert.equal(pullRequestTrigger(null), unlinked, "removed reads like never linked");
  assert.notEqual(pullRequestTrigger(saved), unlinked, "linking reads again");
  assert.notEqual(pullRequestTrigger(recorded), pullRequestTrigger(saved), "branches recorded");
  assert.notEqual(
    pullRequestTrigger({ ...recorded, base: "release" }),
    pullRequestTrigger(recorded),
    "retargeted",
  );
  assert.equal(
    pullRequestTrigger({ ...recorded, source: "branch" }),
    pullRequestTrigger(recorded),
    "how the link was made does not change what Changes compares with",
  );
});

test("a response for another workspace, or a failed read, is rejected", () => {
  assert.throws(
    () =>
      checkWorkspaceResponse(
        workspace,
        changes([["a.ts", 1]], { at: { id: "w2", path: "/repo" } }),
      ),
    /different workspace/,
  );
  assert.throws(
    () =>
      checkWorkspaceResponse(
        workspace,
        changes([["a.ts", 1]], { at: { id: "w1", path: "/elsewhere" } }),
      ),
    /different workspace/,
  );
  assert.throws(
    () =>
      changedFile(workspace, changes([["a.ts", 1]], { at: { id: "w2", path: "/repo" } }), "a.ts"),
    /another workspace/,
  );
  const failed: WorkspaceChanges = {
    ...changes([]),
    result: { status: "error", detail: "not a git repository" },
  };
  assert.throws(() => checkWorkspaceResponse(workspace, failed), /not a git repository/);
});

test("a file read yields the requested file, or says why it cannot", () => {
  const loaded = changedFile(
    workspace,
    changes([
      ["a.ts", 2],
      ["b.ts", 1],
    ]),
    "b.ts",
  );
  assert.equal(loaded.file.path, "b.ts");
  assert.equal(loaded.file.additions, 1);
  assert.throws(
    () => changedFile(workspace, changes([["a.ts", 2]]), "gone.ts"),
    /metadata is unavailable/,
  );
  assert.throws(
    () => changedFile(workspace, changes([["a.ts", 2]], { diff: "" }), "a.ts"),
    /no longer has a diff/,
  );
  assert.throws(
    () => changedFile(workspace, changes([["a.ts", 2]], { diff: "", truncated: true }), "a.ts"),
    /too large/,
  );
});

test("a truncated initial read never seeds a partial last file", () => {
  const value = changes(
    [
      ["a.ts", 1],
      ["b.ts", 3],
    ],
    {
      truncated: true,
      diff: patch("a.ts", 1) + patch("b.ts", 3).split("\n").slice(0, 5).join("\n"),
    },
  );
  const truncated = sheet(value);
  assert.equal(truncated.body.kind, "files");
  if (truncated.body.kind !== "files") return;
  assert.deepEqual(
    truncated.body.files.map((f) => [f.metadata.path, f.initial !== undefined]),
    [
      ["a.ts", true],
      ["b.ts", false],
    ],
  );
  assert.deepEqual(opens(truncated), [
    ["a.ts", true],
    ["b.ts", false],
  ]);
});

test("small seeded files start open; large ones start folded until expanded", () => {
  const value = changes([
    ["small.ts", 3],
    ["large.ts", 801],
  ]);
  const view = sheet(value);
  assert.deepEqual(opens(view), [
    ["small.ts", true],
    ["large.ts", false],
  ]);
  assert.equal(view.everyCollapsed, false);
  assert.deepEqual(
    opens(sheet(value, { disclosure: toggleFile(initialDisclosure, "large.ts", true) })),
    [
      ["small.ts", true],
      ["large.ts", true],
    ],
  );
});

test("Collapse all then Expand all opens every file, large ones included", () => {
  const value = changes([
    ["small.ts", 3],
    ["large.ts", 801],
  ]);
  const collapsed = toggleEvery(initialDisclosure, sheet(value));
  const folded = sheet(value, { disclosure: collapsed });
  assert.equal(folded.everyCollapsed, true);
  assert.deepEqual(opens(folded), [
    ["small.ts", false],
    ["large.ts", false],
  ]);
  const expanded = sheet(value, { disclosure: toggleEvery(collapsed, folded) });
  assert.deepEqual(opens(expanded), [
    ["small.ts", true],
    ["large.ts", true],
  ]);
});

test("a refresh keeps a collapsed file collapsed and an opened large file open", () => {
  const disclosure = toggleFile(toggleFile(initialDisclosure, "a.ts", false), "large.ts", true);
  const before = changes([
    ["a.ts", 3],
    ["large.ts", 900],
  ]);
  assert.deepEqual(opens(sheet(before, { disclosure })), [
    ["a.ts", false],
    ["large.ts", true],
  ]);
  const after = changes([
    ["a.ts", 4],
    ["large.ts", 950],
    ["new.ts", 1],
  ]);
  assert.deepEqual(opens(sheet(after, { disclosure })), [
    ["a.ts", false],
    ["large.ts", true],
    ["new.ts", true],
  ]);
});

test("a failed refresh keeps the previous files with a stale note", () => {
  const view = sheet(changes([["a.ts", 2]]), { error: "network down" });
  assert.equal(view.body.kind, "files");
  assert.equal(view.pullRequestFromBranch, false);
  assert.deepEqual(view.staleNote, {
    text: "Refresh failed. Showing previous changes.",
    detail: "network down",
  });
  assert.equal(sheet(changes([]), { error: "network down" }).body.kind, "empty");
  assert.equal(sheet(changes([["a.ts", 2]])).staleNote, undefined);
});

test("a first read that fails shows one unavailable body and nothing of a read", () => {
  const view = sheet(null, { error: "not a git repository" });
  assert.deepEqual(view.body, { kind: "failed", detail: "not a git repository" });
  assert.equal(view.staleNote, undefined);
  assert.equal(view.pullRequestFromBranch, undefined);
  assert.equal(view.changes, undefined);
  assert.deepEqual(toggleEvery(initialDisclosure, view), initialDisclosure);
});

test("a server error result and a transport error never both show", () => {
  const failed: WorkspaceChanges = {
    ...changes([]),
    result: { status: "error", detail: "not a git repository" },
  };
  assert.deepEqual(sheet(failed).body, { kind: "failed", detail: "not a git repository" });
  assert.deepEqual(sheet(failed, { error: "network down" }).body, {
    kind: "failed",
    detail: "network down",
  });
  assert.equal(sheet(failed, { busy: true }).body.kind, "failed");
});

test("before a read settles the sheet reads, or waits; a re-read keeps the files", () => {
  assert.deepEqual(sheet(null, { busy: true }).body, { kind: "reading" });
  assert.deepEqual(sheet(null).body, { kind: "idle" });
  assert.equal(sheet(null, { busy: true }).refreshing, false);
  const refreshing = sheet(changes([["a.ts", 1]]), { busy: true });
  assert.equal(refreshing.body.kind, "files");
  assert.equal(refreshing.refreshing, true);
});

test("file messages", () => {
  assert.equal(fileMessage({ error: "boom", busy: false, loaded: { truncated: false } }), "boom");
  assert.equal(fileMessage({ busy: true }), "Loading fresh patch…");
  assert.equal(fileMessage({ busy: false }), "Expand to load patch");
  assert.match(
    fileMessage({ busy: false, loaded: { truncated: true } }) ?? "",
    /Partial patch.*1 MiB/,
  );
  assert.equal(fileMessage({ busy: true, loaded: { truncated: false } }), undefined);
});

test("asking about a file quotes its diff and says whether the patch is partial", () => {
  const loaded = changedFile(workspace, changes([["a.ts", 1]]), "a.ts");
  const text = askText(loaded);
  assert.match(
    text,
    /^About `a\.ts` \(live working-tree diff inspected at .+; not an immutable revision\):/,
  );
  assert.ok(text.includes(`\`\`\`diff\n${patch("a.ts", 1)}\`\`\`\n`));
  assert.match(askText({ ...loaded, truncated: true }), /partial patch, not the complete file/);
});

test("the comparison menu puts Uncommitted first and names the actual target ref", () => {
  const view = sheet(changes([["a", 1]]));
  assert.deepEqual(view.scope, {
    current: "uncommitted",
    label: "Uncommitted",
    options: [
      { scope: "uncommitted", name: "Uncommitted", available: true },
      { scope: "branch", name: "Base branch", available: false },
    ],
  });
  const branch = changes([["a", 1]]);
  const target = {
    name: "main",
    ref: "refs/remotes/origin/main",
    commit: "def",
    from: "remote-default",
  } as const;
  const onBranch = sheet({
    ...branch,
    result: {
      ...(branch.result as Extract<WorkspaceChanges["result"], { status: "ready" }>),
      comparison: { scope: "branch", base: "def", target },
      scopes: [
        { scope: "branch", available: true, target },
        { scope: "uncommitted", available: true },
      ],
    },
  });
  assert.equal(onBranch.scope?.label, "origin/main");
  assert.deepEqual(onBranch.scope?.options[1], {
    scope: "branch",
    name: "origin/main",
    available: true,
  });
});

test("an unavailable scope is the body's reason, with the menu still offering the others and local work still shown", () => {
  const view = sheet({
    ...changes([]),
    result: {
      status: "unavailable",
      head: "abc",
      branch: "main",
      pullRequestFromBranch: false,
      scope: "branch",
      detail: "main is the base branch.",
      scopes: [
        {
          scope: "branch",
          available: false,
          reason: "main is the base branch.",
          target: { name: "main", ref: "refs/heads/main", commit: "abc", from: "assumed" },
        },
        { scope: "uncommitted", available: true },
      ],
      local: { commitsNotPushed: null, uncommitted: true },
    },
  });
  assert.deepEqual(view.local, { commitsNotPushed: null, uncommitted: true }, "local work stays");
  assert.deepEqual(view.body, {
    kind: "failed",
    title: "Base branch unavailable",
    detail: "main is the base branch.",
  });
  assert.equal(view.scope?.current, "branch");
  assert.equal(view.scope?.label, "main");
  assert.deepEqual(view.scope?.options[1], { scope: "branch", name: "main", available: false });
  assert.equal(view.scope?.options[0].available, true);
});

test("a file read under another comparison never mixes into the list it was asked for", () => {
  const value = changes([["a", 1]]);
  assert.equal(
    changedFile(workspace, value, "a", { scope: "uncommitted", base: "abc" }).file.path,
    "a",
  );
  assert.throws(() => changedFile(workspace, value, "a", { scope: "branch", base: "abc" }), {
    message: CHANGES_MOVED,
  });
  assert.throws(() => changedFile(workspace, value, "a", { scope: "uncommitted", base: "moved" }), {
    message: CHANGES_MOVED,
  });
});
