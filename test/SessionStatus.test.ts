/**
 * Status read from saved history, as after a restart: what Pi's file proves, and what it does not.
 * The live dispositions and the worktree journey are covered end to end in DispatchFanOut.test.ts.
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
import { Registry, RegistryDatabasePath } from "../server/Registry.ts";
import { SessionStatus, SessionStatusLive } from "../server/SessionStatus.ts";
import { WorkspaceChangesLive } from "../server/WorkspaceChanges.ts";
import { LAST_ANSWER_CHARS } from "../shared/dispatch.ts";
import type { PullRequest } from "../shared/wire.ts";

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
const run = <A, E>(effect: Effect.Effect<A, E, SessionStatus | Registry>) =>
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
