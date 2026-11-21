import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { PianoCoreLive } from "../../../server/app/PianoServices.ts";
import {
  SessionStatus,
  SessionStatusLive,
  StatusChangesMs,
} from "../../../server/features/dispatch/SessionStatus.ts";
import { PiCli } from "../../../server/features/sessions/pi/PiCli.ts";
import {
  PiRequestTimeoutMs,
  type PiSession,
} from "../../../server/features/sessions/pi/PiSessions.ts";
import { SessionHosts } from "../../../server/features/sessions/SessionHosts.ts";
import { WorkspaceChangesLive } from "../../../server/features/workspace/changes/WorkspaceChanges.ts";
import {
  GitHubPullRequests,
  PullRequestError,
} from "../../../server/features/workspace/pull-requests/GitHubPullRequests.ts";
import { Registry, RegistryDatabasePath } from "../../../server/shared/registry/Registry.ts";
import { GitCommand } from "../../../server/shared/Subprocess.ts";
import { LAST_ANSWER_CHARS } from "../../../shared/features/dispatch/dispatch.ts";
import {
  dialogAsks,
  dispositionOf,
  lastAnswerOf,
} from "../../../shared/features/sessions/sessionStatus.ts";
import type { PullRequest, RenderMsg, Snapshot } from "../../../shared/wire.ts";
import { largeHistory } from "../../fixtures/large-history.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-status-")));
mkdirSync(join(root, "sessions"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
after(() => rmSync(root, { recursive: true, force: true }));

const plain = join(root, "plain");
mkdirSync(plain);
const repo = join(root, "repo");
mkdirSync(repo);
execFileSync("git", ["-C", repo, "init", "-q", "-b", "fix-login"]);
execFileSync("git", [
  "-C",
  repo,
  "-c",
  "user.name=T",
  "-c",
  "user.email=t@example.invalid",
  "commit",
  "-q",
  "--allow-empty",
  "-m",
  "init",
]);

const saved = (cwd: string, id: string, messages: ReadonlyArray<Record<string, unknown>>) => {
  let parentId: string | null = null;
  const entries = [
    { type: "session", version: 3, id, cwd, timestamp: "2026-10-21T00:00:00Z" },
    ...messages.map((message, i) => {
      const entry = {
        type: "message",
        id: `${id}-${i}`,
        parentId,
        timestamp: "2026-10-21T00:00:01Z",
        message: { timestamp: i, ...message },
      };
      parentId = entry.id;
      return entry;
    }),
  ];
  writeFileSync(
    join(root, "sessions", `${id}.jsonl`),
    `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`,
  );
};
const user = (text: string) => ({ role: "user", content: text });
const reply = (text: string, stopReason = "stop") => ({
  role: "assistant",
  content: [{ type: "text", text }],
  provider: "fake",
  model: "alpha",
  stopReason,
});

const github = Layer.succeed(GitHubPullRequests, {
  view: (link: { readonly url: string }) =>
    link.url.endsWith("/pull/7")
      ? Effect.succeed({ state: "merged" } as PullRequest)
      : Effect.fail(new PullRequestError({ detail: "gh is not signed in" })),
  candidates: () => Effect.succeed([]),
} as unknown as GitHubPullRequests["Service"]);

let databases = 0;
const run = <A, E>(effect: Effect.Effect<A, E, SessionStatus | Registry | SessionHosts>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.scoped,
      Effect.provide(
        SessionStatusLive.pipe(
          Layer.provide(github),
          Layer.provide(WorkspaceChangesLive),
          Layer.provideMerge(PianoCoreLive({ idleMs: 0 })),
          Layer.provide(NodeServices.layer),
        ),
      ),
      Effect.provideService(PiCli, {
        node: process.execPath,
        cli: new URL("../../fake-pi.mjs", import.meta.url).pathname,
        extraArgs: [],
      }),
      Effect.provideService(RegistryDatabasePath, join(root, `registry-${++databases}.db`)),
      Effect.timeout("10 seconds"),
    ),
  );

test("concurrent status reads share large saved projections rather than queueing one per caller", async (t) => {
  const id = "large-status";
  const file = join(root, "sessions", `${id}.jsonl`);
  largeHistory(file, id, plain);
  await run(
    Effect.gen(function* () {
      const registry = yield* Registry;
      const status = yield* SessionStatus;
      yield* registry.addSession(plain, id);
      yield* status.read({ sessionId: id });
      const start = process.cpuUsage();
      const expected = yield* status.read({ sessionId: id });
      const single = process.cpuUsage(start);
      const concurrentStart = process.cpuUsage();
      const results = yield* Effect.all(
        Array.from({ length: 16 }, () => status.read({ sessionId: id })),
        { concurrency: "unbounded" },
      );
      const concurrent = process.cpuUsage(concurrentStart);
      for (const result of results) assert.deepEqual(result, expected);
      t.diagnostic(
        JSON.stringify({
          singleCpuMs: (single.user + single.system) / 1000,
          concurrent16CpuMs: (concurrent.user + concurrent.system) / 1000,
        }),
      );
      assert.ok(
        concurrent.user + concurrent.system < 8 * (single.user + single.system),
        "status callers must not serialize duplicate full-history projections behind the host lock",
      );
      saved(plain, id, [user("updated"), reply("Fresh answer")]);
      assert.equal((yield* status.read({ sessionId: id }))[0].lastAnswer, "Fresh answer");
    }),
  );
});

test("a stopped session's history proves settlement only when it ends with a finished reply", async () => {
  const long = "x".repeat(LAST_ANSWER_CHARS + 50);
  saved(plain, "finished", [user("fix it"), reply(long)]);
  saved(plain, "failed", [user("fix it"), reply("partial", "error")]);
  saved(plain, "cut-off", [user("fix it"), reply("calling a tool", "toolUse")]);
  saved(plain, "unanswered", [user("fix it")]);
  await run(
    Effect.gen(function* () {
      const registry = yield* Registry;
      const status = yield* SessionStatus;
      for (const id of ["finished", "failed", "cut-off", "unanswered"])
        yield* registry.addSession(plain, id);
      const read = (sessionId: string) => status.read({ sessionId }).pipe(Effect.map(([s]) => s!));

      const finished = yield* read("finished");
      assert.equal(finished.disposition, "settled");
      assert.equal(finished.lastAnswer, long.slice(0, LAST_ANSWER_CHARS), "the answer is bounded");
      assert.equal(finished.needs, null);
      assert.equal(finished.changes, null, "a directory outside Git has no changes to report");

      const failed = yield* read("failed");
      assert.deepEqual([failed.disposition, failed.lastAnswer], ["settled", null]);
      for (const id of ["cut-off", "unanswered"]) {
        const s = yield* read(id);
        assert.deepEqual([s.disposition, s.lastAnswer], ["unknown", null], id);
      }
      assert.ok(!(yield* registry.get).sessions.some((s) => s.archived), "reading changes nothing");
    }),
  );
});

test("an archived session's status is refused as archived, not read as unknown", async () => {
  saved(plain, "shelved", [user("fix it"), reply("done")]);
  await run(
    Effect.gen(function* () {
      const registry = yield* Registry;
      const status = yield* SessionStatus;
      yield* registry.addSession(plain, "shelved");
      assert.equal((yield* status.read({ sessionId: "shelved" }))[0]?.disposition, "settled");
      yield* registry.archiveSession(plain, "shelved");
      const refused = yield* status.read({ sessionId: "shelved" }).pipe(Effect.flip);
      assert.match(refused.detail, /archived/);
      assert.match(refused.detail, /Data controls/);
    }),
  );
});

test("a session ID registered under two directories is refused, not guessed; one listing reads", async () => {
  saved(plain, "twice", [user("fix it"), reply("done")]);
  await run(
    Effect.gen(function* () {
      const registry = yield* Registry;
      const status = yield* SessionStatus;
      yield* registry.addSession(plain, "twice");
      assert.equal((yield* status.read({ sessionId: "twice" }))[0]?.cwd, plain);
      yield* registry.addSession(repo, "twice");
      for (const archived of [false, true]) {
        if (archived) {
          const entry = (yield* registry.get).sessions.find((s) => s.cwd === repo)!;
          yield* registry.archiveSession(entry.cwd, entry.sessionId);
        }
        const refused = yield* status.read({ sessionId: "twice" }).pipe(Effect.flip);
        assert.match(refused.detail, /more than one directory/);
        assert.ok(refused.detail.includes(plain) && refused.detail.includes(repo));
      }
      const unknown = yield* status.read({ sessionId: "nowhere" }).pipe(Effect.flip);
      assert.match(unknown.detail, /lists no session nowhere/);
    }),
  );
});

test("a session's changes name its branch and linked pull request, with state only when GitHub answers", async () => {
  saved(repo, "linked", [user("open a PR"), reply("Opened #7.")]);
  saved(repo, "unreadable", [user("open a PR"), reply("Opened #8.")]);
  await run(
    Effect.gen(function* () {
      const registry = yield* Registry;
      const status = yield* SessionStatus;
      yield* registry.saveProject({ id: "launch", name: "Launch" });
      for (const [id, number] of [
        ["linked", 7],
        ["unreadable", 8],
      ] as const) {
        yield* registry.addSession(repo, id, undefined, "launch");
        const entry = (yield* registry.get).sessions.find((s) => s.sessionId === id)!;
        yield* registry.setSessionLink(entry, "pullRequest", {
          url: `https://github.com/acme/app/pull/${number}`,
          source: "manual",
        });
      }
      writeFileSync(join(repo, "login.ts"), "export {};\n");
      const project = yield* status.read({ projectId: "launch" });
      assert.deepEqual(
        project.map((s) => [s.sessionId, s.projectId, s.changes]),
        [
          [
            "linked",
            "launch",
            {
              branch: "fix-login",
              files: 1,
              pullRequest: {
                number: 7,
                url: "https://github.com/acme/app/pull/7",
                state: "merged",
              },
            },
          ],
          [
            "unreadable",
            "launch",
            {
              branch: "fix-login",
              files: 1,
              pullRequest: { number: 8, url: "https://github.com/acme/app/pull/8", state: null },
            },
          ],
        ],
      );
      const missing = yield* status.read({ sessionId: "nobody" }).pipe(Effect.flip);
      assert.equal(missing.detail, "Piano lists no session nobody.");
      const unknownProject = yield* status.read({ projectId: "nope" }).pipe(Effect.flip);
      assert.equal(unknownProject.detail, "Piano has no project nope.");
    }),
  );
});

test("a live session that looks idle reads settled only once Piano has nothing pending for it", async () => {
  await run(
    Effect.gen(function* () {
      const registry = yield* Registry;
      const hosts = yield* SessionHosts;
      const status = yield* SessionStatus;
      const disposition = (sessionId: string) =>
        status.read({ sessionId }).pipe(Effect.map(([s]) => s!.disposition));
      const quiescent = Effect.fn(function* (session: PiSession) {
        for (let n = 0; n < 200 && !(yield* session.state).isQuiescent; n++)
          yield* Effect.sleep("10 millis");
        assert.equal((yield* session.state).isQuiescent, true);
      });
      const live = Effect.fn(function* (sessionId: string) {
        yield* registry.addSession(plain, sessionId);
        const session = yield* hosts.open({ cwd: plain, sessionId });
        yield* quiescent(session);
        assert.equal(yield* disposition(sessionId), "settled", "an idle host with nothing pending");
        return session;
      });

      const renamed = yield* live("live-rename");
      const rename = yield* renamed
        .act({ _tag: "set_name", name: "withhold acknowledgement" })
        .pipe(Effect.flip);
      assert.equal(rename.reason, "timeout");
      assert.equal((yield* renamed.state).isStreaming, false);
      assert.equal(yield* disposition("live-rename"), "running");

      const ignored = yield* live("live-ignored");
      yield* ignored.act({ _tag: "prompt", text: "ignore input" }).pipe(Effect.flip);
      assert.equal((yield* ignored.state).submission?.outcome, "uncertain");
      assert.equal((yield* ignored.state).isStreaming, false);
      assert.equal(yield* disposition("live-ignored"), "unknown");
    }).pipe(Effect.provideService(PiRequestTimeoutMs, 1000)),
  );
});

test("a status answers within its changes budget: a Git that is slower leaves changes null beside the other facts", async () => {
  const slowGit = join(root, "slow-git");
  writeFileSync(
    slowGit,
    `#!${process.execPath}\nimport {spawnSync} from 'node:child_process';
const a=process.argv.slice(2);if(a.includes('diff'))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,3000);
const r=spawnSync('git',a,{stdio:'inherit'});process.exit(r.status??1);\n`,
    { mode: 0o755 },
  );
  saved(repo, "slow", [user("fix it"), reply("Done.")]);
  await run(
    Effect.gen(function* () {
      const registry = yield* Registry;
      const status = yield* SessionStatus;
      yield* registry.addSession(repo, "slow");
      const started = Date.now();
      const [s] = yield* status.read({ sessionId: "slow" });
      assert.ok(Date.now() - started < 2000, "the read does not wait for Git");
      assert.deepEqual(
        [s!.disposition, s!.lastAnswer, s!.changes],
        ["settled", "Done.", null],
        "what Piano holds arrives; the Git view it could not read in time is null",
      );
    }).pipe(
      Effect.provideService(GitCommand, slowGit),
      Effect.provideService(StatusChangesMs, 300),
    ),
  );
});

test("the shared reading: a stopped Pi reads from its closure, and only a completed reply is an answer", () => {
  const snapshot = (
    state: Partial<Snapshot["state"]>,
    messages: ReadonlyArray<RenderMsg> = [],
  ): Snapshot => ({
    state: { sessionId: "s", isStreaming: false, ...state },
    messages,
    dialogs: [],
  });
  const working = { isStreaming: true };
  for (const closure of [
    { _tag: "exited", code: 1, detail: "Pi exited (code 1)" },
    { _tag: "failed", detail: "exit not observed" },
    { _tag: "released_during_work", detail: "released while working" },
    { _tag: "stopped", detail: "archived while working" },
  ] as const)
    assert.equal(dispositionOf(snapshot({ ...working, closure }), true).disposition, "exited");
  assert.equal(
    dispositionOf(
      snapshot({ isQuiescent: false, closure: { _tag: "released", detail: "idle" } }),
      true,
    ).disposition,
    "settled",
  );
  assert.equal(dispositionOf(snapshot(working), true).disposition, "running");

  const reply = (text: string, over: Partial<RenderMsg>): RenderMsg => ({
    id: "a1",
    role: "assistant",
    text,
    ...over,
  });
  const prompt: RenderMsg = { id: "u1", role: "user", text: "fix it" };
  const answerOf = (over: Partial<RenderMsg>) =>
    lastAnswerOf(snapshot({}, [prompt, reply("Half an answer", over)]));
  assert.equal(answerOf({ stopReason: "stop" }), "Half an answer");
  const straddling = lastAnswerOf(
    snapshot({}, [prompt, reply(`abc\u{1F600}def`, { stopReason: "stop" })]),
    4,
  );
  assert.equal(straddling, "abc");
  assert.equal(answerOf({ stopReason: "length" }), "Half an answer", "cut off, but finished");
  for (const over of [
    {},
    { stopReason: "pending" },
    { stopReason: "toolUse" },
    { stopReason: "aborted" },
    { stopReason: "error" },
    { stopReason: "stop", isError: true },
  ])
    assert.equal(answerOf(over), null, JSON.stringify(over));
});

test("what a waiting dialog asks: its title, else its message, else the kind of answer", () => {
  const asking = (over: Partial<Snapshot["dialogs"][number]>) =>
    dialogAsks({
      id: "d1",
      generation: "g1",
      receivedAt: 0,
      deadlineAt: null,
      deadlineKind: "pi-timeout",
      method: "confirm",
      ...over,
    });
  assert.equal(
    asking({ title: "Overwrite config?", message: "This replaces config.json" }),
    "Overwrite config?",
  );
  assert.equal(
    asking({ title: " ", message: "This replaces config.json" }),
    "This replaces config.json",
  );
  assert.equal(asking({ title: "" }), "Pi is waiting for a confirm answer.");
});
