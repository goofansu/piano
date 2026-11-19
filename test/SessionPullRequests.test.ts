import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type TestContext, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Effect, Layer, ManagedRuntime } from "effect";
import { GitHubPullRequestsLive } from "../server/GitHubPullRequests.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import {
  PullRequestTimeoutMs,
  SessionPullRequests,
  SessionPullRequestsLive,
} from "../server/SessionPullRequests.ts";
import { GhCommand } from "../server/Subprocess.ts";
import { forkWorktree } from "./fixtures/forkWorktree.ts";

const candidate = (number: number, branch = "feature", owner = "example") => ({
  url: `https://github.com/example/repo/pull/${number}`,
  number,
  title: `Work ${number}`,
  state: "OPEN",
  isDraft: false,
  reviewDecision: "APPROVED",
  statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }],
  headRefName: branch,
  headRepository: { name: "repo" },
  headRepositoryOwner: { login: owner },
});
async function fixture(t: TestContext, cwd?: string) {
  const root = mkdtempSync(join(tmpdir(), "piano-session-pr-")),
    repo = join(root, "repo"),
    bin = join(root, "bin");
  mkdirSync(repo);
  mkdirSync(bin);
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args],
      {
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      },
    ).trim();
  git("init", "-q", "-b", "feature");
  git("commit", "--allow-empty", "-qm", "base");
  git("remote", "add", "origin", "git@github.com:example/repo.git");
  const path = join(root, "registry.db"),
    forge = join(root, "forge.json"),
    gh = join(bin, "gh");
  writeFileSync(
    gh,
    `#!${process.execPath}\nprocess.env.PIANO_TEST_GH_FIXTURE = ${JSON.stringify(forge)};\nawait import(${JSON.stringify(resolve("test/fixtures/fake-gh.mjs"))});\n`,
    { mode: 0o755 },
  );
  const control = (data: object) => writeFileSync(forge, JSON.stringify(data));
  control({ prs: [candidate(42), candidate(99, "feature", "unrelated-fork")] });
  const layer = SessionPullRequestsLive.pipe(
    Layer.provide(GitHubPullRequestsLive),
    Layer.provideMerge(RegistryLive),
    Layer.provide([Layer.succeed(RegistryDatabasePath, path), Layer.succeed(GhCommand, gh)]),
  );
  const runtime = ManagedRuntime.make(layer);
  const registry = await runtime.runPromise(Registry),
    prs = await runtime.runPromise(SessionPullRequests);
  const at = cwd ?? repo;
  await runtime.runPromise(registry.addSession(at, "one"));
  await runtime.runPromise(registry.addSession(at, "two"));
  t.after(async () => {
    await runtime.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  const getIn = (
    from: ManagedRuntime.ManagedRuntime<SessionPullRequests | Registry, unknown>,
    id = "one",
  ) =>
    from.runPromise(
      Effect.gen(function* () {
        const s = (yield* (yield* Registry).get).sessions.find(
          (s) => s.cwd === at && s.sessionId === id,
        );
        return yield* (yield* SessionPullRequests).get(s!);
      }),
    );
  const get = (id = "one") => getIn(runtime, id);
  const change = (action: Parameters<typeof prs.change>[1], id = "one") =>
    runtime.runPromise(
      Effect.gen(function* () {
        const s = (yield* registry.get).sessions.find((s) => s.cwd === at && s.sessionId === id);
        return yield* prs.change(s!, action);
      }),
    );
  return { root, repo, path, git, control, runtime, registry, prs, get, getIn, change, layer };
}

test("a pull request lookup that outlasts its bound answers its own error within it, saving nothing", async (t) => {
  const f = await fixture(t);
  const started = join(f.root, "stalled-started");
  f.control({ prs: [candidate(42)], gate: { started, release: join(f.root, "never") } });
  const boundMs = 1_000;
  const begun = Date.now();
  const outcome = await f.runtime
    .runPromise(
      Effect.gen(function* () {
        const s = (yield* f.registry.get).sessions.find((s) => s.sessionId === "one");
        return yield* f.prs.get(s!);
      }).pipe(Effect.provideService(PullRequestTimeoutMs, boundMs)),
    )
    .then(
      (value) => ({ value }),
      (error) => ({ error: String(error) }),
    );
  const elapsed = Date.now() - begun;
  assert.ok("error" in outcome, "a stalled lookup is refused");
  assert.match(outcome.error, /within 1 seconds\. Retry\./);
  assert.ok(existsSync(started), "the lookup reached GitHub");
  assert.ok(elapsed < 4_000, `answered after ${elapsed} ms, before gh gave up`);
  const saved = (await f.runtime.runPromise(f.registry.get)).sessions.find(
    (s) => s.sessionId === "one",
  );
  assert.ok(!saved?.pullRequest);
});

test("INV-01/07: discovers by branch AND head repository, pins identity across branch changes/restart, scopes manual links/removal to a session", async (t) => {
  const f = await fixture(t);
  const first = await f.get();
  assert.equal(first.pullRequest?.number, 42);
  assert.equal(first.link?.source, "branch");
  assert.equal(first.pullRequest?.checks, "success");
  assert.equal(first.pullRequest?.review, "approved");
  f.git("switch", "-qc", "next");
  f.control({ prs: [{ ...candidate(42), state: "MERGED" }, candidate(43, "next")] });
  assert.equal((await f.get()).pullRequest?.state, "merged");
  assert.equal((await f.get("two")).pullRequest?.number, 43);
  const linked = await f.change({
    action: "link",
    url: "https://github.com/EXAMPLE/REPO/pull/43/files?diff=split#x",
  });
  assert.equal(linked.link?.url, "https://github.com/example/repo/pull/43");
  assert.equal(linked.link?.source, "manual");
  await f.change({ action: "remove" });
  assert.deepEqual(await f.get(), { link: null, pullRequest: null });
  assert.equal((await f.get("two")).pullRequest?.number, 43);
  const persisted = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* Registry).get;
    }).pipe(Effect.provide(RegistryLive), Effect.provideService(RegistryDatabasePath, f.path)),
  );
  assert.equal(persisted.sessions[0].pullRequest, null);
  assert.deepEqual(persisted.sessions[1].pullRequest, {
    url: "https://github.com/example/repo/pull/43",
    source: "branch",
  });
  const restarted = ManagedRuntime.make(f.layer);
  try {
    assert.deepEqual(await f.getIn(restarted, "one"), { link: null, pullRequest: null });
    assert.equal((await f.getIn(restarted, "two")).pullRequest?.number, 43);
  } finally {
    await restarted.dispose();
  }
  assert.equal((await f.change({ action: "discover" })).pullRequest?.number, 43);
});

test("unknown/auth/malformed results are not healthy absence; explicit link validation and missing checkout preserve identity", async (t) => {
  const f = await fixture(t);
  f.control({ error: "auth failed" });
  assert.match((await f.get()).error!, /authentication/);
  f.git("remote", "set-url", "origin", "https://unsupported.example/example/repo.git");
  assert.match((await f.get()).error!, /GitHub integration remote/);
  f.git("remote", "set-url", "origin", "git@github.com:example/repo.git");
  f.control({ malformed: true });
  assert.match((await f.get()).error!, /invalid/);
  f.control({ prs: [candidate(42), candidate(43)] });
  assert.match((await f.get()).error!, /Several/);
  for (const url of [
    "https://github.com/example/repo/issues/42",
    "https://github.com.evil/example/repo/pull/42",
    "https://secret@github.com/example/repo/pull/42",
    "file:///tmp/pr",
  ]) {
    await assert.rejects(f.change({ action: "link", url }), /GitHub pull request URL/);
  }
  f.control({ prs: [candidate(42)] });
  await f.get();
  f.control({ error: "offline" });
  const offline = await f.get();
  assert.equal(offline.link?.url, candidate(42).url);
  assert.equal(offline.pullRequest, null);
  assert.ok(offline.error);
  const manualOffline = await f.change({ action: "link", url: candidate(42).url });
  assert.equal(manualOffline.link?.source, "manual");
  assert.equal(manualOffline.pullRequest, null);
  assert.ok(manualOffline.error);
  f.control({ prs: [] });
  const noReplacement = await f.change({ action: "discover" });
  assert.equal(
    noReplacement.link?.url,
    candidate(42).url,
    "failed discovery does not remove an existing association",
  );
  f.control({ prs: [{ ...candidate(42), state: "CLOSED" }] });
  rmSync(f.repo, { recursive: true });
  assert.equal(
    (await f.get()).pullRequest?.state,
    "closed",
    "saved PR can be read after checkout removal",
  );
});

test("exe.dev integration routes discovery and saved/manual PR reads through gh without changing browser URLs or global host", async (t) => {
  const f = await fixture(t),
    host = "github.int.exe.xyz";
  const previousHost = process.env.GH_HOST;
  process.env.GH_HOST = "unrelated.example";
  t.after(() => {
    if (previousHost === undefined) delete process.env.GH_HOST;
    else process.env.GH_HOST = previousHost;
  });
  f.git("remote", "set-url", "origin", `https://${host}/example/repo.git`);
  const proxy = { prs: [candidate(42)], expectedHost: host, expectedRepo: `${host}/example/repo` };
  f.control(proxy);
  const discovered = await f.get();
  assert.deepEqual(discovered.link, { url: candidate(42).url, source: "branch", apiHost: host });
  assert.equal(discovered.pullRequest?.number, 42);
  assert.equal(process.env.GH_HOST, "unrelated.example", "host routing is child-local");
  f.git("remote", "set-url", "origin", "git@github.com:example/repo.git");
  assert.equal((await f.get()).pullRequest?.number, 42);
  f.control({ ...proxy, expectedHost: "github.com", expectedRepo: "github.com/example/repo" });
  const direct = await f.change({ action: "link", url: candidate(42).url });
  assert.equal(direct.link?.apiHost, undefined);
  assert.equal(direct.pullRequest?.number, 42);
  f.git("remote", "set-url", "origin", `https://${host}/example/repo.git`);
  f.control(proxy);
  assert.equal((await f.get()).pullRequest?.number, 42);
  f.git("switch", "--detach", "-q");
  const manual = await f.change({ action: "link", url: candidate(42).url });
  assert.equal(manual.link?.apiHost, host);
  assert.equal(manual.pullRequest?.number, 42);
  const proxyUrl = await f.change({
    action: "link",
    url: `https://${host}/EXAMPLE/REPO/pull/42/files#diff`,
  });
  assert.equal(proxyUrl.link?.url, candidate(42).url);
  assert.equal(proxyUrl.link?.apiHost, host);
  await assert.rejects(
    f.change({ action: "link", url: "https://github.int.exe.xyz.evil/example/repo/pull/42" }),
    /GitHub pull request URL/,
  );
  f.control({
    ...proxy,
    prs: [{ ...candidate(42), url: `https://${host}/example/repo/pull/42`, state: "MERGED" }],
  });
  rmSync(f.repo, { recursive: true });
  const restarted = ManagedRuntime.make(f.layer);
  try {
    const pr = await f.getIn(restarted, "one");
    assert.equal(pr.pullRequest?.state, "merged");
    assert.equal(pr.pullRequest?.url, candidate(42).url);
  } finally {
    await restarted.dispose();
  }
  f.control({ error: "integration detached", expectedHost: host });
  const unavailable = await f.get();
  assert.equal(unavailable.pullRequest, null);
  assert.match(unavailable.error!, /VM's GitHub integration/);
  assert.equal(unavailable.link?.apiHost, host);
});

test("INV-07: late discovery cannot undo removal/deletion or attach a candidate from a changed checkout", async (t) => {
  const f = await fixture(t);
  for (const mutation of ["remove", "manual", "delete", "branch", "remote"] as const) {
    const id = mutation;
    await f.runtime.runPromise(f.registry.addSession(f.repo, id));
    const started = join(f.root, `${id}-started`),
      release = join(f.root, `${id}-release`);
    f.control({ prs: [candidate(42)], gate: { started, release } });
    const pending = f.get(id).then(
      (value) => ({ value }),
      (error) => ({ error: String(error) }),
    );
    for (let n = 0; !existsSync(started); n++) {
      if (n > 300) throw new Error("Discovery did not start");
      await delay(10);
    }
    if (mutation === "remove") await f.change({ action: "remove" }, id);
    if (mutation === "manual") await f.change({ action: "link", url: candidate(77).url }, id);
    if (mutation === "delete") await f.runtime.runPromise(f.registry.removeSession(f.repo, id));
    if (mutation === "branch") f.git("switch", "-qc", "changed");
    if (mutation === "remote")
      f.git("remote", "set-url", "origin", "https://github.com/other/repo.git");
    writeFileSync(release, "go");
    const outcome = await pending;
    if ("error" in outcome) assert.match(outcome.error, /changed during lookup/);
    else {
      assert.equal(outcome.value.link, null);
      assert.match(outcome.value.error!, /checkout changed/);
    }
    const saved = (await f.runtime.runPromise(f.registry.get)).sessions.find(
      (s) => s.sessionId === id,
    );
    if (mutation === "manual") assert.equal(saved?.pullRequest?.url, candidate(77).url);
    else assert.ok(!saved?.pullRequest);
    f.git("switch", "-q", "feature");
    f.git("remote", "set-url", "origin", "git@github.com:example/repo.git");
  }
});

test("INV-06: inherited GIT_* state cannot redirect discovery; the user's url.<base>.insteadOf still names the remote", async (t) => {
  const f = await fixture(t),
    host = "github.int.exe.xyz";
  const other = join(f.root, "other"),
    home = join(f.root, "home");
  mkdirSync(other);
  mkdirSync(home);
  const clean = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  for (const args of [
    ["init", "-q", "-b", "elsewhere"],
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "other",
    ],
    ["remote", "add", "origin", "git@github.com:other/repo.git"],
  ])
    execFileSync("git", ["-C", other, ...args], { env: clean });
  writeFileSync(
    join(home, ".gitconfig"),
    `[url "https://${host}/"]\n\tinsteadOf = git@github.com:\n`,
  );
  const inherited = {
    GIT_DIR: join(other, ".git"),
    GIT_WORK_TREE: other,
    GIT_CONFIG_GLOBAL: "/dev/null",
    HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
  };
  const saved = Object.fromEntries(Object.keys(inherited).map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, inherited);
  f.control({
    prs: [candidate(42), candidate(7, "elsewhere", "other")],
    expectedHost: host,
    expectedRepo: `${host}/example/repo`,
  });
  const discovered = await f.get();
  assert.equal(discovered.pullRequest?.number, 42, JSON.stringify(discovered));
  assert.deepEqual(discovered.link, { url: candidate(42).url, source: "branch", apiHost: host });
});

test("discovery asks GitHub for the branch's name on its remote, not its local name", async (t) => {
  const f = await fixture(t);
  f.git("switch", "-qc", "feat");
  f.git("update-ref", "refs/remotes/origin/james/feat", "HEAD");
  f.git("config", "branch.feat.remote", "origin");
  f.git("config", "branch.feat.merge", "refs/heads/james/feat");
  f.git("config", "push.default", "upstream");
  f.control({ prs: [candidate(42, "james/feat"), candidate(7, "feat")] });
  assert.equal((await f.get()).pullRequest?.number, 42);
});

test("discovery asks GitHub for the name a push refspec gives the branch", async (t) => {
  const f = await fixture(t);
  f.git("switch", "-qc", "feat");
  f.git("config", "remote.origin.push", "refs/heads/feat:refs/heads/review/feat");
  f.control({ prs: [candidate(42, "review/feat"), candidate(7, "feat")] });
  assert.equal((await f.get()).pullRequest?.number, 42);
});

test("discovery asks GitHub for a branch started from another remote branch by its own name", async (t) => {
  const f = await fixture(t);
  f.git("update-ref", "refs/remotes/origin/main", "HEAD");
  f.git("update-ref", "refs/remotes/origin/release", "HEAD");
  f.git("config", "push.default", "simple");
  for (const start of ["origin/main", "origin/release"]) {
    f.git("switch", "-qC", "feat", "--track", start);
    f.control({ prs: [candidate(42, "feat"), candidate(7, "main"), candidate(9, "release")] });
    assert.equal((await f.get()).pullRequest?.number, 42, start);
  }
});

test("a link records the pull request's head and base as GitHub last reported them, so Changes can compare without a GitHub call", async (t) => {
  const f = await fixture(t);
  f.control({ prs: [{ ...candidate(42), baseRefName: "main" }] });
  const found = await f.get();
  assert.deepEqual([found.link?.head, found.link?.base], ["feature", "main"]);
  f.control({ prs: [{ ...candidate(42), baseRefName: "release" }] });
  const retargeted = await f.get();
  assert.deepEqual([retargeted.link?.source, retargeted.link?.base], ["branch", "release"]);
  const persisted = await f.runtime.runPromise(f.registry.get);
  assert.deepEqual(persisted.sessions[0].pullRequest, {
    url: "https://github.com/example/repo/pull/42",
    source: "branch",
    head: "feature",
    base: "release",
    headRepo: "example/repo",
    baseRepo: "example/repo",
  });
  f.control({ prs: [{ ...candidate(42), baseRefName: "release", headRepository: null }] });
  assert.equal((await f.get()).link?.headRepo, undefined);
  assert.equal(
    (await f.runtime.runPromise(f.registry.get)).sessions[0].pullRequest?.headRepo,
    undefined,
  );
  f.control({ prs: [{ ...candidate(7, "topic"), baseRefName: "main" }] });
  const manual = await f.change({ action: "link", url: "https://github.com/example/repo/pull/7" });
  assert.deepEqual(
    [manual.link?.source, manual.link?.head, manual.link?.base],
    ["manual", "topic", "main"],
  );
});

test("INV-01: an archived session's pull request link is read but never written", async (t) => {
  const f = await fixture(t);
  f.control({ prs: [{ ...candidate(42), baseRefName: "main" }] });
  await f.get();
  await f.runtime.runPromise(f.registry.archiveSession(f.repo, "one"));
  const stored = async () =>
    (await f.runtime.runPromise(f.registry.get)).sessions.find((s) => s.sessionId === "one")
      ?.pullRequest;
  const before = await stored();
  f.control({ prs: [{ ...candidate(42), baseRefName: "release" }] });
  const read = await f.get();
  assert.equal(read.pullRequest?.number, 42, "the linked pull request is still read");
  assert.deepEqual(read.link, before, "a read keeps the saved link");
  assert.deepEqual(await stored(), before, "a read records no branches");
  for (const action of [
    { action: "link", url: candidate(7).url },
    { action: "discover" },
    { action: "remove" },
  ] as const) {
    f.control({ prs: [candidate(7)] });
    await assert.rejects(f.change(action), /changed during lookup/, action.action);
    assert.deepEqual(await stored(), before, `${action.action} writes nothing`);
  }
});

test("INV-01: discovery asks GitHub for the branch where the session's own worktree pushes it", async (t) => {
  const { worktree } = forkWorktree(t);
  const f = await fixture(t, worktree);
  const pr = (number: number, owner: string, name: string) => ({
    ...candidate(number, "feat", owner),
    url: `https://github.com/up/repo/pull/${number}`,
    headRepository: { name },
    baseRefName: "main",
  });
  f.control({ prs: [pr(7, "up", "repo"), pr(42, "me", "fork")] });
  const found = await f.get();
  assert.equal(found.pullRequest?.number, 42, JSON.stringify(found));
  assert.deepEqual([found.link?.head, found.link?.headRepo], ["feat", "me/fork"]);
});

test("exe.dev: discovery searches the upstream repository for a fork's pull request and matches only the fork's branch", async (t) => {
  const f = await fixture(t),
    host = "github.int.exe.xyz",
    log = join(f.root, "gh.log");
  f.git("remote", "set-url", "origin", `https://${host}/me/fork.git`);
  f.git("remote", "add", "upstream", `https://${host}/up/repo.git`);
  f.git("update-ref", "refs/remotes/origin/feature", "HEAD");
  f.git("branch", "--set-upstream-to", "origin/feature");
  const pr = (number: number, base: string, owner: string, name: string) => ({
    ...candidate(number, "feature", owner),
    url: `https://github.com/${base}/pull/${number}`,
    headRepository: { name },
    baseRefName: "main",
  });
  const fromFork = pr(42, "up/repo", "me", "fork"),
    otherFork = pr(7, "up/repo", "someone", "fork"),
    sameRepo = pr(3, "me/fork", "me", "fork"),
    elsewhere = pr(9, "someone/fork", "someone", "fork");
  const serve = async (prs: object[]) => {
    await f.change({ action: "remove" });
    rmSync(log, { force: true });
    f.control({
      prs,
      expectedHost: host,
      expectedRepos: [`${host}/up/repo`, `${host}/me/fork`],
      log,
    });
  };
  const calls = () =>
    readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { GH_HOST: string; args: string[] })
      .map(({ GH_HOST, args }) => `${GH_HOST} ${args.slice(0, -1).join(" ")}`)
      .toSorted();
  const listed = (repo: string) =>
    `${host} pr list --head feature --state open --limit 100 --repo ${host}/${repo} --json`;

  await serve([fromFork, otherFork, elsewhere]);
  const found = await f.change({ action: "discover" });
  assert.equal(found.pullRequest?.number, 42, JSON.stringify(found));
  assert.deepEqual(found.link, {
    url: fromFork.url,
    source: "branch",
    apiHost: host,
    head: "feature",
    base: "main",
    headRepo: "me/fork",
    baseRepo: "up/repo",
  });
  assert.deepEqual(calls(), [listed("me/fork"), listed("up/repo")]);

  await serve([otherFork, elsewhere]);
  const none = await f.change({ action: "discover" });
  assert.deepEqual([none.link, none.pullRequest, none.error], [null, null, undefined]);

  await serve([sameRepo, otherFork]);
  assert.equal((await f.change({ action: "discover" })).pullRequest?.number, 3);

  await serve([fromFork, sameRepo]);
  assert.match((await f.change({ action: "discover" })).error!, /Several/);
  assert.deepEqual(calls(), [listed("me/fork"), listed("up/repo")]);
});

test("exe.dev: discovery from a worktree that pushes to a fork searches the tracked upstream", async (t) => {
  const host = "github.int.exe.xyz";
  const { repo, worktree, git } = forkWorktree(t);
  git(repo, "remote", "set-url", "origin", `https://${host}/up/repo.git`);
  git(repo, "remote", "set-url", "fork", `https://${host}/me/fork.git`);
  const f = await fixture(t, worktree);
  const pr = (number: number, owner: string, name: string) => ({
    ...candidate(number, "feat", owner),
    url: `https://github.com/up/repo/pull/${number}`,
    headRepository: { name },
    baseRefName: "main",
  });
  f.control({
    prs: [pr(7, "up", "repo"), pr(42, "me", "fork"), pr(8, "someone", "fork")],
    expectedHost: host,
    expectedRepos: [`${host}/up/repo`, `${host}/me/fork`],
  });
  const found = await f.get();
  assert.equal(found.pullRequest?.number, 42, JSON.stringify(found));
  assert.deepEqual([found.link?.headRepo, found.link?.baseRepo], ["me/fork", "up/repo"]);
});
