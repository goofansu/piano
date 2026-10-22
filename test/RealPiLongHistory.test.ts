/**
 * Real locked CLI: a session whose lifetime history outgrows Pi's RPC line limit, while repeated
 * compactions keep its active context small, still resumes. Runs' spend and the dispatching
 * session are counted from the whole history, never from one `get_entries` reply.
 */
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { inboundLimits } from "../server/InboundCapacity.ts";
import { PiCli } from "../server/PiCli.ts";
import { PiSessionsLive } from "../server/PiSessions.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionHosts, SessionHostsLive } from "../server/SessionHosts.ts";
import { DISPATCH_ENTRY } from "../shared/dispatch.ts";
import { createPiCompatibilityFixture } from "./fixtures/PiCompatibility.ts";

const messageBytes = 64 * 1024;
const groups = 66;
const perGroup = 8;

test("a compacted session beyond the RPC line limit previews, resumes and runs a command", {
  timeout: 120_000,
}, async () => {
  const fixture = await createPiCompatibilityFixture();
  fixture.configureSentinel("disabled");
  const oldEnv = [process.env.PI_CODING_AGENT_DIR, process.env.PI_CODING_AGENT_SESSION_DIR];
  process.env.PI_CODING_AGENT_DIR = fixture.agentDir;
  process.env.PI_CODING_AGENT_SESSION_DIR = fixture.sessionDir;
  const cwd = fixture.project("long-history");
  try {
    // Legitimate history through Pi's own SDK: a dispatch record, then repeated groups of large prompts each closed by a compaction.
    const manager = SessionManager.create(cwd, fixture.sessionDir);
    manager.appendCustomEntry(DISPATCH_ENTRY, { parentSessionId: "parent-session" });
    let peakContext = 0;
    for (let group = 0; group < groups; group++) {
      for (let i = 0; i < perGroup; i++)
        manager.appendMessage({
          role: "user",
          content: `${group}:${i} ${"x".repeat(messageBytes)}`,
          timestamp: Date.now(),
        });
      peakContext = Math.max(
        peakContext,
        JSON.stringify(manager.buildSessionContext().messages).length,
      );
      manager.appendCompaction(`SUMMARY_${group}`, null as unknown as string, 131072);
    }
    manager.appendMessage({ role: "user", content: "FINAL_SMALL_PROMPT", timestamp: Date.now() });
    const id = manager.getSessionId(),
      file = manager.getSessionFile()!;
    const finalContext = JSON.stringify(manager.buildSessionContext().messages).length;
    const fileBytes = statSync(file).size;
    assert.ok(fileBytes > inboundLimits.rpcLineBytes, `history is ${fileBytes} bytes`);
    assert.ok(peakContext < 1024 * 1024, `peak active context is ${peakContext} bytes`);
    assert.ok(finalContext < 4096, `final active context is ${finalContext} bytes`);

    await Effect.runPromise(
      Effect.gen(function* () {
        const hosts = yield* SessionHosts,
          registry = yield* Registry;
        yield* registry.addSession(cwd, id);
        const preview = yield* hosts.read(cwd, id);
        assert.ok(preview._tag === "saved");
        const previewText = preview.snapshot.messages.map((m) => m.text).join("\n");
        assert.match(previewText, /SUMMARY_65/);
        assert.match(previewText, /FINAL_SMALL_PROMPT/);

        const session = yield* hosts.open({ cwd, sessionId: id });
        const state = yield* session.state;
        assert.equal(state.closure, undefined);
        assert.equal(state.sessionFile, file);
        assert.equal(state.dispatchedFrom, "parent-session");
        assert.equal(state.statsRefreshError, undefined);

        yield* session.act({ _tag: "prompt", text: "/phase0-facts" });
        const facts = fixture.observe().pi.filter((record) => record.event === "facts");
        assert.equal(facts.length, 1, "the resumed child ran the command");
        assert.equal((yield* session.state).closure, undefined);
        yield* hosts.release(cwd, id);
      }).pipe(
        Effect.timeout("90 seconds"),
        Effect.scoped,
        Effect.provide(
          SessionHostsLive({ idleMs: 0 }).pipe(
            Layer.provide(PiSessionsLive),
            Layer.provideMerge(RegistryLive),
            Layer.provide(NodeServices.layer),
          ),
        ),
        Effect.provideService(RegistryDatabasePath, join(fixture.root, "registry.db")),
        Effect.provideService(PiCli, fixture.cli()),
      ),
    );
    assert.equal(fixture.observe().requests.length, 0, "no model request");
  } finally {
    for (const [i, key] of ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR"].entries()) {
      if (oldEnv[i] === undefined) delete process.env[key];
      else process.env[key] = oldEnv[i];
    }
    // Asserts every fixture Pi child has exited.
    await fixture.close();
  }
});
