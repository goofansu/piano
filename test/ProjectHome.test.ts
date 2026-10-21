import assert from "node:assert/strict";
import { test } from "node:test";
import type { FolderView, SessionPullRequest, WorktreeView } from "../shared/wire.ts";
import { globalCommands } from "../web/src/lib/globalCommands.ts";
import { projectHome, pullRequestTargets, stableOrder } from "../web/src/lib/projectHome.ts";
import {
  createProjectPullRequests,
  type PullRequestTarget,
} from "../web/src/lib/projectPullRequests.ts";
import { type AppState, initialState } from "../web/src/store.ts";
import { sessionReference } from "./fixtures/sessionReference.ts";

const worktree = (path: string, branch: string, root: boolean): WorktreeView => ({
  workspace: { id: `ws:${path}`, folder: "/repo", path },
  trust: { required: false, trusted: false },
  branch,
  path,
  root,
  status: "current",
});
const folder: FolderView = {
  path: "/repo",
  name: "repo",
  worktrees: [
    worktree("/repo", "main", true),
    worktree("/work/repo.status", "status", false),
    worktree("/work/repo.sheet", "sheet", false),
  ],
  discovery: { status: "ready", observedAt: "", currentPath: "/repo", worktrees: [] },
};
const prUrl = "https://github.com/acme/repo/pull/231";
const at = (minute: number) => `2026-10-21T08:${String(minute).padStart(2, "0")}:00Z`;
const state: AppState = {
  ...initialState,
  folders: [folder],
  projects: [
    { id: "p1", name: "Launch", archived: false },
    { id: "p2", name: "Other", archived: false },
  ],
  sessionReferences: [
    sessionReference("/work/repo.status", "status-old", {
      title: "Status, first try",
      projectId: "p1",
      branch: "status",
      updatedAt: at(1),
      pullRequest: { url: prUrl, source: "branch" },
    }),
    sessionReference("/work/repo.status", "status-new", {
      title: "Status, second try",
      projectId: "p1",
      branch: "status",
      updatedAt: at(5),
    }),
    sessionReference("/work/repo.sheet", "sheet", {
      title: "Mobile sheet",
      projectId: "p1",
      branch: "sheet",
      updatedAt: at(3),
      // Removed by the user: never read.
      pullRequest: null,
    }),
    sessionReference("/repo", "root", {
      title: "On main",
      projectId: "p1",
      branch: "main",
      updatedAt: at(4),
    }),
    sessionReference("/repo", "elsewhere", { title: "Other project", projectId: "p2" }),
    sessionReference("/work/repo.sheet", "archived", {
      projectId: "p1",
      branch: "sheet",
      archived: true,
      updatedAt: at(9),
    }),
  ],
  hosts: [{ cwd: "/work/repo.status", sessionId: "status-new", streaming: true }],
};

test("a project's home lists each worktree's branch by its latest session, and members on a folder's own checkout apart", () => {
  const home = projectHome(state, "p1")!;
  assert.deepEqual(
    home.branches.map((b) => ({
      branch: b.branch,
      folder: b.folder,
      latest: b.latest.entry.sessionId,
      activity: b.latest.entry.activity,
      pullRequest: b.pullRequest?.link?.url,
    })),
    [
      // Newest branch first; the older session's saved link speaks for the branch.
      {
        branch: "status",
        folder: "repo",
        latest: "status-new",
        activity: "working",
        pullRequest: prUrl,
      },
      { branch: "sheet", folder: "repo", latest: "sheet", activity: "off", pullRequest: undefined },
    ],
  );
  assert.deepEqual(
    home.others.map((o) => o.entry.sessionId),
    ["root"],
    "archived members and other projects' sessions stay out",
  );
  assert.equal(projectHome(state, "gone"), undefined);
});

test("the home reads a pull request only through a saved link", () => {
  assert.deepEqual(pullRequestTargets(projectHome(state, "p1")!), [
    {
      workspaceId: "ws:/work/repo.status",
      sessionId: "status-old",
      link: { url: prUrl, source: "branch" },
    },
  ]);
  const undiscovered: AppState = {
    ...state,
    sessionReferences: state.sessionReferences.map((r) => ({ ...r, pullRequest: undefined })),
  };
  assert.deepEqual(
    pullRequestTargets(projectHome(undiscovered, "p1")!),
    [],
    "a session never linked would make the server search GitHub, so it is not asked about",
  );
});

test("rows keep their place while the page is open: new ones append, gone ones drop", () => {
  assert.deepEqual(stableOrder([], ["b", "a"]), ["b", "a"]);
  assert.deepEqual(stableOrder(["b", "a"], ["a", "c", "b"]), ["b", "a", "c"]);
  assert.deepEqual(stableOrder(["b", "a", "c"], ["c", "b"]), ["b", "c"]);
});

test("on a project's home, Mod+K offers its New session in project button, disabled once archived", () => {
  const ctx = { settingsOpen: false, view: { groupBy: "date", sortBy: "recent" } } as const;
  const onHome = (s: AppState) =>
    globalCommands(s, ctx).find((c) => c.id === "new-session-in-project");
  const home: AppState = { ...state, view: { kind: "project", projectId: "p1" } };
  assert.equal(onHome(home)?.label, "New session in project");
  assert.equal(onHome(home)?.enabled, true);
  assert.equal(
    onHome({ ...home, projects: [{ id: "p1", name: "Launch", archived: true }] })?.enabled,
    false,
  );
  assert.equal(onHome(state), undefined, "elsewhere the row is absent");
});

const target = (n: number): PullRequestTarget => ({
  workspaceId: `ws${n}`,
  sessionId: `s${n}`,
  link: { url: `https://github.com/acme/repo/pull/${n}`, source: "branch" },
});
const answer = (n: number, state: "open" | "merged"): SessionPullRequest => ({
  link: target(n).link,
  pullRequest: {
    url: target(n).link.url,
    repo: "acme/repo",
    number: n,
    title: `PR ${n}`,
    state,
    checks: "none",
    review: "none",
  },
});

/** A GitHub stand-in whose reads finish when the test says, or when their signal aborts. */
function github() {
  const pending = new Map<string, (value: SessionPullRequest) => void>();
  const asked: string[] = [];
  const read = (
    _workspaceId: string,
    sessionId: string,
    _action: undefined,
    { signal }: { signal?: AbortSignal },
  ) =>
    new Promise<SessionPullRequest>((resolve, reject) => {
      asked.push(sessionId);
      pending.set(sessionId, resolve);
      signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  return {
    read,
    asked,
    finish: (n: number, value: SessionPullRequest) => pending.get(`s${n}`)!(value),
  };
}
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

test("pull request states are read four at a time, once per link, for the page view", async () => {
  const gh = github();
  const reads = createProjectPullRequests({ read: gh.read, timeoutMs: 60_000 });
  const stop = reads.start();
  const targets = [1, 2, 3, 4, 5, 6].map(target);
  reads.want(targets);
  reads.want(targets);
  assert.deepEqual(gh.asked, ["s1", "s2", "s3", "s4"], "four in flight, the rest wait");
  gh.finish(1, answer(1, "merged"));
  await settled();
  assert.deepEqual(gh.asked, ["s1", "s2", "s3", "s4", "s5"]);
  assert.equal(reads.getState().get(target(1).link.url), "merged");
  assert.equal(reads.getState().has(target(2).link.url), false, "unread links have no state yet");
  stop();
});

test("a pull request GitHub does not answer in time is unavailable, not stuck", async () => {
  const gh = github();
  const reads = createProjectPullRequests({ read: gh.read, timeoutMs: 5 });
  const stop = reads.start();
  reads.want([target(7)]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(reads.getState().get(target(7).link.url), "unavailable");
  stop();
});

test("a read cut short by leaving the page is made again when the page comes back", async () => {
  const gh = github();
  const reads = createProjectPullRequests({ read: gh.read, timeoutMs: 60_000 });
  // React's development remount: start, ask, stop, then start and ask again.
  const stopFirst = reads.start();
  reads.want([target(8)]);
  stopFirst();
  await settled();
  const stop = reads.start();
  reads.want([target(8)]);
  assert.deepEqual(gh.asked, ["s8", "s8"]);
  gh.finish(8, answer(8, "open"));
  await settled();
  assert.equal(reads.getState().get(target(8).link.url), "open");
  stop();
});
