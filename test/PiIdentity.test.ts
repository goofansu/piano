import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { PiCli } from "../server/PiCli.ts";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";
import type { RenderMsg } from "../shared/wire.ts";
import { sessionFiles } from "../web/src/lib/sessionFiles.ts";

const layer = PiSessionsLive.pipe(Layer.provide(NodeServices.layer));
const cli = {
  node: process.execPath,
  cli: new URL("./fake-pi.mjs", import.meta.url).pathname,
  extraArgs: [],
};
const path = "keys/sk-abcdefghijklmnopqrstuvwxyz123456.ts";
const secret = "sk-content-abcdefghijklmnopqrstuvwxyz";
const messages = [
  {
    role: "assistant",
    content: [
      { type: "toolCall", id: "write1", name: "write", arguments: { path, content: secret } },
    ],
  },
  {
    role: "toolResult",
    toolCallId: "write1",
    toolName: "write",
    content: "written",
    isError: false,
    nestedCalls: {
      complete: true,
      calls: [
        {
          id: "write1/edit",
          name: "edit",
          arguments: { file_path: "keys/ghp_nested123456789.ts", newText: secret },
          status: "ok",
        },
        { id: "write1/failed", name: "edit", arguments: { path: "failed.ts" }, status: "error" },
        {
          id: "write1/pending",
          name: "write",
          arguments: { path: "pending.ts" },
          status: "unfinished",
        },
        { id: "write1/read", name: "read", arguments: { path: "read.ts" }, status: "ok" },
      ],
    },
  },
];

test("INV-01/11/12: live writes and nested edits retain file identity across events and readback", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: process.cwd(),
        sessionId: "file-identity",
      });
      const ready = yield* Deferred.make<void>();
      const observed = yield* session.events.pipe(
        Stream.tap((event) =>
          event._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
        ),
        Stream.takeUntil(
          (event) => event._tag === "message_end" && event.message.role === "tool_result",
        ),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Deferred.await(ready);
      yield* session.act({ _tag: "prompt", text: "identity files" });
      const events = yield* Fiber.join(observed);
      const live: RenderMsg[] = events.flatMap((event) =>
        event._tag === "message_end" ? [event.message] : [],
      );
      const expected = [
        { path, messageId: "m1" },
        { path: "keys/ghp_nested123456789.ts", messageId: "m2" },
      ];
      assert.deepEqual(sessionFiles(live), expected);
      const tools = events.flatMap((event) => (event._tag === "tool_update" ? [event.tool] : []));
      assert.equal(tools.at(-1)?.writtenPath, "keys/ghp_nested123456789.ts");
      assert.equal(tools.at(-1)?.status, "success");
      assert.ok(!JSON.stringify(events).includes(secret));
      // A handled command triggers Pi's authoritative context readback, not only the live fold.
      yield* session.act({ _tag: "prompt", text: "handled input" });
      const [snapshot] = yield* session.events.pipe(Stream.take(1), Stream.runCollect);
      assert.equal(snapshot._tag, "snapshot");
      if (snapshot._tag !== "snapshot") return;
      assert.deepEqual(sessionFiles(snapshot.snapshot.messages), expected);
      assert.ok(!JSON.stringify(snapshot).includes(secret));
    }).pipe(
      Effect.timeout("5 seconds"),
      Effect.scoped,
      Effect.provide(layer),
      Effect.provideService(PiCli, cli),
    ),
  );
});

test("INV-01/11/12: saved supported writes retain file identity, not secret display arguments", async () => {
  const root = mkdtempSync(join(tmpdir(), "piano-identity-"));
  const file = join(root, "saved.jsonl");
  writeFileSync(
    file,
    [
      {
        type: "session",
        version: 3,
        id: "identity",
        cwd: root,
        timestamp: new Date().toISOString(),
      },
      ...messages.map((message, i) => ({
        type: "message",
        id: `entry${i}`,
        parentId: i ? `entry${i - 1}` : null,
        timestamp: new Date().toISOString(),
        message,
      })),
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
  );
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* PiSessions;
        const snapshot = yield* sessions.history.peek("identity", file);
        assert.deepEqual(sessionFiles(snapshot.messages), [
          { path, messageId: "m0" },
          { path: "keys/ghp_nested123456789.ts", messageId: "m1" },
        ]);
        assert.ok(snapshot.messages[0].toolCalls![0].args.includes("[REDACTED]"));
        assert.ok(!JSON.stringify(snapshot).includes(secret));
      }).pipe(Effect.provide(layer)),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
