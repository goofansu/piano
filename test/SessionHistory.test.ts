import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";

// Fixture history only: Pi reads PI_CODING_AGENT_SESSION_DIR and filters it by each file's cwd.
const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-history-")));
const cwd = join(root, "checkout"),
  alias = join(root, "alias"),
  sessions = join(root, "sessions");
mkdirSync(cwd);
symlinkSync(cwd, alias);
mkdirSync(sessions);
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = sessions;
after(() => rmSync(root, { recursive: true, force: true }));

const seed = (path: string, id: string, text: string, dir = sessions) => {
  const file = join(dir, `${text.replaceAll(" ", "-")}.jsonl`);
  writeFileSync(
    file,
    [
      { type: "session", version: 3, id, cwd: path, timestamp: "2026-10-05T00:00:00Z" },
      {
        type: "message",
        id: "saved",
        parentId: null,
        timestamp: "2026-10-05T00:00:01Z",
        message: { role: "user", content: text, timestamp: 1 },
      },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n") + "\n",
  );
  return file;
};
const run = Effect.runPromise;
// Saved sessions are read through PiSessions without starting Pi.
const history = await run(
  Effect.gen(function* () {
    return (yield* PiSessions).history;
  }).pipe(Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer)))),
);

test("INV-01: history recorded under another checkout spelling is found where Pi wrote it", async () => {
  const file = seed(alias, "legacy", "alias history"),
    before = readFileSync(file, "utf8");
  assert.deepEqual(
    await run(history.locate("legacy", [cwd])),
    { _tag: "missing" },
    "an unnamed spelling is never guessed",
  );
  assert.deepEqual(await run(history.locate("legacy", [cwd, alias])), {
    _tag: "file",
    path: file,
  });
  assert.ok((await run(history.sessionIds(alias))).has("legacy"));
  assert.equal((await run(history.sessionIds(cwd))).has("legacy"), false);
  const snapshot = await run(history.peek("legacy", file));
  assert.equal(snapshot.state.sessionFile, file);
  assert.deepEqual(
    snapshot.messages.map((m) => m.text),
    ["alias history"],
  );
  assert.equal(readFileSync(file, "utf8"), before, "reading never moves or rewrites history");
});

test("INV-01/12: peeking legacy v2 history reads the conversation without migrating its file", async () => {
  const file = seed(cwd, "v2", "legacy conversation");
  const original = readFileSync(file, "utf8").replace('"version":3', '"version":2');
  writeFileSync(file, original);
  const snapshot = await run(history.peek("v2", file));
  assert.deepEqual(
    snapshot.messages.map((m) => m.text),
    ["legacy conversation"],
  );
  assert.equal(snapshot.state.sessionFile, file);
  assert.equal(readFileSync(file, "utf8"), original, "inspection must not persist Pi's migration");
});

for (const [name, contents] of [
  ["empty", ""],
  ["malformed", '{"type":"session"'],
]) {
  test(`INV-01/12: inspecting ${name} history neither repairs it nor invents a conversation`, async () => {
    const file = join(sessions, `${name}.jsonl`);
    writeFileSync(file, contents);
    const snapshot = await run(history.peek(name, file));
    assert.equal(readFileSync(file, "utf8"), contents);
    assert.deepEqual(snapshot.messages, []);
    assert.equal(snapshot.state.sessionId, name);
    assert.match(snapshot.state.projectionError ?? "", /History was not replaced or repaired/);
    await assert.rejects(run(history.exportBranch(name, file)), {
      reason: "rejected",
      detail: "This session has no readable saved conversation to share.",
    });
    assert.equal(readFileSync(file, "utf8"), contents);
  });
}

test("INV-01: distinct files claiming one session are a conflict, never a choice", async () => {
  const first = seed(alias, "claimed", "first claim"),
    second = seed(cwd, "claimed", "second claim");
  const found = await run(history.locate("claimed", [alias, cwd]));
  assert.equal(found._tag, "conflict");
  if (found._tag === "conflict") assert.deepEqual([...found.paths].sort(), [first, second].sort());
  assert.deepEqual(await run(history.locate("claimed", [alias])), { _tag: "file", path: first });
});

test("INV-01: one physical file listed twice is still one file", async () => {
  const file = seed(cwd, "linked", "linked history");
  symlinkSync(file, join(sessions, "linked-copy.jsonl"));
  const found = await run(history.locate("linked", [cwd, alias]));
  assert.equal(found._tag, "file");
});

test("INV-01: a session without history is missing and peeks as empty", async () => {
  const empty = join(root, "empty");
  mkdirSync(empty);
  assert.deepEqual(await run(history.locate("never-written", [empty, cwd])), { _tag: "missing" });
  assert.equal((await run(history.sessionIds(empty))).size, 0);
  assert.deepEqual(await run(history.peek("never-written", undefined)), {
    state: { sessionId: "never-written", isStreaming: false },
    messages: [],
    dialogs: [],
  });
});

test("INV-01: peeking uses Pi context edits, compaction and active branch without replacing virtual selection", async () => {
  const dir = mkdtempSync(join(root, "projection-"));
  const secret = "sk-file-canary-123456789";
  try {
    const manager = SessionManager.create(dir, dir);
    manager.appendModelChange("router", "auto");
    manager.appendThinkingLevelChange("low");
    const first = manager.appendMessage({ role: "user", content: "old prompt", timestamp: 1 });
    const reply = manager.appendMessage({
      role: "assistant",
      api: "openai-completions",
      provider: "physical",
      model: "answer",
      content: [{ type: "text", text: `original ${secret}` }],
      usage: {
        input: 1,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 3,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 2,
    });
    manager.appendMessage({ role: "user", content: "abandoned branch", timestamp: 3 });
    manager.branch(reply);
    manager.appendContextEdit(reply, { content: `edited ${secret}` });
    manager.appendCompaction("summary", reply, 30);
    const file = manager.getSessionFile()!;
    const original = readFileSync(file, "utf8");
    const snap = await run(history.peek(manager.getSessionId(), file));
    assert.equal(snap.state.model, "router/auto");
    assert.equal(snap.state.thinkingLevel, "low");
    assert.deepEqual(
      snap.messages.map((m) => m.text),
      ["summary", "edited [REDACTED]"],
    );
    assert.equal(snap.messages[1].model, "physical/answer");
    assert.equal(
      snap.messages.some((m) => m.id === first),
      false,
    );
    assert.equal(
      snap.state.cost,
      undefined,
      "a file peek must not invent full-session accounting from context",
    );
    assert.equal(readFileSync(file, "utf8"), original, "redaction never rewrites Pi history");
    assert.ok(original.includes(secret));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("INV-01: a saved session names the session that dispatched it, from its own history", async () => {
  const file = join(sessions, "dispatched.jsonl");
  writeFileSync(
    file,
    [
      { type: "session", version: 3, id: "dispatched", cwd, timestamp: "2026-10-05T00:00:00Z" },
      {
        type: "custom",
        id: "origin",
        parentId: null,
        timestamp: "2026-10-05T00:00:01Z",
        customType: "piano.dispatch",
        data: { parentSessionId: "the-parent" },
      },
      {
        type: "message",
        id: "brief",
        parentId: "origin",
        timestamp: "2026-10-05T00:00:02Z",
        message: { role: "user", content: "Review the diff", timestamp: 2 },
      },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n") + "\n",
  );
  const dispatched = await run(history.peek("dispatched", file));
  assert.equal(dispatched.state.dispatchedFrom, "the-parent");
  assert.deepEqual(
    dispatched.messages.map((m) => m.text),
    ["Review the diff"],
    "the record is not a transcript message",
  );
  const own = await run(history.peek("own", seed(cwd, "own", "own history")));
  assert.equal(own.state.dispatchedFrom, undefined);
});

test("INV-01: a relative sessionDir setting is read from the folder, as the Pi child reads it", async () => {
  const folder = join(root, "relative");
  const store = join(folder, ".pi", "sessions");
  mkdirSync(store, { recursive: true });
  writeFileSync(
    join(folder, ".pi", "settings.json"),
    JSON.stringify({ sessionDir: ".pi/sessions" }),
  );
  const file = seed(folder, "relative", "relative history", store);
  // Only the setting names the store here; Pi would otherwise prefer the environment.
  const previous = process.env.PI_CODING_AGENT_SESSION_DIR;
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
  try {
    assert.ok((await run(history.sessionIds(folder))).has("relative"));
    assert.deepEqual(await run(history.locate("relative", [folder])), { _tag: "file", path: file });
  } finally {
    process.env.PI_CODING_AGENT_SESSION_DIR = previous;
  }
});
