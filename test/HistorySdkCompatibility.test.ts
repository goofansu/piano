import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import workerThreads, { Worker } from "node:worker_threads";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, ManagedRuntime } from "effect";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";

for (const mode of ["narrow", "missing", "exports", "dependency", "initialization"]) {
  test(`INV-01/12: saved history SDK compatibility (${mode})`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), "piano-history-sdk-"));
    const runtime = ManagedRuntime.make(PiSessionsLive.pipe(Layer.provide(NodeServices.layer)));
    // Fault the module-loading boundary in a real worker, not Pi's parser or history projection.
    // The worker intentionally discards server/test preloads, so give only this worker a loader.
    const RealWorker = Worker;
    t.mock.method(
      workerThreads,
      "Worker",
      class extends RealWorker {
        constructor(file: string | URL, options?: workerThreads.WorkerOptions) {
          super(file, {
            ...options,
            execArgv: [
              "--import",
              new URL("./fixtures/history-sdk-loader.ts", import.meta.url).href,
            ],
            workerData: { historySdkMode: mode },
          });
        }
      },
    );
    syncBuiltinESMExports();
    try {
      const history = await runtime.runPromise(Effect.map(PiSessions, (pi) => pi.history));
      // Produce the tree with the installed PUBLIC SDK. Expected projection is a worked example,
      // not a second call to Pi's projection algorithm.
      const manager = SessionManager.create(root, root);
      manager.appendModelChange("router", "auto");
      manager.appendThinkingLevelChange("low");
      manager.appendMessage({ role: "user", content: "summarized", timestamp: 1 });
      const kept = manager.appendMessage({ role: "user", content: "kept", timestamp: 2 });
      manager.appendMessage({ role: "user", content: "abandoned", timestamp: 3 });
      manager.branch(kept);
      manager.appendContextEdit(kept, { content: "edited" });
      manager.appendCompaction("summary", kept, 30);
      // Pi flushes persisted sessions after their first assistant reply. For this user-only tree,
      // serialize its entries explicitly; all parser, tree and migration logic stays real.
      const file = join(root, "history.jsonl");
      const original =
        [manager.getHeader(), ...manager.getEntries()].map((e) => JSON.stringify(e)).join("\n") +
        "\n{unfinished";
      writeFileSync(file, original);
      const snapshot = await runtime.runPromise(history.peek(manager.getSessionId(), file));
      if (mode === "dependency" || mode === "initialization") {
        assert.deepEqual(snapshot.messages, []);
        assert.match(snapshot.state.projectionError ?? "", /History was not replaced or repaired/);
        return;
      }
      assert.equal(snapshot.state.projectionError, undefined);
      assert.equal(snapshot.state.model, "router/auto");
      assert.equal(snapshot.state.thinkingLevel, "low");
      assert.deepEqual(
        snapshot.messages.map((m) => m.text),
        ["summary", "edited"],
      );
      assert.equal(readFileSync(file, "utf8"), original);

      // Legacy v1 has no tree IDs; Pi supplies them in memory. Malformed lines stay tolerated.
      const legacy =
        [
          { type: "session", version: 1, id: "legacy", cwd: root },
          {
            type: "message",
            message: { role: "user", content: "legacy conversation", timestamp: 1 },
          },
          {
            type: "message",
            message: {
              role: "hookMessage",
              customType: "legacy",
              content: "legacy extension",
              display: true,
              timestamp: 2,
            },
          },
        ]
          .map((e) => JSON.stringify(e))
          .join("\n") + "\nnot-json";
      writeFileSync(file, legacy);
      const migrated = await runtime.runPromise(history.peek("legacy", file));
      assert.deepEqual(
        migrated.messages.map((m) => m.text),
        ["legacy conversation", "legacy extension"],
      );
      assert.equal(readFileSync(file, "utf8"), legacy, "migration stays in memory");
      const mismatch = await runtime.runPromise(history.peek("wrong-session", file));
      assert.match(mismatch.state.projectionError ?? "", /History was not replaced or repaired/);
      writeFileSync(file, "{broken");
      const broken = await runtime.runPromise(history.peek("legacy", file));
      assert.match(broken.state.projectionError ?? "", /History was not replaced or repaired/);
      assert.equal(readFileSync(file, "utf8"), "{broken");
      writeFileSync(file, legacy);
      assert.deepEqual(
        (await runtime.runPromise(history.peek("legacy", file))).messages,
        migrated.messages,
      );
    } finally {
      await runtime.dispose();
      t.mock.restoreAll();
      syncBuiltinESMExports();
      rmSync(root, { recursive: true, force: true });
    }
  });
}
