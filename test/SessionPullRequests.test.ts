import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type TestContext, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Effect, Layer, ManagedRuntime } from "effect";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionPullRequests, SessionPullRequestsLive } from "../server/SessionPullRequests.ts";
import { GhCommand } from "../server/Subprocess.ts";

const candidate = (number: number, branch = "feature", owner = "example") => ({
  url: `https://github.com/example/repo/pull/${number}`, number, title: `Work ${number}`,
  state: "OPEN", isDraft: false, reviewDecision: "APPROVED", statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }],
  headRefName: branch, headRepository: { name: "repo" }, headRepositoryOwner: { login: owner },
});
async function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "piano-session-pr-")), repo = join(root, "repo"), bin = join(root, "bin");
  mkdirSync(repo); mkdirSync(bin);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).trim();
  git("init", "-q", "-b", "feature"); git("commit", "--allow-empty", "-qm", "base"); git("remote", "add", "origin", "git@github.com:example/repo.git");
  const path = join(root, "registry.db"), forge = join(root, "forge.json"), gh = join(bin, "gh");
  // The fake reads its fixture from the child's environment; nothing global changes.
  writeFileSync(gh, `#!${process.execPath}\nprocess.env.PIANO_TEST_GH_FIXTURE = ${JSON.stringify(forge)};\nawait import(${JSON.stringify(resolve("test/fixtures/fake-gh.mjs"))});\n`, { mode: 0o755 });
  const control = (data: object) => writeFileSync(forge, JSON.stringify(data));
  control({ prs: [candidate(42), candidate(99, "feature", "unrelated-fork")] });
  const layer = SessionPullRequestsLive.pipe(Layer.provideMerge(RegistryLive), Layer.provide([Layer.succeed(RegistryDatabasePath, path), Layer.succeed(GhCommand, gh)]));
  const runtime = ManagedRuntime.make(layer);
  const registry = await runtime.runPromise(Registry), prs = await runtime.runPromise(SessionPullRequests);
  await runtime.runPromise(registry.addSession(repo, "one"));
  await runtime.runPromise(registry.addSession(repo, "two"));
  t.after(async () => {
    await runtime.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  // Stand in for the router: resolve the entry by identity, then hand it to the module.
  const getIn = (from: ManagedRuntime.ManagedRuntime<SessionPullRequests | Registry, unknown>, id = "one") => from.runPromise(Effect.gen(function* () {
    const s = (yield* (yield* Registry).get).sessions.find(s => s.cwd === repo && s.sessionId === id);
    return yield* (yield* SessionPullRequests).get(s!);
  }));
  const get = (id = "one") => getIn(runtime, id);
  const change = (action: Parameters<typeof prs.change>[1], id = "one") => runtime.runPromise(Effect.gen(function* () {
    const s = (yield* registry.get).sessions.find(s => s.cwd === repo && s.sessionId === id);
    return yield* prs.change(s!, action);
  }));
  return { root, repo, path, git, control, runtime, registry, prs, get, getIn, change, layer };
}

test("INV-01/07: discovers by branch AND head repository, pins identity across branch changes/restart, scopes manual links/removal to a session", async t => {
  const f = await fixture(t);
  const first = await f.get();
  assert.equal(first.pullRequest?.number, 42); assert.equal(first.link?.source, "branch");
  assert.equal(first.pullRequest?.checks, "success"); assert.equal(first.pullRequest?.review, "approved");
  f.git("switch", "-qc", "next");
  f.control({ prs: [{ ...candidate(42), state: "MERGED" }, candidate(43, "next")] });
  assert.equal((await f.get()).pullRequest?.state, "merged");
  assert.equal((await f.get("two")).pullRequest?.number, 43);
  const linked = await f.change({ action: "link", url: "https://github.com/EXAMPLE/REPO/pull/43/files?diff=split#x" });
  assert.equal(linked.link?.url, "https://github.com/example/repo/pull/43"); assert.equal(linked.link?.source, "manual");
  await f.change({ action: "remove" });
  assert.deepEqual(await f.get(), { link: null, pullRequest: null, discovery: false });
  assert.equal((await f.get("two")).pullRequest?.number, 43);
  // Preference is durable metadata, not forge facts or history.
  const persisted = await Effect.runPromise(Effect.gen(function* () { return yield* (yield* Registry).get; }).pipe(
    Effect.provide(RegistryLive), Effect.provideService(RegistryDatabasePath, f.path)));
  assert.equal(persisted.sessions[0].pullRequest, null);
  assert.deepEqual(persisted.sessions[1].pullRequest, { url: "https://github.com/example/repo/pull/43", source: "branch" });
  const restarted = ManagedRuntime.make(f.layer);
  try {
    assert.equal((await f.getIn(restarted, "one")).discovery, false);
    assert.equal((await f.getIn(restarted, "two")).pullRequest?.number, 43);
  } finally { await restarted.dispose(); }
  assert.equal((await f.change({ action: "discover" })).pullRequest?.number, 43);
});

test("unknown/auth/malformed results are not healthy absence; explicit link validation and missing checkout preserve identity", async t => {
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
  for (const url of ["https://github.com/example/repo/issues/42", "https://github.com.evil/example/repo/pull/42", "https://secret@github.com/example/repo/pull/42", "file:///tmp/pr"]) {
    await assert.rejects(f.change({ action: "link", url }), /GitHub pull request URL/);
  }
  f.control({ prs: [candidate(42)] }); await f.get();
  f.control({ error: "offline" });
  const offline = await f.get();
  assert.equal(offline.link?.url, candidate(42).url); assert.equal(offline.pullRequest, null); assert.ok(offline.error);
  const manualOffline = await f.change({ action: "link", url: candidate(42).url });
  assert.equal(manualOffline.link?.source, "manual"); assert.equal(manualOffline.pullRequest, null); assert.ok(manualOffline.error);
  f.control({ prs: [] });
  const noReplacement = await f.change({ action: "discover" });
  assert.equal(noReplacement.link?.url, candidate(42).url, "failed discovery does not remove an existing association");
  f.control({ prs: [{ ...candidate(42), state: "CLOSED" }] }); rmSync(f.repo, { recursive: true });
  assert.equal((await f.get()).pullRequest?.state, "closed", "saved PR can be read after checkout removal");
});

test("exe.dev integration routes discovery and saved/manual PR reads through gh without changing browser URLs or global host", async t => {
  const f = await fixture(t), host = "github.int.exe.xyz";
  const previousHost = process.env.GH_HOST;
  process.env.GH_HOST = "unrelated.example";
  t.after(() => { if (previousHost === undefined) delete process.env.GH_HOST; else process.env.GH_HOST = previousHost; });
  f.git("remote", "set-url", "origin", `https://${host}/example/repo.git`);
  const proxy = { prs: [candidate(42)], expectedHost: host, expectedRepo: `${host}/example/repo` };
  f.control(proxy);
  const discovered = await f.get();
  assert.deepEqual(discovered.link, { url: candidate(42).url, source: "branch", apiHost: host });
  assert.equal(discovered.pullRequest?.number, 42);
  assert.equal(process.env.GH_HOST, "unrelated.example", "host routing is child-local");
  // A later change to a normal remote does not lose the saved integration route.
  f.git("remote", "set-url", "origin", "git@github.com:example/repo.git");
  assert.equal((await f.get()).pullRequest?.number, 42);
  f.control({ ...proxy, expectedHost: "github.com", expectedRepo: "github.com/example/repo" });
  const direct = await f.change({ action: "link", url: candidate(42).url });
  assert.equal(direct.link?.apiHost, undefined); assert.equal(direct.pullRequest?.number, 42);
  // Existing canonical links (created before integration support) infer the workspace route.
  f.git("remote", "set-url", "origin", `https://${host}/example/repo.git`);
  f.control(proxy);
  assert.equal((await f.get()).pullRequest?.number, 42);
  f.git("switch", "--detach", "-q");
  const manual = await f.change({ action: "link", url: candidate(42).url });
  assert.equal(manual.link?.apiHost, host); assert.equal(manual.pullRequest?.number, 42);
  const proxyUrl = await f.change({ action: "link", url: `https://${host}/EXAMPLE/REPO/pull/42/files#diff` });
  assert.equal(proxyUrl.link?.url, candidate(42).url); assert.equal(proxyUrl.link?.apiHost, host);
  await assert.rejects(f.change({ action: "link", url: "https://github.int.exe.xyz.evil/example/repo/pull/42" }), /GitHub pull request URL/);
  f.control({ ...proxy, prs: [{ ...candidate(42), url: `https://${host}/example/repo/pull/42`, state: "MERGED" }] });
  rmSync(f.repo, { recursive: true });
  const restarted = ManagedRuntime.make(f.layer);
  try {
    const pr = await f.getIn(restarted, "one");
    assert.equal(pr.pullRequest?.state, "merged"); assert.equal(pr.pullRequest?.url, candidate(42).url);
  } finally { await restarted.dispose(); }
  f.control({ error: "integration detached", expectedHost: host });
  const unavailable = await f.get();
  assert.equal(unavailable.pullRequest, null); assert.match(unavailable.error!, /VM's GitHub integration/);
  assert.equal(unavailable.link?.apiHost, host);
});

test("INV-07: late discovery cannot undo removal/deletion or attach a candidate from a changed checkout", async t => {
  const f = await fixture(t);
  for (const mutation of ["remove", "manual", "delete", "branch", "remote"] as const) {
    const id = mutation;
    await f.runtime.runPromise(f.registry.addSession(f.repo, id));
    const started = join(f.root, `${id}-started`), release = join(f.root, `${id}-release`);
    f.control({ prs: [candidate(42)], gate: { started, release } });
    const pending = f.get(id).then(value => ({ value }), error => ({ error: String(error) }));
    for (let n = 0; !existsSync(started); n++) { if (n > 300) throw new Error("Discovery did not start"); await delay(10); }
    if (mutation === "remove") await f.change({ action: "remove" }, id);
    if (mutation === "manual") await f.change({ action: "link", url: candidate(77).url }, id);
    if (mutation === "delete") await f.runtime.runPromise(f.registry.removeSession(f.repo, id));
    if (mutation === "branch") f.git("switch", "-qc", "changed");
    if (mutation === "remote") f.git("remote", "set-url", "origin", "https://github.com/other/repo.git");
    writeFileSync(release, "go");
    const outcome = await pending;
    if ("error" in outcome) assert.match(outcome.error, /changed during lookup/);
    else { assert.equal(outcome.value.link, null); assert.match(outcome.value.error!, /checkout changed/); }
    const saved = (await f.runtime.runPromise(f.registry.get)).sessions.find(s => s.sessionId === id);
    if (mutation === "manual") assert.equal(saved?.pullRequest?.url, candidate(77).url);
    else assert.ok(!saved?.pullRequest);
    f.git("switch", "-q", "feature"); f.git("remote", "set-url", "origin", "git@github.com:example/repo.git");
  }
});
