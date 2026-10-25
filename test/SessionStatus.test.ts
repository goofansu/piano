/**
 * Status read from saved history, as after a restart: what Pi's file proves, and what it does not;
 * and from a live host that looks idle but still has work Piano cannot vouch for. The other live
 * dispositions and the worktree journey are covered end to end in DispatchFanOut.test.ts.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { GitHubPullRequests, PullRequestError } from "../server/GitHubPullRequests.ts";
import { PianoCoreLive } from "../server/PianoServices.ts";
import { PiCli } from "../server/PiCli.ts";
import { PiRequestTimeoutMs, type PiSession } from "../server/PiSessions.ts";
import { Registry, RegistryDatabasePath } from "../server/Registry.ts";
import { SessionHosts } from "../server/SessionHosts.ts";
import { SessionStatus, SessionStatusLive, StatusChangesMs } from "../server/SessionStatus.ts";
import { GitCommand } from "../server/Subprocess.ts";
import { WorkspaceChangesLive } from "../server/WorkspaceChanges.ts";
import { LAST_ANSWER_CHARS } from "../shared/dispatch.ts";
import { dispositionOf, lastAnswerOf } from "../shared/sessionStatus.ts";
import type { PullRequest, RenderMsg, Snapshot } from "../shared/wire.ts";

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

/** A Pi session file, as Pi saves it. */
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

/** GitHub answers one pull request as merged; any other lookup fails. */
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
        cli: new URL("./fake-pi.mjs", import.meta.url).pathname,
        extraArgs: [],
      }),
      Effect.provideService(RegistryDatabasePath, join(root, `registry-${++databases}.db`)),
      Effect.timeout("10 seconds"),
    ),
  );

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

      // A failed turn still stopped: settled is execution, not success (INV-03). It has no answer.
      const failed = yield* read("failed");
      assert.deepEqual([failed.disposition, failed.lastAnswer], ["settled", null]);
      // History that stops mid-turn or before any reply proves no ending: never a guess.
      for (const id of ["cut-off", "unanswered"]) {
        const s = yield* read(id);
        assert.deepEqual([s.disposition, s.lastAnswer], ["unknown", null], id);
      }
      assert.ok(!(yield* registry.get).sessions.some((s) => s.archived), "reading changes nothing");
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

      // A command Pi applied but never acknowledged may still be running: not idle, not proven.
      const renamed = yield* live("live-rename");
      const rename = yield* renamed
        .act({ _tag: "set_name", name: "withhold acknowledgement" })
        .pipe(Effect.flip);
      assert.equal(rename.reason, "timeout");
      assert.equal((yield* renamed.state).isStreaming, false);
      assert.equal(yield* disposition("live-rename"), "running");

      // A prompt Pi never acknowledged, on an idle Pi: Piano cannot tell whether it will run.
      const ignored = yield* live("live-ignored");
      yield* ignored.act({ _tag: "prompt", text: "ignore input" }).pipe(Effect.flip);
      assert.equal((yield* ignored.state).submission?.outcome, "uncertain");
      assert.equal((yield* ignored.state).isStreaming, false);
      assert.equal(yield* disposition("live-ignored"), "unknown");
    }).pipe(Effect.provideService(PiRequestTimeoutMs, 1000)),
  );
});

test("a status answers within its changes budget: a Git that is slower leaves changes null beside the other facts", async () => {
  // Real Git, except that a diff takes longer than the read allows for changes.
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
  // Pi exited mid-run and its host has not been retired yet: exited, not running; one Piano
  // released idle before exiting reads settled, whatever the host had not confirmed yet.
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
  assert.equal(answerOf({ stopReason: "length" }), "Half an answer", "cut off, but finished");
  // Still being written, waiting on a tool, interrupted or failed: text that is not an answer.
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
